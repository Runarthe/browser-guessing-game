"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { RoomManager, GAME_STATES } = require("../src/roomManager");
const { GameManager } = require("../src/gameManager");
const { toPublicQuestion } = require("../src/questionManager");

/** Build a room + manager with captured emissions and a manual timer. */
function setup(minPlayers = 2) {
  const rm = new RoomManager();
  const emitted = [];
  const timers = [];
  const gm = new GameManager(rm, {
    emitRoom: (code, event, payload) => emitted.push({ code, event, payload }),
    minPlayersToStart: minPlayers,
    // Manual timer: capture the callback instead of using real time.
    setTimer: (fn) => { timers.push(fn); return timers.length - 1; },
    clearTimer: () => {},
    roundDurationMs: 30000,
    roundCountdownMs: 0
  });
  const last = (event) => [...emitted].reverse().find((e) => e.event === event);
  return { rm, gm, emitted, timers, last };
}

test("prevents non-hosts from starting", () => {
  const { rm, gm } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  const res = gm.startGame(room, "guest");
  assert.equal(res.ok, false);
  assert.match(res.error, /host/i);
});

test("shows a three-second countdown before the next round", () => {
  const rm = new RoomManager(), emitted = [], timers = [];
  const gm = new GameManager(rm, {
    emitRoom: (code, event, payload) => emitted.push({ code, event, payload }),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; },
    clearTimer: () => {}, roundCountdownMs: 3000
  });
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  gm.startGame(room, "host");
  gm.submitGuess(room, "host", room.currentQuestion.answer);
  gm.submitGuess(room, "guest", room.currentQuestion.answer + 1);

  assert.equal(gm.nextRound(room, "host").ok, true);
  assert.equal(room.state, GAME_STATES.RESULTS);
  assert.equal(room.roundIndex, 0);
  const countdown = emitted.findLast((e) => e.event === "round:countdown");
  assert.equal(countdown.payload.roundNumber, 2);
  assert.equal(timers.at(-1).ms, 3000);
  timers.at(-1).fn();
  assert.equal(room.state, GAME_STATES.QUESTION);
  assert.equal(room.roundIndex, 1);
});

test("prevents starting with too few players", () => {
  const { rm, gm } = setup(2);
  const { room } = rm.createRoom("host", "Runar");
  const res = gm.startGame(room, "host");
  assert.equal(res.ok, false);
  assert.match(res.error, /at least/i);
});

test("allows starting with one player when configured (test mode)", () => {
  const { rm, gm } = setup(1);
  const { room } = rm.createRoom("host", "Runar");
  const res = gm.startGame(room, "host");
  assert.equal(res.ok, true);
  assert.equal(room.state, GAME_STATES.QUESTION);
});

test("does not expose correct answers during a round", () => {
  const { rm, gm, last } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  gm.startGame(room, "host");

  const q = last("round:question");
  assert.ok(q, "round:question was emitted");
  assert.equal("answer" in q.payload.question, false, "public question leaks answer");
  // Sanity: the public projection helper also strips it.
  assert.equal("answer" in toPublicQuestion(room.currentQuestion), false);
});

test("accepts one numerical guess per player and rejects duplicates", () => {
  const { rm, gm } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  gm.startGame(room, "host");

  const first = gm.submitGuess(room, "host", 100);
  assert.equal(first.ok, true);
  assert.equal(room.players["host"].guess, 100);

  const dup = gm.submitGuess(room, "host", 200);
  assert.equal(dup.ok, false);
  assert.match(dup.error, /already/i);
  assert.equal(room.players["host"].guess, 100, "guess must not change");
});

test("rejects guesses outside the question state", () => {
  const { rm, gm } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  // Still in lobby.
  const res = gm.submitGuess(room, "host", 100);
  assert.equal(res.ok, false);
});

test("rejects non-numeric and out-of-range guesses", () => {
  const { rm, gm } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  gm.startGame(room, "host");
  assert.equal(gm.submitGuess(room, "host", "abc").ok, false);
  assert.equal(gm.submitGuess(room, "host", 1e15).ok, false);
});

