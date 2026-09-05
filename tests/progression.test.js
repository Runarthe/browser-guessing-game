"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const P = require(path.join(__dirname, "..", "public", "progression.js"));
const { validateAvatar, AVATAR_EMOJIS, AVATAR_COLORS, MAX_PLAYERS } = require(path.join(__dirname, "..", "src", "roomManager.js"));

const stats = (over = {}) => ({
  gamesPlayed: 0, gamesWon: 0, modeWins: {}, modePlays: {}, bestStreak: 0, ...over
});

test("progression: base cosmetics are always available", () => {
  const c = P.catalogue(stats());
  assert.equal(c.emojis.slice(0, 16).every((e) => e.unlocked), true);
  assert.equal(c.colors.slice(0, 8).every((x) => x.unlocked), true);
  assert.equal(c.titles.find((t) => t.id === "none").unlocked, true);
  assert.equal(c.frames.find((f) => f.id === "none").unlocked, true);
});

test("progression: unlocks respond to the right stat", () => {
  assert.equal(P.meets({ kind: "gamesPlayed", n: 3 }, stats({ gamesPlayed: 2 })), false);
  assert.equal(P.meets({ kind: "gamesPlayed", n: 3 }, stats({ gamesPlayed: 3 })), true);
  assert.equal(P.meets({ kind: "gamesWon", n: 5 }, stats({ gamesWon: 5 })), true);
  assert.equal(P.meets({ kind: "streak", n: 3 }, stats({ bestStreak: 4 })), true);
  assert.equal(P.meets({ kind: "modeWins", mode: "vanish", n: 3 }, stats({ modeWins: { vanish: 3 } })), true);
  assert.equal(P.meets({ kind: "modeWins", mode: "vanish", n: 3 }, stats({ modeWins: { racing: 9 } })), false);
});

test("progression: distinctModeWins counts modes, not wins", () => {
  const many = stats({ modeWins: { vanish: 50 } });
  assert.equal(P.meets({ kind: "distinctModeWins", n: 3 }, many), false, "50 wins in one mode is still one mode");
  const spread = stats({ modeWins: { vanish: 1, racing: 1, pong: 1 } });
  assert.equal(P.meets({ kind: "distinctModeWins", n: 3 }, spread), true);
});

test("progression: a strong player unlocks strictly more than a new one", () => {
  const rookie = P.progressSummary(stats());
  const pro = P.progressSummary(stats({
    gamesPlayed: 40, gamesWon: 30, bestStreak: 6,
    modeWins: { vanish: 5, racing: 5, doors: 5, pong: 5, flappy: 5, painter: 5, fire: 5, golf: 5, colorfloor: 2, pushy: 1, bomb: 1 },
    modePlays: { bomb: 12, pushy: 12, colorfloor: 12, flappy: 12, hidebomb: 12, doors: 12 }
  }));
  assert.ok(pro.unlocked > rookie.unlocked);
  assert.equal(pro.unlocked, pro.total, "the sample pro stats should unlock everything");
  assert.equal(rookie.total, pro.total);
});

test("progression: every requirement has a human description", () => {
  const all = [...P.EMOJIS, ...P.COLORS, ...P.TITLES, ...P.FRAMES];
  for (const item of all) {
    const text = P.describe(item.req);
    assert.ok(text && text !== "Locked", `${item.id || item.value} has a description`);
  }
});

test("progression: catalogue ids and values are unique", () => {
  const dupes = (arr) => arr.filter((v, i) => arr.indexOf(v) !== i);
  assert.deepEqual(dupes(P.EMOJIS.map((e) => e.value)), [], "no duplicate emoji");
  assert.deepEqual(dupes(P.COLORS.map((c) => c.value)), [], "no duplicate colour");
  assert.deepEqual(dupes(P.TITLES.map((t) => t.id)), [], "no duplicate title id");
  assert.deepEqual(dupes(P.FRAMES.map((f) => f.id)), [], "no duplicate frame id");
});

test("avatar validation accepts catalogue cosmetics and rejects junk", () => {
  const good = validateAvatar({ emoji: "🐉", color: "#facc15", title: "champion", frame: "gold" });
  assert.deepEqual(good, { emoji: "🐉", color: "#facc15", title: "champion", frame: "gold" });

  const bad = validateAvatar({ emoji: "💣", color: "not-a-colour", title: "god-mode", frame: "hacked" });
  assert.equal(AVATAR_EMOJIS.includes(bad.emoji), true);
  assert.equal(AVATAR_COLORS.includes(bad.color), true);
  assert.equal(bad.title, "none", "unknown titles fall back rather than pass through");
  assert.equal(bad.frame, "none");
});

test("room capacity is independent of palette size", () => {
  // The regression this guards: capacity used to be AVATAR_COLORS.length, so
  // adding an unlockable colour silently let more people into a room.
  assert.equal(MAX_PLAYERS, 8);
  assert.ok(AVATAR_COLORS.length > MAX_PLAYERS, "palette has grown past the cap");
});
