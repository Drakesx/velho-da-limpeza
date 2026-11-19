const $ = (id) => document.getElementById(id);
const canvas = $('game-canvas');
const ctx = canvas.getContext('2d');
const heroCanvas = $('hero-sprite');
const heroCtx = heroCanvas.getContext('2d');
const menuScreen = $('menu-screen');
const gameScreen = $('game-screen');
const nicknameInput = $('nickname');
const socketUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const TOOLS = [
  { name: 'ESPINGARDA DE ESPUMA', icon: '🫧', color: '#b8f6ff', label: 'ESPUMA' },
  { name: 'JATO DE SABÃO', icon: '🧴', color: '#7be7ff', label: 'SABÃO' },
  { name: 'ASPIRADOR TURBO', icon: '🌀', color: '#f4d35e', label: 'ASPIRADOR' },
  { name: 'ESFREGÃO SUPREMO', icon: '🧹', color: '#a8e66a', label: 'ESFREGÃO' }
];

let socket;
let connected = false;
let inGame = false;
let playerId = null;
let state = null;
let selectedTool = 0;
let soundEnabled = true;
let mouse = { x: 680, y: 270, fire: false, seen: false };
let keys = new Set();
let joystick = { x: 0, y: 0, active: false, pointerId: null };
let mobileFire = false;
let lastInputAt = 0;
let lastToastAt = 0;
let toastTimer;
let audioContext = null;
let previousMobIds = new Set();
let particles = [];
let lastFrame = performance.now();

function connect() {
  setConnection('CONECTANDO', false);
  socket = new WebSocket(socketUrl);
  socket.addEventListener('open', () => {
    connected = true;
    setConnection('ONLINE', true);
    $('server-state').textContent = 'SERVIDOR CONECTADO';
    $('solo-button').disabled = false;
    $('public-button').disabled = false;
  });
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    handleMessage(message);
  });
  socket.addEventListener('close', () => {
    connected = false;
    setConnection('DESCONECTADO', false);
    $('server-state').textContent = 'SEM CONEXÃO COM O SERVIDOR';
    if (inGame) showToast('Conexão perdida. Tentando reconectar...');
    setTimeout(connect, 1800);
  });
  socket.addEventListener('error', () => {
    setConnection('ERRO DE REDE', false);
    $('server-state').textContent = 'NÃO FOI POSSÍVEL CONECTAR';
  });
}

function setConnection(label, online) {
  $('connection-label').textContent = label;
  document.querySelector('.live-dot').classList.toggle('online', online);
}

function send(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showToast('Servidor indisponível. Aguarde a conexão.');
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function handleMessage(message) {
  if (message.type === 'hello') {
    connected = true;
    setConnection('ONLINE', true);
    $('server-state').textContent = `SERVIDOR ONLINE • ${message.online} CONECTADO(S)`;
  } else if (message.type === 'joined') {
    playerId = message.playerId;
    inGame = true;
    state = null;
    previousMobIds.clear();
    menuScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    $('room-label').textContent = message.roomCode;
    $('canvas-hint').textContent = isCoarsePointer()
      ? 'JOYSTICK MOVE • BOTÃO LIMPA • TROCAR FERRAMENTA'
      : 'WASD / SETAS • MOUSE MIRA • ESPAÇO LIMPA • 1–4 TROCA FERRAMENTA';
    showToast(message.isPrivate ? `SALA ${message.roomCode} CRIADA` : `VOCÊ ENTROU NA SALA ${message.roomCode}`);
    beep(520, 0.07);
    resizeCanvas();
  } else if (message.type === 'state') {
    const nextIds = new Set(message.mobs.map(mob => mob.id));
    for (const oldId of previousMobIds) {
      if (!nextIds.has(oldId) && state?.mobs) {
        const oldMob = state.mobs.find(mob => mob.id === oldId);
        if (oldMob) burst(oldMob.x, oldMob.y, '#b8f6ff', 9);
      }
    }
    previousMobIds = nextIds;
    state = message;
    updateHud();
  } else if (message.type === 'notice') {
    showToast(message.text);
  } else if (message.type === 'error') {
    showToast(message.message || 'Não foi possível realizar a ação.');
  } else if (message.type === 'left') {
    backToMenu();
  }
}

function begin(mode) {
  const nick = nicknameInput.value.trim().slice(0, 16) || 'Osvaldo';
  if (!connected) { showToast('Conectando ao servidor...'); return; }
  send({ type: 'join', mode, nick, code: $('room-code').value.trim().toUpperCase() });
}

function backToMenu() {
  inGame = false;
  playerId = null;
  state = null;
  joystick.x = 0; joystick.y = 0; mobileFire = false;
  menuScreen.classList.remove('hidden');
  gameScreen.classList.add('hidden');
  $('server-state').textContent = connected ? 'SERVIDOR CONECTADO' : 'AGUARDANDO CONEXÃO';
}

function leaveGame() {
  if (inGame) send({ type: 'leave' });
  backToMenu();
}

function showToast(text) {
  const now = Date.now();
  if (now - lastToastAt < 420 && $('toast').textContent === text) return;
  lastToastAt = now;
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2300);
}

