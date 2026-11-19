export const WORLD = Object.freeze({ width: 960, height: 540 });
export const TOOLS = Object.freeze([
  { id: 0, name: 'Espuma', short: 'FOAM', cooldown: 230, color: '#b8f6ff' },
  { id: 1, name: 'Sabão', short: 'SOAP', cooldown: 720, color: '#7be7ff' },
  { id: 2, name: 'Aspirador', short: 'VAC', cooldown: 480, color: '#f4d35e' },
  { id: 3, name: 'Esfregão', short: 'MOP', cooldown: 520, color: '#a8e66a' }
]);

const rand = (min, max) => Math.random() * (max - min) + min;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createRoom(id, isPrivate = false, capacity = 4) {
  return {
    id,
    isPrivate,
    capacity,
    players: new Map(),
    mobs: [],
    projectiles: [],
    nextMobAt: Date.now() + 900,
    createdAt: Date.now(),
    lastEmptyAt: null,
    mobSequence: 0,
    projectileSequence: 0,
    startedAt: Date.now(),
    tick: 0
  };
}

export function createPlayer(id, nick) {
  return {
    id,
    nick: cleanNick(nick),
    x: rand(390, 570),
    y: rand(210, 330),
    angle: 0,
    tool: 0,
    score: 0,
    health: 100,
    input: { x: 0, y: 0, aimX: 1, aimY: 0, fire: false },
    lastFireAt: 0,
    lastDamageAt: 0,
    invulnerableUntil: 0,
    color: ['#63d4a4', '#77a8ff', '#ffbd69', '#c49bff'][Math.floor(rand(0, 4))],
    connected: true
  };
}

export function cleanNick(value) {
  const nick = String(value ?? 'Faxineiro').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 16);
  return nick || 'Faxineiro';
}

function spawnMob(room) {
  const side = Math.floor(rand(0, 4));
  let x = side === 0 ? -18 : side === 1 ? WORLD.width + 18 : rand(0, WORLD.width);
  let y = side === 2 ? -18 : side === 3 ? WORLD.height + 18 : rand(0, WORLD.height);
  const kind = Math.floor(rand(0, 3));
  room.mobSequence += 1;
  room.mobs.push({
    id: `d${room.mobSequence}`,
    x: clamp(x, -22, WORLD.width + 22),
    y: clamp(y, -22, WORLD.height + 22),
    kind,
    hp: kind === 2 ? 4 : kind === 1 ? 3 : 2,
    maxHp: kind === 2 ? 4 : kind === 1 ? 3 : 2,
    speed: kind === 2 ? 23 : kind === 1 ? 31 : 38,
    wobble: rand(0, Math.PI * 2),
    lastHitBy: null
  });
}

function awardClean(room, mob, player, points = 10) {
  player.score += points;
  room.mobs = room.mobs.filter(item => item.id !== mob.id);
}

function projectileHit(room, projectile, mob, player) {
  mob.hp -= projectile.damage;
  mob.lastHitBy = player.id;
  if (mob.hp <= 0) awardClean(room, mob, player, mob.kind === 2 ? 30 : mob.kind === 1 ? 20 : 10);
}

function useVacuum(room, player, now) {
  const aim = player.input;
  const direction = Math.atan2(aim.aimY, aim.aimX);
  const targets = room.mobs.filter(mob => {
    const dx = mob.x - player.x;
    const dy = mob.y - player.y;
    const d = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const delta = Math.atan2(Math.sin(angle - direction), Math.cos(angle - direction));
    return d < 126 && Math.abs(delta) < 0.62;
  });
  for (const mob of targets) {
    mob.hp -= 1;
    mob.lastHitBy = player.id;
    const dx = player.x - mob.x;
    const dy = player.y - mob.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    mob.x += (dx / d) * 2.2;
    mob.y += (dy / d) * 2.2;
    if (mob.hp <= 0) awardClean(room, mob, player, mob.kind === 2 ? 30 : mob.kind === 1 ? 20 : 10);
  }
  player.lastFireAt = now;
}

function useMop(room, player, now) {
  const aimAngle = Math.atan2(player.input.aimY, player.input.aimX);
  for (const mob of [...room.mobs]) {
    const dx = mob.x - player.x;
    const dy = mob.y - player.y;
    const d = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const delta = Math.atan2(Math.sin(angle - aimAngle), Math.cos(angle - aimAngle));
    if (d < 77 && Math.abs(delta) < 1.08) {
      mob.hp -= 2;
      mob.lastHitBy = player.id;
      if (mob.hp <= 0) awardClean(room, mob, player, mob.kind === 2 ? 30 : mob.kind === 1 ? 20 : 10);
      else {
        mob.x += Math.cos(aimAngle) * 24;
        mob.y += Math.sin(aimAngle) * 24;
      }
    }
  }
  player.lastFireAt = now;
}