test("reveals results once every connected player submits", () => {
  const { rm, gm, last } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  gm.startGame(room, "host");

  gm.submitGuess(room, "host", 10);
  assert.equal(room.state, GAME_STATES.QUESTION, "not revealed until all submit");
  gm.submitGuess(room, "guest", 20);
  assert.equal(room.state, GAME_STATES.RESULTS);
  assert.ok(last("round:results"));
});

test("timer expiry reveals results even without all guesses", () => {
  const { rm, gm, timers } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  gm.startGame(room, "host");

  gm.submitGuess(room, "host", 10); // only one submits
  assert.equal(room.state, GAME_STATES.QUESTION);
  // Fire the captured round timer callback.
  timers[timers.length - 1]();
  assert.equal(room.state, GAME_STATES.RESULTS);
});

test("advances through five rounds and identifies final winner", () => {
  const { rm, gm, last } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  gm.startGame(room, "host");

  for (let r = 0; r < room.totalRounds; r++) {
    assert.equal(room.state, GAME_STATES.QUESTION);
    assert.equal(room.roundIndex, r);
    // host guesses exactly right, guest far off — host should win every round.
    gm.submitGuess(room, "host", room.currentQuestion.answer);
    gm.submitGuess(room, "guest", room.currentQuestion.answer + 100000);
    assert.equal(room.state, GAME_STATES.RESULTS);

    if (r < room.totalRounds - 1) {
      const res = gm.nextRound(room, "host");
      assert.equal(res.ok, true);
    }
  }

  // Final advance -> finished.
  gm.nextRound(room, "host");
  assert.equal(room.state, GAME_STATES.FINISHED);

  const finished = last("game:finished");
  assert.ok(finished);
  assert.equal(finished.payload.winner.playerId, "host");
  assert.equal(finished.payload.winner.score, 500); // 100 * 5 rounds
});

test("single-round standalone game reaches final results with one advance", () => {
  const { rm, gm, emitted } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  room.settings.rounds = 1;
  gm.startGame(room, "host");

  gm.submitGuess(room, "host", room.currentQuestion.answer);
  gm.submitGuess(room, "guest", room.currentQuestion.answer + 1000);
  assert.equal(room.state, GAME_STATES.RESULTS);

  const advance = gm.nextRound(room, "host");
  assert.equal(advance.ok, true);
  assert.equal(room.state, GAME_STATES.FINISHED);
  assert.equal(emitted.filter((entry) => entry.event === "game:finished").length, 1);

  const repeated = gm.nextRound(room, "host");
  assert.equal(repeated.ok, false);
  assert.equal(emitted.filter((entry) => entry.event === "game:finished").length, 1);
});

test("non-host cannot advance the round", () => {
  const { rm, gm } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  gm.startGame(room, "host");
  gm.submitGuess(room, "host", 1);
  gm.submitGuess(room, "guest", 2);
  const res = gm.nextRound(room, "guest");
  assert.equal(res.ok, false);
});

test("restart returns the room to a fresh lobby", () => {
  const { rm, gm } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  gm.startGame(room, "host");
  gm.submitGuess(room, "host", 1);
  gm.submitGuess(room, "guest", 2);

  gm.restartGame(room, "host");
  assert.equal(room.state, GAME_STATES.LOBBY);
  assert.equal(room.roundIndex, 0);
  assert.equal(room.players["host"].score, 0);
  assert.equal(room.players["guest"].guess, null);
});

test("rematch starts a fresh game with the same lobby and settings", () => {
  const { rm, gm } = setup();
  const { room } = rm.createRoom("host", "Runar");
  rm.joinRoom("guest", room.code, "Anna");
  room.settings.rounds = 1;
  gm.startGame(room, "host");
  gm.submitGuess(room, "host", room.currentQuestion.answer);
  gm.submitGuess(room, "guest", room.currentQuestion.answer + 10);
  gm.nextRound(room, "host");

  assert.equal(room.state, GAME_STATES.FINISHED);
  const players = Object.keys(room.players);
  const settings = { ...room.settings };
  assert.equal(gm.rematchGame(room, "host").ok, true);
  assert.equal(room.state, GAME_STATES.QUESTION);
  assert.deepEqual(Object.keys(room.players), players);
  assert.deepEqual(room.settings, settings);
  assert.equal(room.players.host.score, 0);
});