function isCoarsePointer() { return matchMedia('(pointer: coarse)').matches || innerWidth < 760; }

function updateHud() {
  if (!state) return;
  $('team-score').textContent = String(state.totalScore).padStart(4, '0');
  $('elapsed-label').textContent = `${String(Math.floor(state.elapsed / 60)).padStart(2, '0')}:${String(state.elapsed % 60).padStart(2, '0')}`;
  $('player-count').textContent = `${state.players.length}/4`;
  $('room-label').textContent = state.roomCode;
  const me = state.players.find(player => player.id === playerId);
  if (me) {
    $('health-fill').style.width = `${me.health}%`;
    $('health-number').textContent = `${me.health}%`;
    selectedTool = me.tool;
    $('tool-icon').textContent = TOOLS[selectedTool].icon;
    $('tool-name').textContent = TOOLS[selectedTool].name;
    $('tool-number').textContent = `${selectedTool + 1} / 4`;
  }
  $('party-list').innerHTML = state.players.map(player =>
    `<div class="party-chip" style="--player-color:${player.color}"><i></i><span>${escapeHtml(player.nick)}</span><b>${player.score}</b></div>`
  ).join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function switchTool(delta) {
  selectedTool = (selectedTool + delta + TOOLS.length) % TOOLS.length;
  $('tool-icon').textContent = TOOLS[selectedTool].icon;
  $('tool-name').textContent = TOOLS[selectedTool].name;
  $('tool-number').textContent = `${selectedTool + 1} / 4`;
  beep(300 + selectedTool * 85, 0.045);
}

function movementVector() {
  let x = joystick.active ? joystick.x : 0;
  let y = joystick.active ? joystick.y : 0;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  return { x, y };
}

function aimVector() {
  const me = state?.players?.find(player => player.id === playerId);
  if (!me) return { x: 1, y: 0 };
  if (!mouse.seen && isCoarsePointer() && state?.mobs?.length) {
    const target = [...state.mobs].sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    const x = target.x - me.x; const y = target.y - me.y; const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  }
  const rect = canvas.getBoundingClientRect();
  const worldX = (mouse.x / rect.width) * canvas.width;
  const worldY = (mouse.y / rect.height) * canvas.height;
  const x = worldX - me.x; const y = worldY - me.y; const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function sendInput(now) {
  if (!inGame || !connected || now - lastInputAt < 45) return;
  lastInputAt = now;
  const move = movementVector();
  const aim = aimVector();
  send({ type: 'input', x: move.x, y: move.y, aimX: aim.x, aimY: aim.y, fire: mouse.fire || mobileFire || keys.has('Space'), tool: selectedTool });
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = event.clientX - rect.left;
  mouse.y = event.clientY - rect.top;
  mouse.seen = true;
}

function resizeCanvas() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) {
    const backingWidth = Math.round(rect.width * dpr);
    const backingHeight = Math.round((rect.width * (canvas.height / canvas.width)) * dpr);
    if (canvas.width !== 960 || canvas.height !== 540) { canvas.width = 960; canvas.height = 540; }
    canvas.style.imageRendering = 'pixelated';
  }
}

