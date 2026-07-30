"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { calculateRoundScores } = require("../src/scoring");

test("calculates absolute distance correctly", () => {
  const scored = calculateRoundScores(
    [{ id: "a", guess: 90 }, { id: "b", guess: 130 }],
    100
  );
  const a = scored.find((s) => s.playerId === "a");
  const b = scored.find((s) => s.playerId === "b");
  assert.equal(a.distance, 10);
  assert.equal(b.distance, 30);
});

test("ranks closest guesses first", () => {
  const scored = calculateRoundScores(
    [
      { id: "far", guess: 900 },
      { id: "close", guess: 1800 },
      { id: "mid", guess: 2500 }
    ],
    1752
  );
  assert.deepEqual(scored.map((s) => s.playerId), ["close", "mid", "far"]);
});

test("awards correct points (100/60/30/10)", () => {
  const scored = calculateRoundScores(
    [
      { id: "p1", guess: 10 },
      { id: "p2", guess: 20 },
      { id: "p3", guess: 30 },
      { id: "p4", guess: 40 }
    ],
    0
  );
  const byId = Object.fromEntries(scored.map((s) => [s.playerId, s.pointsAwarded]));
  assert.equal(byId.p1, 100);
  assert.equal(byId.p2, 60);
  assert.equal(byId.p3, 30);
  assert.equal(byId.p4, 10);
});

test("handles tied guesses correctly (equal distance = equal points)", () => {
  // Correct 100, A=90 and B=110 both 10 away -> both first place.
  const scored = calculateRoundScores(
    [{ id: "A", guess: 90 }, { id: "B", guess: 110 }],
    100
  );
  assert.equal(scored[0].pointsAwarded, 100);
  assert.equal(scored[1].pointsAwarded, 100);
});

test("tie for first pushes the next distinct distance to third place", () => {
  // Two tied at first (rank 0 -> 100). Next player is rank index 2 -> 30.
  const scored = calculateRoundScores(
    [
      { id: "A", guess: 90 },
      { id: "B", guess: 110 },
      { id: "C", guess: 150 }
    ],
    100
  );
  const byId = Object.fromEntries(scored.map((s) => [s.playerId, s.pointsAwarded]));
  assert.equal(byId.A, 100);
  assert.equal(byId.B, 100);
  assert.equal(byId.C, 30);
});

test("excludes players with no answer from ranking", () => {
  const scored = calculateRoundScores(
    [
      { id: "answered", guess: 50 },
      { id: "skipped", guess: null }
    ],
    50
  );
  assert.equal(scored.length, 1);
  assert.equal(scored[0].playerId, "answered");
});

test("ignores non-finite guesses", () => {
  const scored = calculateRoundScores(
    [
      { id: "ok", guess: 5 },
      { id: "nan", guess: NaN },
      { id: "inf", guess: Infinity }
    ],
    5
  );
  assert.equal(scored.length, 1);
  assert.equal(scored[0].playerId, "ok");
});

test("supports decimal guesses", () => {
  const scored = calculateRoundScores(
    [{ id: "a", guess: 3.14 }, { id: "b", guess: 3.2 }],
    3.14159
  );
  assert.deepEqual(scored.map((s) => s.playerId), ["a", "b"]);
});
