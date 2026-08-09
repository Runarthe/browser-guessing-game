"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RoomManager,
  GAME_STATES,
  ROOM_CODE_LENGTH,
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_GRACE_MS
} = require("../src/roomManager");

test("creates a six-character room code", () => {
  const rm = new RoomManager();
  const { ok, room } = rm.createRoom("s1", "Runar");
  assert.ok(ok);
  assert.equal(room.code.length, ROOM_CODE_LENGTH);
  // No confusing characters.
  assert.match(room.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
});

test("prevents duplicate room codes", () => {
  const rm = new RoomManager();
  const seen = new Set();
  // Force generateRoomCode to run many times; codes must be unique.
  for (let i = 0; i < 200; i++) {
    const { room } = rm.createRoom("s" + i, "Player" + i);
    assert.ok(!seen.has(room.code), "duplicate code generated");
    seen.add(room.code);
  }
});

test("rejects missing player names", () => {
  const rm = new RoomManager();
  assert.equal(rm.createRoom("s1", "").ok, false);
  assert.equal(rm.createRoom("s1", "  ").ok, false);
  assert.equal(rm.createRoom("s1", "a").ok, false); // too short
  assert.equal(rm.createRoom("s1", undefined).ok, false);
  assert.equal(rm.createRoom("s1", "x".repeat(21)).ok, false); // too long
});

test("rejects duplicate names in a room", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Anna");
  const join = rm.joinRoom("s2", room.code, "anna"); // case-insensitive
  assert.equal(join.ok, false);
  assert.match(join.error, /taken/i);
});

test("rejects invalid room codes on join", () => {
  const rm = new RoomManager();
  const join = rm.joinRoom("s2", "ZZZZZZ", "Erik");
  assert.equal(join.ok, false);
  assert.match(join.error, /not found/i);
});

test("trims whitespace from names", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "  Runar  ");
  assert.equal(room.players["s1"].name, "Runar");
});

test("joins an existing room and lists both players", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  assert.equal(Object.keys(room.players).length, 2);
  assert.equal(room.state, GAME_STATES.LOBBY);
});

test("cannot join a room that already started", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  room.state = GAME_STATES.QUESTION;
  const join = rm.joinRoom("s2", room.code, "Anna");
  assert.equal(join.ok, false);
});

test("pressing Leave in the lobby gives up the seat immediately", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.removePlayer("s2", room.code, { explicit: true });
  assert.equal(room.players["s2"], undefined);
});

test("a dropped lobby connection holds the seat for the grace period", () => {
  // A phone locking its screen should not cost you your place in the lobby.
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.removePlayer("s2", room.code);              // dropped, not explicit
  assert.equal(room.players["s2"].connected, false, "seat is held");
  assert.ok(room.players["s2"].disconnectedAt, "drop time recorded");

  // Still held just before the deadline...
  rm.cleanupInactiveRooms(Date.now() + DISCONNECT_GRACE_MS - 1000);
  assert.ok(room.players["s2"], "seat survives inside the grace period");

  // ...and released after it.
  const { changed } = rm.cleanupInactiveRooms(Date.now() + DISCONNECT_GRACE_MS + 1000);
  assert.equal(room.players["s2"], undefined, "seat released once grace lapses");
  assert.deepEqual(changed, [room.code], "caller is told to re-broadcast");
});

test("rejoining inside the grace period restores the seat", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  const join = rm.joinRoom("s2", room.code, "Anna");
  const token = join.room.players["s2"].token;
  rm.removePlayer("s2", room.code);
  const back = rm.rejoinRoom("s2-new", room.code, token);
  assert.equal(back.ok, true);
  assert.equal(room.players["s2-new"].connected, true);
  assert.equal(room.players["s2-new"].disconnectedAt, null, "grace timer cleared");
  // The seat must now survive a sweep that would have expired it.
  rm.cleanupInactiveRooms(Date.now() + DISCONNECT_GRACE_MS + 1000);
  assert.ok(room.players["s2-new"], "reconnected player is not swept");
});

test("keeps disconnected player and score during a game", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.state = GAME_STATES.QUESTION;
  room.players["s2"].score = 60;
  rm.removePlayer("s2", room.code);
  assert.equal(room.players["s2"].connected, false);
  assert.equal(room.players["s2"].score, 60);
  assert.equal(room.players["s2"].guess, null);
});

test("transfers host after host disconnect", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar"); // s1 host
  rm.joinRoom("s2", room.code, "Anna");
  const res = rm.removePlayer("s1", room.code);
  assert.equal(res.hostChanged, true);
  assert.equal(room.hostId, "s2");
});

test("an emptied room is held briefly, then removed", () => {
  // A total blip (router reset, host backgrounding the app) should not destroy
  // a game everyone is about to come back to.
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  const code = room.code;
  const res = rm.removePlayer("s1", code);
  assert.equal(res.empty, true, "reported empty rather than deleted");
  assert.equal(res.deleted, false);
  assert.ok(rm.getRoom(code), "room still exists during the grace period");

  rm.cleanupInactiveRooms(Date.now() + EMPTY_ROOM_GRACE_MS - 1000);
  assert.ok(rm.getRoom(code), "survives inside the grace period");

  const { removed } = rm.cleanupInactiveRooms(Date.now() + EMPTY_ROOM_GRACE_MS + 1000);
  assert.equal(removed, 1);
  assert.equal(rm.getRoom(code), null, "removed once nobody returned");
});

test("returning to an emptied room cancels its removal", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  const token = room.players["s1"].token;
  rm.removePlayer("s1", room.code);
  assert.ok(room.emptySince, "grace clock started");

  const back = rm.rejoinRoom("s1-new", room.code, token);
  assert.equal(back.ok, true);
  assert.equal(room.emptySince, null, "grace clock cleared on return");
  const { removed } = rm.cleanupInactiveRooms(Date.now() + EMPTY_ROOM_GRACE_MS + 1000);
  assert.equal(removed, 0, "an occupied room is not swept");
});

test("cleans up inactive rooms after the TTL", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  room.lastActivity = Date.now() - (61 * 60 * 1000); // 61 minutes ago
  const { removed } = rm.cleanupInactiveRooms();
  assert.equal(removed, 1);
  assert.equal(rm.getRoom(room.code), null);
});
