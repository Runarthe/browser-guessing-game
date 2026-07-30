"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { RoomManager, GAME_STATES } = require("../src/roomManager");
const { GameManager } = require("../src/gameManager");

function harness(minPlayers = 2) {
  const events = [];
  const rm = new RoomManager();
  const gm = new GameManager(rm, {
    emitRoom: (code, event, payload) => events.push({ event, payload }),
    minPlayersToStart: minPlayers,
    setTimer: () => 0,
    clearTimer: () => {}
  });
  const last = (ev) => [...events].reverse().find((e) => e.event === ev);
  return { events, rm, gm, last };
}

/** Play whatever mode is currently active to its conclusion (one leg). */
function playCurrentMode(gm, room, rm) {
  let guard = 0;
  const startState = room.state;
  while (room.state === GAME_STATES.QUESTION && guard++ < 3000) {
    const mode = gm.mode(room);
    if (mode === "bomb") {
      const id = room.turnOrder[room.turnIndex % room.turnOrder.length];
      gm.bombPress(room, id, 1);
    } else if (mode === "curling") {
      const id = room.turnOrder[room.turnIndex];
      if (!id) break;
      gm.submitGuess(room, id, 100 + guard);
    } else if (mode === "timeline") {
      const id = room.turnOrder[room.turnIndex % room.turnOrder.length];
      const p = room.players[id];
      const sorted = p.cards.slice().sort((a, b) => a.year - b.year);
      const yr = room.currentCard.year;
      let slot = sorted.findIndex((c) => yr <= c.year);
      if (slot === -1) slot = sorted.length;
      gm.timelinePlace(room, id, slot);
    } else {
      for (const pid of Object.keys(room.players)) {
        if (room.players[pid].guess === null) gm.submitGuess(room, pid, 1000 + guard * 7);
      }
    }
    // Round-based modes pause at RESULTS between rounds; host advances.
    if (room.state === GAME_STATES.RESULTS) gm.nextRound(room, room.hostId);
  }
  return startState;
}

test("settings validation keeps only valid playlist modes", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("h", "Runar");
  rm.updateSettings(room, "h", { arcade: true, playlist: ["bomb", "nope", "curling"] });
  assert.equal(room.settings.arcade, true);
  assert.deepEqual(room.settings.playlist, ["bomb", "curling"]);
});

test("arcade plays each leg, keeps scores, and pauses on intermissions", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("h", "Runar");
  rm.joinRoom("a", room.code, "Anna");
  rm.updateSettings(room, "h", {
    arcade: true,
    playlist: ["bomb", "curling", "timeline"],
    rounds: 3,
    target: 5
  });

  assert.equal(gm.startGame(room, "h").ok, true);
  assert.equal(room.arcade.playlist.length, 3);
  assert.equal(gm.mode(room), "bomb");

  // Leg 1 (bomb) -> intermission.
  playCurrentMode(gm, room, rm);
  assert.equal(room.state, GAME_STATES.INTERMISSION);
  const inter1 = last("arcade:intermission").payload;
  assert.equal(inter1.nextMode, "curling");
  const scoreAfterLeg1 = room.players["h"].score + room.players["a"].score;

  // Host advances -> leg 2 (curling). Non-host cannot.
  assert.equal(gm.startNextLeg(room, "a").ok, false);
  assert.equal(gm.startNextLeg(room, "h").ok, true);
  assert.equal(gm.mode(room), "curling");
  // Scores carried over (only grow).
  assert.ok(room.players["h"].score + room.players["a"].score >= scoreAfterLeg1);

  playCurrentMode(gm, room, rm);
  assert.equal(room.state, GAME_STATES.INTERMISSION);
  assert.equal(last("arcade:intermission").payload.nextMode, "timeline");
  gm.startNextLeg(room, "h");
  assert.equal(gm.mode(room), "timeline");

  // Final leg (timeline) -> grand finish.
  playCurrentMode(gm, room, rm);
  assert.equal(room.state, GAME_STATES.FINISHED);
  const fin = last("game:finished").payload;
  assert.equal(fin.arcade, true);
  assert.equal(fin.standings.length, 2);
});

test("non-arcade single mode still finishes directly (no intermission)", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("h", "Runar");
  rm.joinRoom("a", room.code, "Anna");
  rm.updateSettings(room, "h", { mode: "bomb", arcade: false, rounds: 3 });
  gm.startGame(room, "h");
  playCurrentMode(gm, room, rm);
  assert.equal(room.state, GAME_STATES.FINISHED);
});
