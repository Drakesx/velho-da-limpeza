import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from './websocket.js';
import { createPlayer, createRoom, updateRoom, roomSnapshot, cleanNick, TOOLS } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
// Load the local .env file without requiring an extra package.
const envFile = path.resolve(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
const PORT = Number(process.env.PORT || 3000);
const ROOM_CAPACITY = Math.min(4, Math.max(2, Number(process.env.ROOM_CAPACITY || 4)));
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const rooms = new Map();
const clients = new Map();

const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: clients.size }));
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': mime[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096, perMessageDeflate: false });

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
function makeCode() { return randomBytes(3).toString('hex').toUpperCase().slice(0, 5); }
function uniqueCode() { let code = makeCode(); while (rooms.has(code)) code = makeCode(); return code; }
function findPublicRoom() {
  return [...rooms.values()].find(room => !room.isPrivate && room.players.size < room.capacity);
}
function removeClient(socket) {
  const client = clients.get(socket);
  if (!client) return;
  if (client.room) {
    client.room.players.delete(client.id);
    if (client.room.players.size === 0) client.room.lastEmptyAt = Date.now();
  }
  clients.delete(socket);
}
function joinRoom(socket, room, nick) {
  const old = clients.get(socket);
  if (old?.room) old.room.players.delete(old.id);
  const id = randomUUID();
  const player = createPlayer(id, nick);
  room.players.set(id, player);
  clients.set(socket, { id, room, player, lastInputAt: 0 });
  send(socket, { type: 'joined', playerId: id, roomCode: room.id, isPrivate: room.isPrivate, capacity: room.capacity, tools: TOOLS });
  broadcast(room, { type: 'notice', text: `${player.nick} entrou na partida.` });
  broadcastState(room);
}
function broadcast(room, payload) {
  for (const [socket, client] of clients.entries()) if (client.room === room) send(socket, payload);
}
function broadcastState(room) { broadcast(room, roomSnapshot(room)); }
function fail(socket, message) { send(socket, { type: 'error', message }); }

wss.on('connection', (socket, request) => {
  if (ALLOWED_ORIGIN && request.headers.origin && request.headers.origin !== ALLOWED_ORIGIN) {
    socket.close(1008, 'Origin not allowed'); return;
  }
  clients.set(socket, { id: null, room: null, player: null, lastInputAt: 0 });
  send(socket, { type: 'hello', online: clients.size, tools: TOOLS });

  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { fail(socket, 'Mensagem inválida.'); return; }
    const client = clients.get(socket);
    if (!client) return;

    if (message.type === 'join') {
      if (client.room) { fail(socket, 'Você já está em uma sala.'); return; }
      const nick = cleanNick(message.nick);
      let room;
      if (message.mode === 'solo') {
        room = createRoom(`SOLO-${makeCode()}`, true, 1);
        rooms.set(room.id, room);
      } else if (message.mode === 'public') {
        room = findPublicRoom();
        if (!room) { room = createRoom(uniqueCode(), false, ROOM_CAPACITY); rooms.set(room.id, room); }
      } else if (message.mode === 'private') {
        const code = uniqueCode();
        room = createRoom(code, true, ROOM_CAPACITY); rooms.set(room.id, room);
      } else if (message.mode === 'code') {
        const code = String(message.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        room = rooms.get(code);
        if (!room || !room.isPrivate || room.id.startsWith('SOLO-')) { fail(socket, 'Sala privada não encontrada. Confira o código.'); return; }
        if (room.players.size >= room.capacity) { fail(socket, 'Esta sala está cheia.'); return; }
      } else { fail(socket, 'Modo de sala inválido.'); return; }
      joinRoom(socket, room, nick);
      return;
    }

    if (message.type === 'input') {
      if (!client.room || !client.player) return;
      const now = Date.now();
      if (now - client.lastInputAt < 25) return;
      client.lastInputAt = now;
      const x = Number(message.x); const y = Number(message.y);
      const aimX = Number(message.aimX); const aimY = Number(message.aimY);
      const aimLength = Math.hypot(aimX, aimY) || 1;
      client.player.input = {
        x: Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0,
        y: Number.isFinite(y) ? Math.max(-1, Math.min(1, y)) : 0,
        aimX: Number.isFinite(aimX) ? aimX / aimLength : 1,
        aimY: Number.isFinite(aimY) ? aimY / aimLength : 0,
        fire: Boolean(message.fire)
      };
      if (Number.isInteger(message.tool)) client.player.tool = Math.max(0, Math.min(3, message.tool));
      return;
    }

    if (message.type === 'leave') {
      removeClient(socket);
      send(socket, { type: 'left' });
      return;
    }
    if (message.type === 'ping') send(socket, { type: 'pong', at: Date.now() });
  });

  socket.on('close', () => removeClient(socket));
  socket.on('error', () => removeClient(socket));
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (room.players.size === 0) {
      if (!room.lastEmptyAt) room.lastEmptyAt = now;
      if (now - room.lastEmptyAt > 60_000) rooms.delete(id);
      continue;
    }
    updateRoom(room, 0.05, now);
    broadcastState(room);
  }
}, 50).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🧽 Velho da Limpeza online em http://localhost:${PORT}`);
  console.log(`WebSocket disponível em /ws | limite de ${ROOM_CAPACITY} jogadores por sala`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const socket of wss.clients) socket.close(1001, 'Servidor encerrando');
    server.close(() => process.exit(0));
  });
}
