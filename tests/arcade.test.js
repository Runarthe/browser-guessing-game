"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { RoomManager, GAME_STATES } = require("../src/roomManager");
const { GameManager } = require("../src/gameManager");

function harness(minPlayers = 2) {
  const events = [];
  const timers = new Map(); let nextTimer = 1;
  const rm = new RoomManager();
  const gm = new GameManager(rm, {
    emitRoom: (code, event, payload) => events.push({ event, payload }),
    minPlayersToStart: minPlayers,
    setTimer: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimer: (id) => timers.delete(id)
  });
  const last = (ev) => [...events].reverse().find((e) => e.event === ev);
  return { events, rm, gm, last, flushTimer: () => { const first = timers.entries().next().value; if(first){timers.delete(first[0]);first[1]();} } };
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
      room.curlingPlaybackUntil=0;
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

test("battle wheel rotates spinners and ends when a player reaches the win target", () => {
  const { rm, gm, last, flushTimer } = harness();
  const { room } = rm.createRoom("h", "Runar");
  rm.joinRoom("a", room.code, "Anna");
  rm.updateSettings(room, "h", {
    arcade: true,
    playlist: ["bomb", "curling"],
    rounds: 3,
    battleTarget: 3
  });

  assert.equal(gm.startGame(room, "h").ok, true);
  assert.equal(room.state, GAME_STATES.INTERMISSION);
  assert.equal(last("arcade:intermission").payload.spinnerId, "h");
  assert.equal(gm.spinBattleWheel(room, "a").ok, false);
  assert.equal(gm.spinBattleWheel(room, "h").ok, true);
  flushTimer();
  assert.equal(room.state, GAME_STATES.QUESTION);

  room.players.h.score += 100;
  gm.finishMode(room);
  assert.equal(room.state, GAME_STATES.INTERMISSION);
  assert.equal(room.arcade.wins.h, 1);
  assert.equal(last("arcade:intermission").payload.spinnerId, "a");
  assert.equal(gm.spinBattleWheel(room, "a").ok, true);
  flushTimer();
  room.players.h.score += 100;
  gm.finishMode(room);
  assert.equal(room.state, GAME_STATES.INTERMISSION);
  assert.equal(room.arcade.wins.h, 2);
  assert.equal(last("arcade:intermission").payload.spinnerId, "h");
  assert.equal(gm.spinBattleWheel(room, "h").ok, true);
  flushTimer();
  room.players.h.score += 100;
  gm.finishMode(room);
  assert.equal(room.state, GAME_STATES.FINISHED);
  const fin = last("game:finished").payload;
  assert.equal(fin.battle, true);
  assert.equal(fin.winner.playerId, "h");
  assert.equal(fin.winner.score, 3);
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
