"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const MI = require(path.join(__dirname, "..", "public", "modeInfo.js"));
const { GAME_MODES, defaultSettings } = (() => {
  const rm = require(path.join(__dirname, "..", "src", "roomManager.js"));
  return { GAME_MODES: rm.GAME_MODES, defaultSettings: null };
})();

test("modeInfo: every game mode has metadata", () => {
  // A mode without an entry silently falls back to "fits everything", which
  // would quietly undo the whole point of this table.
  const missing = GAME_MODES.filter((m) => !MI.MODES[m]);
  assert.deepEqual(missing, [], `modes missing metadata: ${missing.join(", ")}`);
});

test("modeInfo: role-split modes enforce their structural minimum", () => {
  // These are broken below 3, not merely less fun: a drawer needs guessers,
  // Hide and Go BOOM! needs a solo player opposite a team, Red Light needs
  // someone holding the light.
  for (const mode of ["drawing", "hidebomb", "redlight"]) {
    assert.equal(MI.forMode(mode).min, 3, `${mode} needs 3`);
    assert.equal(MI.fitFor(mode, 2), "too-few", `${mode} rejects 2 players`);
    assert.match(MI.hintFor(mode, 2), /needs 3/i);
  }
});

test("modeInfo: ranges are internally consistent", () => {
  for (const [id, m] of Object.entries(MI.MODES)) {
    assert.ok(m.min >= 2, `${id} min is at least 2`);
    assert.ok(m.max <= 8, `${id} max is within room capacity`);
    assert.ok(m.bestFrom >= m.min, `${id} bestFrom not below min`);
    assert.ok(m.bestTo <= m.max, `${id} bestTo not above max`);
    assert.ok(m.bestFrom <= m.bestTo, `${id} best range is not inverted`);
  }
});

test("modeInfo: fit reflects the playtest findings", () => {
  // Territory Painter was the weakest mode with a small group and is a
  // territory race, so it should not be recommended to three people.
  assert.equal(MI.fitFor("painter", 3), "ok");
  assert.equal(MI.fitFor("painter", 6), "great");
  assert.match(MI.hintFor("painter", 3), /better with 5/i);

  // Pocket Racers tested well at 2.
  assert.equal(MI.fitFor("racing", 2), "great");
  // The knowledge games carried the session and suit most group sizes.
  for (const mode of ["map", "timeline", "trivia", "bomb"]) {
    assert.equal(MI.fitFor(mode, 4), "great", `${mode} great at 4`);
  }
});

test("modeInfo: sorting floats well-suited modes to the top", () => {
  const modes = ["painter", "drawing", "racing", "map"];
  const small = MI.sortByFit(modes, 2);
  assert.ok(small.indexOf("racing") < small.indexOf("painter"), "racing before painter at 2");
  assert.equal(small[small.length - 1], "drawing", "unplayable mode sinks to the bottom");

  const big = MI.sortByFit(modes, 7);
  assert.ok(big.indexOf("painter") < big.indexOf("racing"), "painter rises with a crowd");
});

test("modeInfo: recommendations suit the room and never include broken modes", () => {
  for (const players of [2, 3, 4, 6, 8]) {
    const list = MI.recommendedPlaylist(players);
    assert.ok(list.length >= 4, `${players} players gets a usable playlist (${list.length})`);
    for (const mode of list) {
      assert.notEqual(MI.fitFor(mode, players), "too-few",
        `${mode} should not be recommended for ${players}`);
    }
  }
  // Two players must not be handed the crowd-hungry modes.
  const duo = MI.recommendedPlaylist(2);
  for (const mode of ["painter", "drawing", "hidebomb", "redlight"]) {
    assert.ok(!duo.includes(mode), `${mode} kept out of the 2-player recommendation`);
  }
});

test("modeInfo: the stock playlist leads with the well-received modes", () => {
  // Regression guard: the default previously omitted four of the six modes
  // that tested best, and included the one that tested worst.
  const rm = require(path.join(__dirname, "..", "src", "roomManager.js"));
  const room = new rm.RoomManager().createRoom("s1", "Runar").room;
  const list = room.settings.playlist;
  for (const winner of ["map", "timeline", "trivia", "fire", "pong", "bomb"]) {
    assert.ok(list.includes(winner), `${winner} is in the default playlist`);
  }
  assert.ok(!list.includes("painter"), "the weakest mode is not a default");
  for (const mode of list) assert.ok(MI.MODES[mode], `${mode} is a known mode`);
});

test("modeInfo: party-size buckets are sensible", () => {
  assert.equal(MI.partySize("painter"), "big");
  assert.equal(MI.partySize("racing"), "small");
  assert.equal(MI.partySize("trivia"), "any");
});
