import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoom, createPlayer, updateRoom, roomSnapshot, cleanNick } from '../server/game.js';

test('nickname is sanitized and limited to 16 characters', () => {
  assert.equal(cleanNick('  Osvaldo <script>  '), 'Osvaldo script');
  assert.equal(cleanNick(''), 'Faxineiro');
  assert.equal(cleanNick('abcdefghijklmnopq'), 'abcdefghijklmnop');
});

test('room stores players and snapshot exposes safe public data', () => {
  const room = createRoom('ABCDE', true, 4);
  const player = createPlayer('player-1', 'Seu Osvaldo');
  room.players.set(player.id, player);
  const snapshot = roomSnapshot(room);
  assert.equal(snapshot.roomCode, 'ABCDE');
  assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.players[0].nick, 'Seu Osvaldo');
  assert.equal('input' in snapshot.players[0], false);
});

test('server accepts normalized movement and updates player position', () => {
  const room = createRoom('ABCDE', false, 4);
  const player = createPlayer('player-1', 'Osvaldo');
  player.x = 400; player.y = 250;
  player.input = { x: 1, y: 0, aimX: 0, aimY: 1, fire: false };
  room.players.set(player.id, player);
  updateRoom(room, 0.05, Date.now());
  assert.ok(player.x > 400);
  assert.equal(player.y, 250);
  assert.equal(player.angle, Math.PI / 2);
});

test('foam tool creates server-side cleaning projectile', () => {
  const room = createRoom('ABCDE', false, 4);
  const player = createPlayer('player-1', 'Osvaldo');
  player.x = 400; player.y = 250;
  player.input = { x: 0, y: 0, aimX: 1, aimY: 0, fire: true };
  room.players.set(player.id, player);
  updateRoom(room, 0.05, Date.now());
  assert.equal(room.projectiles.length, 1);
  assert.equal(room.projectiles[0].ownerId, player.id);
});