function px(target, x, y, w, h, color) {
  target.fillStyle = color;
  target.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function drawJanitor(target, x, y, scale = 1, angle = 0, tool = 0, color = '#63d4a4', animate = 0) {
  target.save();
  target.translate(Math.round(x), Math.round(y));
  target.rotate(angle);
  target.scale(scale, scale);
  const p = (a, b, w, h, c) => px(target, a, b, w, h, c);
  // shadow and shoes
  p(-11, 12, 8, 4, '#101511'); p(4, 12, 8, 4, '#101511');
  // legs + uniform
  p(-9, 4, 7, 10, '#28465a'); p(2, 4, 7, 10, '#28465a');
  p(-10, 12, 9, 4, '#17252a'); p(2, 12, 9, 4, '#17252a');
  p(-10, -4, 20, 11, '#426e59'); p(-8, -5, 16, 3, '#86b47b');
  p(-2, -4, 4, 9, '#d7dfbb'); p(-7, 0, 3, 4, '#d7dfbb');
  // arms
  p(-14, -3, 5, 9, '#d69b75'); p(9, -3, 5, 9, '#d69b75');
  p(-15, 4, 5, 4, '#c98763'); p(10, 4, 5, 4, '#c98763');
  // neck and face
  p(-5, -11, 10, 5, '#dca783'); p(-8, -22, 16, 13, '#e9bd93');
  // ear
  p(-10, -17, 3, 5, '#c98f70'); p(7, -17, 3, 5, '#c98f70');
  // grey hair / bald fringe
  p(-8, -24, 16, 4, '#d6d6c8'); p(-9, -22, 3, 6, '#b8beb1'); p(6, -22, 3, 6, '#b8beb1');
  p(-5, -25, 10, 2, '#f0eee0');
  // eyebrows, eyes and moustache
  p(-5, -17, 3, 2, '#55493e'); p(3, -17, 3, 2, '#55493e');
  p(-4, -15, 2, 2, '#28352f'); p(3, -15, 2, 2, '#28352f');
  p(-6, -12, 12, 3, '#f2e2c9'); p(-8, -11, 5, 3, '#786456'); p(3, -11, 5, 3, '#786456');
  p(-3, -8, 6, 2, '#986e5b');
  // cap
  p(-9, -27, 18, 4, '#bb6047'); p(-7, -30, 14, 3, '#d27a56'); p(5, -26, 8, 2, '#e2a16f');
  // tool in front of him
  const toolColors = ['#b8f6ff', '#7be7ff', '#f4d35e', '#a8e66a'];
  if (tool === 0) { p(11, -2, 12, 4, '#d6f6e8'); p(20, -4, 4, 8, toolColors[tool]); p(13, -3, 4, 6, '#5f9f8b'); }
  if (tool === 1) { p(12, -3, 10, 6, '#7be7ff'); p(20, -5, 4, 10, '#d7f8ff'); p(13, -5, 4, 2, '#467f9b'); }
  if (tool === 2) { p(11, -5, 11, 10, '#e4bd4d'); p(17, -7, 7, 3, '#f6dc7b'); p(20, -1, 8, 5, '#7ca18c'); }
  if (tool === 3) { p(14, -5, 3, 21, '#a8d384'); p(10, 12, 12, 5, '#d1e8a3'); p(9, 15, 14, 3, '#719d70'); }
  target.restore();
}

function drawHero() {
  heroCtx.clearRect(0, 0, heroCanvas.width, heroCanvas.height);
  heroCtx.fillStyle = '#1d3028'; heroCtx.fillRect(0, 0, 176, 176);
  for (let y = 0; y < 176; y += 16) for (let x = 0; x < 176; x += 16) {
    if ((x / 16 + y / 16) % 2 === 0) { heroCtx.fillStyle = 'rgba(166,220,153,.035)'; heroCtx.fillRect(x, y, 16, 16); }
  }
  heroCtx.fillStyle = '#314e3b'; heroCtx.fillRect(25, 139, 126, 8);
  drawJanitor(heroCtx, 86, 114, 3, -.09, 0, '#63d4a4');
  heroCtx.fillStyle = '#d6f36b'; heroCtx.fillRect(21, 21, 9, 3); heroCtx.fillRect(21, 21, 3, 9);
  heroCtx.fillRect(146, 143, 9, 3); heroCtx.fillRect(152, 137, 3, 9);
}

function drawBackground() {
  ctx.fillStyle = '#182820'; ctx.fillRect(0, 0, 960, 540);
  for (let y = 0; y < 540; y += 32) {
    for (let x = 0; x < 960; x += 32) {
      const alternate = ((x / 32) + (y / 32)) % 2 === 0;
      ctx.fillStyle = alternate ? '#1b2c23' : '#1d3026';
      ctx.fillRect(x, y, 31, 31);
      ctx.fillStyle = 'rgba(169,213,159,.08)'; ctx.fillRect(x + 4, y + 4, 2, 2);
      if ((x * 3 + y * 7) % 13 === 0) { ctx.fillStyle = 'rgba(134,176,134,.15)'; ctx.fillRect(x + 22, y + 23, 4, 2); }
    }
  }
  // floor markings and fixed props
  ctx.fillStyle = '#304537'; ctx.fillRect(34, 44, 7, 96); ctx.fillRect(34, 44, 92, 7);
  ctx.fillStyle = '#4b5e42'; ctx.fillRect(38, 48, 86, 2); ctx.fillRect(38, 48, 2, 86);
  drawBin(870, 80); drawBucket(75, 425); drawFloorSign(840, 425);
  ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, 0, 960, 4); ctx.fillRect(0, 536, 960, 4);
}

