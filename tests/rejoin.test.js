"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { RoomManager, GAME_STATES } = require("../src/roomManager");

test("assigns a stable token to each player", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  const token = room.players["s1"].token;
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);
  // Tokens are unique per player.
  rm.joinRoom("s2", room.code, "Anna");
  assert.notEqual(room.players["s1"].token, room.players["s2"].token);
});

test("rejoin re-keys a player under a new socket id and preserves score", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.state = GAME_STATES.QUESTION;
  room.players["s2"].score = 90;
  const token = room.players["s2"].token;

  // s2 "disconnects" mid-game (marked disconnected, score retained).
  rm.removePlayer("s2", room.code);
  assert.equal(room.players["s2"].connected, false);

  // s2 refreshes and comes back as socket "s2b".
  const res = rm.rejoinRoom("s2b", room.code, token);
  assert.equal(res.ok, true);
  assert.equal(room.players["s2"], undefined);
  assert.equal(room.players["s2b"].name, "Anna");
  assert.equal(room.players["s2b"].score, 90);
  assert.equal(room.players["s2b"].connected, true);
  assert.equal(room.players["s2b"].id, "s2b");
});

test("rejoin restores host status to the reconnecting host", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar"); // host
  rm.joinRoom("s2", room.code, "Anna");
  const hostToken = room.players["s1"].token;

  const res = rm.rejoinRoom("s1b", room.code, hostToken);
  assert.equal(res.ok, true);
  assert.equal(res.wasHost, true);
  assert.equal(room.hostId, "s1b");
});

test("rejoin fails for an unknown token", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  const res = rm.rejoinRoom("s9", room.code, "not-a-real-token");
  assert.equal(res.ok, false);
  assert.match(res.error, /rejoin|expired/i);
});

test("rejoin fails for a missing room", () => {
  const rm = new RoomManager();
  const res = rm.rejoinRoom("s9", "ZZZZZZ", "whatever");
  assert.equal(res.ok, false);
  assert.match(res.error, /not found/i);
});
