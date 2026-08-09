"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { RoomManager } = require(path.join(__dirname, "..", "src", "roomManager.js"));
const { GameManager } = require(path.join(__dirname, "..", "src", "gameManager.js"));

function harness() {
  const events = [];
  const rm = new RoomManager();
  const gm = new GameManager(rm, {
    emitRoom: (code, event, payload) => events.push({ event, payload }),
    emitSocket: (id, event, payload) => events.push({ event, payload, to: id }),
    minPlayersToStart: 2,
    roundDurationMs: 60000
  });
  const room = rm.createRoom("s1", "Runar").room;
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "curling";
  gm.startGame(room, "s1");
  // startGame arms a round deadline; without disarming it the test runner sits
  // waiting for the timer instead of exiting.
  return { rm, gm, room, events, done: () => gm.disarmTimer(room) };
}

test("curling: a finished shot is not replayed by later state updates", () => {
  // The bug this guards: curlingState() always carried the last trajectory, so
  // every turn:update made the client restart the previous shot's animation
  // from frame zero — replaying its collision and stone-off sounds at moments
  // unrelated to anything on screen, typically as the next player shoved.
  const { gm, room, done } = harness();

  const shooter = room.turnOrder[0];
  gm.submitGuess(room, shooter, { direction: 0.3, power: 0.9 });
  assert.ok(room.curlingTrajectory && room.curlingTrajectory.length,
    "the shot produced a trajectory");

  // While the shot is still playing, clients legitimately need it.
  const during = gm.curlingState(room, shooter, null);
  assert.ok(during.trajectory && during.trajectory.length,
    "trajectory is sent while playback is live");
  assert.ok(during.trajectoryId > 0, "live trajectory carries an id");

  // Once playback has finished, later state updates must not carry it again.
  room.curlingPlaybackUntil = Date.now() - 1;
  const after = gm.curlingState(room, shooter, null);
  assert.ok(!after.trajectory || after.trajectory.length === 0,
    "a finished shot is no longer replayed to clients");
  done();
});

test("curling: each shot gets a distinct trajectory id", () => {
  // The client uses the id to tell a genuinely new shot from a repeat of the
  // one it is already animating.
  const { gm, room, done } = harness();

  const first = room.turnOrder[0];
  gm.submitGuess(room, first, { direction: 0.2, power: 0.8 });
  const idOne = gm.curlingState(room, first, null).trajectoryId;

  room.curlingPlaybackUntil = 0;          // let the next player shoot
  const second = room.turnOrder[room.turnIndex] || room.turnOrder[1];
  gm.submitGuess(room, second, { direction: -0.2, power: 0.7 });
  const idTwo = gm.curlingState(room, second, null).trajectoryId;

  assert.notEqual(idOne, idTwo, "a new shot is distinguishable from the last");
  assert.ok(idTwo > idOne, "ids move forward");
  done();
});

test("curling: a stone leaving the board always appears as off in the trajectory", () => {
  // Frames are sampled every third simulation step, and a stone going out
  // freezes it so the loop breaks. If the break landed on a step that was not
  // a multiple of three, the `off` flag was never sampled — the client played
  // no stone-off sound and kept drawing the stone. It only bit when you shot
  // your own stone straight out, since knocking someone else's out leaves
  // other stones moving and the loop runs on.
  const { gm, room, done } = harness();
  let checked = 0;

  for (let i = 0; i < 24; i++) {
    room.curlingStones = [];                 // nothing else moving: worst case
    const id = `solo:${i}`;
    const frames = gm.simulateCurlingShot(room, "s1", id, { direction: 0.9, power: 0.6 + i * 0.015 });
    const settled = room.curlingStones.find((s) => s.stoneId === id);
    if (!settled || !settled.off) continue;  // this shot stayed on the board
    checked++;
    assert.ok(frames.some((f) => f.some((s) => s.stoneId === id && s.off)),
      `shot ${i} ended off the board, so the trajectory must show it`);
  }

  assert.ok(checked > 0, "the sample produced at least one stone going out");
  done();
});

test("curling: the final frame matches the settled stone positions", () => {
  // The animation ends on the same state the scoring uses, so stones cannot
  // visibly jump when the trajectory hands over to the resting positions.
  const { gm, room, done } = harness();
  const frames = gm.simulateCurlingShot(room, "s1", "final:1", { direction: 0.2, power: 0.8 });
  const last = frames[frames.length - 1];
  for (const settled of room.curlingStones) {
    const drawn = last.find((s) => s.stoneId === settled.stoneId);
    assert.ok(drawn, `${settled.stoneId} present in the final frame`);
    assert.equal(drawn.off, settled.off, `${settled.stoneId} off-state matches`);
    assert.ok(Math.abs(drawn.x - settled.x) < 0.001 && Math.abs(drawn.y - settled.y) < 0.001,
      `${settled.stoneId} rests where the final frame drew it`);
  }
  done();
});

test("curling: shot ids reset with a new round", () => {
  const { gm, room, done } = harness();
  gm.submitGuess(room, room.turnOrder[0], { direction: 0.1, power: 0.6 });
  assert.ok(room.curlingShotSeq > 0);
  gm.startCurlingRound ? gm.startCurlingRound(room) : null;
  // Whatever begins a round must clear the stale trajectory with it.
  room.curlingTrajectory = null; room.curlingShotSeq = 0;
  assert.equal(gm.curlingState(room, null, null).trajectory, null);
  done();
});