function drawBin(x, y) {
  ctx.fillStyle = '#101915'; ctx.fillRect(x + 2, y + 25, 44, 7);
  ctx.fillStyle = '#395947'; ctx.fillRect(x, y + 5, 46, 25); ctx.fillRect(x - 3, y + 1, 52, 6);
  ctx.fillStyle = '#658469'; ctx.fillRect(x + 5, y + 10, 4, 14); ctx.fillRect(x + 17, y + 10, 4, 14); ctx.fillRect(x + 30, y + 10, 4, 14);
}
function drawBucket(x, y) {
  ctx.fillStyle = '#101914'; ctx.fillRect(x + 5, y + 33, 52, 5);
  ctx.fillStyle = '#487f82'; ctx.fillRect(x + 8, y + 9, 44, 24); ctx.fillRect(x + 5, y + 5, 50, 5);
  ctx.fillStyle = '#89c2ad'; ctx.fillRect(x + 13, y + 14, 34, 3);
  ctx.fillStyle = '#e4ca79'; ctx.fillRect(x + 20, y + 20, 20, 8);
}
function drawFloorSign(x, y) {
  ctx.fillStyle = '#111a16'; ctx.fillRect(x + 3, y + 54, 40, 5);
  ctx.fillStyle = '#e8c75d'; ctx.fillRect(x + 4, y + 4, 38, 43);
  ctx.fillStyle = '#394d38'; ctx.fillRect(x + 8, y + 8, 30, 35);
  ctx.fillStyle = '#d8e18a'; ctx.fillRect(x + 15, y + 15, 16, 5); ctx.fillRect(x + 21, y + 20, 5, 12);
}

