import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

function frame(opcode, payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

class WebSocketPeer extends EventEmitter {
  constructor(socket, head = Buffer.alloc(0), maxPayload = 4096) {
    super();
    this.socket = socket;
    this.readyState = OPEN;
    this.maxPayload = maxPayload;
    this.buffer = Buffer.alloc(0);
    this.fragmented = [];
    this.fragmentOpcode = 0;
    socket.on('data', chunk => this._consume(chunk));
    socket.on('error', error => this.emit('error', error));
    socket.on('end', () => this._finish());
    socket.on('close', () => this._finish());
    if (head?.length) this._consume(head);
  }

  send(value) {
    if (this.readyState !== OPEN) return;
    const data = Buffer.from(String(value));
    if (data.length > this.maxPayload) throw new Error('WebSocket payload exceeds configured limit');
    this.socket.write(frame(1, data));
  }

  close(code = 1000, reason = '') {
    if (this.readyState !== OPEN) return;
    this.readyState = CLOSING;
    const reasonBytes = Buffer.from(String(reason).slice(0, 100));
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0); reasonBytes.copy(payload, 2);
    try { this.socket.write(frame(8, payload), () => this.socket.end()); }
    catch { this.socket.destroy(); }
  }

  terminate() {
    this.readyState = CLOSED;
    this.socket.destroy();
    this._finish();
  }

  _finish() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.emit('close');
  }

  _consume(chunk) {
    if (this.readyState === CLOSED) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (!masked) { this.close(1002, 'Client frames must be masked'); return; }
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const wide = this.buffer.readBigUInt64BE(2);
        if (wide > BigInt(this.maxPayload)) { this.close(1009, 'Message too large'); return; }
        length = Number(wide); offset = 10;
      }
      if (length > this.maxPayload) { this.close(1009, 'Message too large'); return; }
      const isControl = opcode >= 8;
      if (isControl && (!fin || length > 125)) { this.close(1002, 'Invalid control frame'); return; }
      if (this.buffer.length < offset + 4 + length) return;
      const mask = this.buffer.subarray(offset, offset + 4); offset += 4;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buffer = this.buffer.subarray(offset + length);

      if (opcode === 8) {
        if (this.readyState === OPEN) {
          this.readyState = CLOSING;
          this.socket.write(frame(8, payload), () => this.socket.end());
        }
        this._finish();
        return;
      }
      if (opcode === 9) { this.socket.write(frame(10, payload)); continue; }
      if (opcode === 10) continue;
      if (opcode === 1 || opcode === 2) {
        if (this.fragmentOpcode !== 0) { this.close(1002, 'Unexpected data frame'); return; }
        if (fin) {
          if (opcode === 1) this.emit('message', payload);
        } else {
          this.fragmentOpcode = opcode; this.fragmented = [payload];
        }
        continue;
      }
      if (opcode === 0) {
        if (this.fragmentOpcode === 0) { this.close(1002, 'Unexpected continuation'); return; }
        this.fragmented.push(payload);
        const total = this.fragmented.reduce((sum, part) => sum + part.length, 0);
        if (total > this.maxPayload) { this.close(1009, 'Message too large'); return; }
        if (fin) {
          const full = Buffer.concat(this.fragmented);
          const originalOpcode = this.fragmentOpcode;
          this.fragmented = []; this.fragmentOpcode = 0;
          if (originalOpcode === 1) this.emit('message', full);
        }
        continue;
      }
      this.close(1002, 'Unsupported opcode');
      return;
    }
  }
}

export class WebSocketServer extends EventEmitter {
  constructor({ server, path = '/ws', maxPayload = 4096 } = {}) {
    super();
    if (!server) throw new TypeError('An HTTP server is required');
    this.clients = new Set();
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
      if (pathname !== path) { socket.destroy(); return; }
      const key = request.headers['sec-websocket-key'];
      const upgrade = String(request.headers.upgrade || '').toLowerCase();
      if (!key || upgrade !== 'websocket' || request.headers['sec-websocket-version'] !== '13') {
        socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
      }
      const accept = createHash('sha1').update(key + GUID).digest('base64');
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n'
      ].join('\r\n'));
      const peer = new WebSocketPeer(socket, head, maxPayload);
      this.clients.add(peer);
      peer.once('close', () => this.clients.delete(peer));
      this.emit('connection', peer, request);
    });
  }
}

export const WebSocket = Object.freeze({ OPEN });