function useTool(room, player, now) {
  const tool = TOOLS[player.tool];
  if (!player.input.fire || now - player.lastFireAt < tool.cooldown) return;
  if (player.tool === 2) return useVacuum(room, player, now);
  if (player.tool === 3) return useMop(room, player, now);

  const angle = Math.atan2(player.input.aimY, player.input.aimX);
  const isSoap = player.tool === 1;
  room.projectileSequence += 1;
  room.projectiles.push({
    id: `p${room.projectileSequence}`,
    ownerId: player.id,
    x: player.x + Math.cos(angle) * 18,
    y: player.y + Math.sin(angle) * 18,
    vx: Math.cos(angle) * (isSoap ? 265 : 405),
    vy: Math.sin(angle) * (isSoap ? 265 : 405),
    radius: isSoap ? 13 : 7,
    damage: isSoap ? 2 : 1,
    splash: isSoap ? 48 : 0,
    life: isSoap ? 1.55 : 1.2,
    tool: player.tool
  });
  player.lastFireAt = now;
}

export function updateRoom(room, dtSeconds, now = Date.now()) {
  room.tick += 1;
  const players = [...room.players.values()];

  if (room.mobs.length < 18 && now >= room.nextMobAt) {
    const elapsedSeconds = (now - room.startedAt) / 1000;
    spawnMob(room);
    if (elapsedSeconds > 40 && room.mobs.length < 18 && Math.random() < 0.28) spawnMob(room);
    room.nextMobAt = now + Math.max(650, 2100 - elapsedSeconds * 13);
  }

  for (const player of players) {
    const input = player.input;
    const magnitude = Math.hypot(input.x, input.y) || 1;
    player.x = clamp(player.x + (input.x / magnitude) * 190 * dtSeconds, 18, WORLD.width - 18);
    player.y = clamp(player.y + (input.y / magnitude) * 190 * dtSeconds, 24, WORLD.height - 18);
    player.angle = Math.atan2(input.aimY, input.aimX);
    useTool(room, player, now);
  }

  for (const mob of [...room.mobs]) {
    const target = players.filter(p => p.health > 0).sort((a, b) => distance(a, mob) - distance(b, mob))[0];
    if (!target) continue;
    mob.wobble += dtSeconds * 4;
    const dx = target.x - mob.x;
    const dy = target.y - mob.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    mob.x += (dx / d) * mob.speed * dtSeconds;
    mob.y += (dy / d) * mob.speed * dtSeconds + Math.sin(mob.wobble) * 4 * dtSeconds;
    if (d < 24 && now > target.invulnerableUntil) {
      target.health = Math.max(0, target.health - 12);
      target.lastDamageAt = now;
      target.invulnerableUntil = now + 650;
      mob.x -= (dx / d) * 34;
      mob.y -= (dy / d) * 34;
      if (target.health === 0) {
        target.health = 100;
        target.x = rand(390, 570);
        target.y = rand(210, 330);
        target.score = Math.max(0, target.score - 15);
        target.invulnerableUntil = now + 2400;
      }
    }
  }

  for (const projectile of [...room.projectiles]) {
    projectile.x += projectile.vx * dtSeconds;
    projectile.y += projectile.vy * dtSeconds;
    projectile.life -= dtSeconds;
    let hit = false;
    const player = room.players.get(projectile.ownerId);
    if (player) {
      for (const mob of [...room.mobs]) {
        if (Math.hypot(mob.x - projectile.x, mob.y - projectile.y) < projectile.radius + 13) {
          if (projectile.splash > 0) {
            for (const nearby of [...room.mobs]) {
              if (Math.hypot(nearby.x - projectile.x, nearby.y - projectile.y) <= projectile.splash) {
                nearby.hp -= projectile.damage;
                nearby.lastHitBy = player.id;
                if (nearby.hp <= 0) awardClean(room, nearby, player, nearby.kind === 2 ? 30 : nearby.kind === 1 ? 20 : 10);
              }
            }
          } else projectileHit(room, projectile, mob, player);
          hit = true;
          break;
        }
      }
    }
    if (hit || projectile.life <= 0 || projectile.x < -30 || projectile.x > WORLD.width + 30 || projectile.y < -30 || projectile.y > WORLD.height + 30) {
      room.projectiles = room.projectiles.filter(p => p.id !== projectile.id);
    }
  }
}

export function roomSnapshot(room) {
  return {
    type: 'state',
    roomCode: room.id,
    isPrivate: room.isPrivate,
    players: [...room.players.values()].map(p => ({
      id: p.id, nick: p.nick, x: Math.round(p.x), y: Math.round(p.y), angle: p.angle,
      tool: p.tool, score: p.score, health: p.health, color: p.color
    })),
    mobs: room.mobs.map(m => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y), kind: m.kind, hp: m.hp, maxHp: m.maxHp, wobble: m.wobble })),
    projectiles: room.projectiles.map(p => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y), radius: p.radius, tool: p.tool })),
    totalScore: [...room.players.values()].reduce((sum, p) => sum + p.score, 0),
    elapsed: Math.floor((Date.now() - room.startedAt) / 1000),
    tick: room.tick
  };
}