function drawMob(mob) {
  const colors = [ ['#4c6d43', '#83a85a', '#263b2d'], ['#79523c', '#b27a4a', '#3f2d28'], ['#56517d', '#8b7cc1', '#332d50'] ][mob.kind];
  const [dark, light, shade] = colors;
  const bob = Math.sin(mob.wobble || 0) * 2;
  ctx.save(); ctx.translate(Math.round(mob.x), Math.round(mob.y + bob));
  ctx.fillStyle = 'rgba(0,0,0,.24)'; ctx.fillRect(-14, 11, 30, 5);
  ctx.fillStyle = dark; ctx.fillRect(-13, -8, 27, 17); ctx.fillRect(-9, -12, 19, 4); ctx.fillRect(-16, -3, 4, 9); ctx.fillRect(12, -5, 4, 8);
  ctx.fillStyle = light; ctx.fillRect(-9, -8, 17, 7); ctx.fillRect(-5, -13, 8, 3); ctx.fillRect(-15, 0, 3, 4);
  ctx.fillStyle = shade; ctx.fillRect(-7, -2, 4, 5); ctx.fillRect(4, -2, 4, 5);
  ctx.fillStyle = '#f7efcf'; ctx.fillRect(-6, -1, 2, 2); ctx.fillRect(5, -1, 2, 2);
  ctx.fillStyle = '#28372d'; ctx.fillRect(-2, 4, 6, 2);
  ctx.fillStyle = '#a7d59c'; ctx.fillRect(-1, -16, 3, 4); ctx.fillRect(-3, -18, 2, 2);
  if (mob.hp < mob.maxHp) {
    ctx.fillStyle = '#152019'; ctx.fillRect(-13, -22, 27, 4);
    ctx.fillStyle = '#d6f36b'; ctx.fillRect(-12, -21, Math.max(1, 25 * mob.hp / mob.maxHp), 2);
  }
  ctx.restore();
}

function drawPlayer(player) {
  const flicker = player.health < 40 && Math.floor(performance.now() / 110) % 2 === 0;
  if (flicker) return;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.24)'; ctx.fillRect(player.x - 15, player.y + 16, 31, 6);
  drawJanitor(ctx, player.x, player.y, 1.55, player.angle, player.tool, player.color);
  ctx.fillStyle = player.color; ctx.fillRect(player.x - 19, player.y - 38, 38, 3);
  ctx.fillStyle = '#d9e7d1'; ctx.font = '10px monospace'; ctx.textAlign = 'center'; ctx.fillText(player.nick.slice(0, 13), player.x, player.y - 43);
  if (player.id === playerId) { ctx.fillStyle = '#d6f36b'; ctx.fillRect(player.x - 3, player.y - 49, 6, 3); }
  ctx.restore();
}

function drawProjectile(projectile) {
  const colors = ['#baf5ff', '#7be7ff', '#f4d35e', '#a8e66a'];
  const color = colors[projectile.tool] || '#b8f6ff';
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(projectile.x - projectile.radius + 2, projectile.y + projectile.radius, projectile.radius * 2, 3);
  ctx.fillStyle = color; ctx.fillRect(projectile.x - projectile.radius, projectile.y - projectile.radius, projectile.radius * 2, projectile.radius * 2);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(projectile.x - projectile.radius / 2, projectile.y - projectile.radius / 2, Math.max(2, projectile.radius / 2), Math.max(2, projectile.radius / 2));
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i++) particles.push({ x, y, vx: (Math.random() - .5) * 120, vy: (Math.random() - .5) * 120, life: .35 + Math.random() * .45, color });
  beep(650 + Math.random() * 180, .035);
}
function drawParticles(dt) {
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.5));
    ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, 4, 4);
  }
  ctx.globalAlpha = 1;
  particles = particles.filter(p => p.life > 0);
}

function render(now) {
  const dt = Math.min(.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (inGame) {
    sendInput(now);
    drawBackground();
    if (state) {
      for (const mob of state.mobs) drawMob(mob);
      for (const projectile of state.projectiles) drawProjectile(projectile);
      for (const player of state.players) drawPlayer(player);
      const me = state.players.find(player => player.id === playerId);
      if (me && (mouse.fire || mobileFire || keys.has('Space'))) {
        const tipX = me.x + Math.cos(me.angle) * 43;
        const tipY = me.y + Math.sin(me.angle) * 43;
        ctx.strokeStyle = TOOLS[me.tool].color; ctx.globalAlpha = .42; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(me.x + Math.cos(me.angle) * 22, me.y + Math.sin(me.angle) * 22); ctx.lineTo(tipX, tipY); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    drawParticles(dt);
    if (!state) {
      ctx.fillStyle = '#d6f36b'; ctx.font = '16px monospace'; ctx.textAlign = 'center'; ctx.fillText('CARREGANDO O TURNO...', 480, 270);
    }
  }
  requestAnimationFrame(render);
}

function beep(frequency = 440, duration = .05) {
  if (!soundEnabled) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'square'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.025, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
  } catch { /* áudio opcional */ }
}

function setupJoystick() {
  const pad = $('joystick'); const knob = $('joystick-knob');
  function update(event) {
    const rect = pad.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2 - 5;
    const max = 31;
    let dx = event.clientX - centerX; let dy = event.clientY - centerY;
    const len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    joystick.x = dx / max; joystick.y = dy / max; joystick.active = true;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  pad.addEventListener('pointerdown', event => { joystick.pointerId = event.pointerId; pad.setPointerCapture(event.pointerId); update(event); });
  pad.addEventListener('pointermove', event => { if (event.pointerId === joystick.pointerId) update(event); });
  function end(event) {
    if (event.pointerId !== joystick.pointerId) return;
    joystick.x = 0; joystick.y = 0; joystick.active = false; joystick.pointerId = null;
    knob.style.transform = 'translate(0,0)';
  }
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
}

$('solo-button').addEventListener('click', () => begin('solo'));
$('public-button').addEventListener('click', () => begin('public'));
$('create-button').addEventListener('click', () => begin('private'));
$('join-button').addEventListener('click', () => {
  const code = $('room-code').value.trim();
  if (code.length < 5) { showToast('Digite o código de 5 caracteres.'); return; }
  begin('code');
});
$('room-code').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
$('leave-button').addEventListener('click', leaveGame);
$('tool-prev').addEventListener('click', () => switchTool(-1));
$('tool-next').addEventListener('click', () => switchTool(1));
$('mobile-switch').addEventListener('click', () => switchTool(1));
$('mobile-fire').addEventListener('pointerdown', event => { event.preventDefault(); mobileFire = true; $('mobile-fire').setPointerCapture(event.pointerId); });
$('mobile-fire').addEventListener('pointerup', () => { mobileFire = false; });
$('mobile-fire').addEventListener('pointercancel', () => { mobileFire = false; });
$('sound-button').addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  $('sound-button').textContent = soundEnabled ? '♪' : '×';
  $('sound-button').title = soundEnabled ? 'Desativar som' : 'Ativar som';
  if (soundEnabled) beep(510, .08);
});
canvas.addEventListener('pointermove', pointerPosition);
canvas.addEventListener('pointerdown', event => { if (event.pointerType === 'mouse') { pointerPosition(event); mouse.fire = true; canvas.setPointerCapture(event.pointerId); } });
canvas.addEventListener('pointerup', event => { if (event.pointerType === 'mouse') mouse.fire = false; });
canvas.addEventListener('pointercancel', () => { mouse.fire = false; });

window.addEventListener('keydown', event => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'Digit1') { selectedTool = 0; updateHudTool(); }
  if (event.code === 'Digit2') { selectedTool = 1; updateHudTool(); }
  if (event.code === 'Digit3') { selectedTool = 2; updateHudTool(); }
  if (event.code === 'Digit4') { selectedTool = 3; updateHudTool(); }
  if (event.code === 'KeyQ') switchTool(-1);
  if (event.code === 'KeyE') switchTool(1);
  if (event.code === 'Escape' && inGame) leaveGame();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); mouse.fire = false; mobileFire = false; joystick.active = false; });
function updateHudTool() {
  $('tool-icon').textContent = TOOLS[selectedTool].icon;
  $('tool-name').textContent = TOOLS[selectedTool].name;
  $('tool-number').textContent = `${selectedTool + 1} / 4`;
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 180));

// Portrait uses the same pixel sprite renderer as the game.
drawHero();
setupJoystick();
resizeCanvas();
connect();
requestAnimationFrame(render);
