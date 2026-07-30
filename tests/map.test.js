"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { haversineKm } = require("../src/scoring");
const { pointInCountry } = require("../src/geoCountries");
const { mapPlaces } = require("../src/mapPlaces");
const { toPublicQuestion } = require("../src/questionManager");
const { RoomManager, GAME_STATES } = require("../src/roomManager");
const { GameManager } = require("../src/gameManager");

test("country boundaries accept points inside long and large countries", () => {
  assert.equal(pointInCountry("br", { lat: -20, lng: -50 }), true);
  assert.equal(pointInCountry("cl", { lat: -40, lng: -72 }), true);
  assert.equal(pointInCountry("no", { lat: 65, lng: 12 }), true);
  assert.equal(pointInCountry("br", { lat: 0, lng: 0 }), false);
});

test("haversine distance is roughly correct (Oslo–Paris ≈ 1350 km)", () => {
  const oslo = { lat: 59.91, lng: 10.75 };
  const paris = { lat: 48.85, lng: 2.35 };
  const d = haversineKm(oslo, paris);
  assert.ok(d > 1200 && d < 1450, `got ${d}`);
  assert.equal(haversineKm(oslo, oslo), 0);
});

test("map places are well-formed and public payload hides coordinates", () => {
  assert.ok(mapPlaces.length >= 30);
  for (const p of mapPlaces) {
    assert.ok(p.lat >= -90 && p.lat <= 90, `bad lat ${p.id}`);
    assert.ok(p.lng >= -180 && p.lng <= 180, `bad lng ${p.id}`);
    assert.ok(p.prompt && p.category);
  }
  const pub = toPublicQuestion({ id: "x", text: "t", answer: { lat: 1, lng: 2 }, unit: "", category: "Capitals" });
  assert.equal(pub.answer, undefined);
});

test("map round: closest pin wins, distances computed, answer hidden until reveal", () => {
  const events = [];
  const rm = new RoomManager();
  const gm = new GameManager(rm, {
    emitRoom: (c, e, p) => events.push({ e, p }),
    minPlayersToStart: 2, setTimer: () => 0, clearTimer: () => {}
  });
  const last = (e) => [...events].reverse().find((x) => x.e === e);

  const { room } = rm.createRoom("h", "Runar");
  rm.joinRoom("a", room.code, "Anna");
  rm.updateSettings(room, "h", { mode: "map", rounds: 1 });
  gm.startGame(room, "h");

  const q = last("round:question").p;
  assert.equal(q.mode, "map");
  assert.equal(q.question.answer, undefined, "map answer leaked");

  const answer = room.currentQuestion.answer;
  // Runar guesses exactly right; Anna guesses far away.
  assert.equal(gm.submitGuess(room, "h", { lat: answer.lat, lng: answer.lng }).ok, true);
  assert.equal(gm.submitGuess(room, "a", { lat: -answer.lat, lng: answer.lng > 0 ? answer.lng - 120 : answer.lng + 120 }).ok, true);

  assert.equal(room.state, GAME_STATES.RESULTS);
  const res = last("round:results").p;
  assert.equal(res.mode, "map");
  assert.equal(res.ranking[0].playerId, "h");
  assert.equal(res.ranking[0].pointsAwarded, 100);
  assert.equal(res.ranking[0].distanceKm, 0);
  assert.ok(res.ranking[1].distanceKm > res.ranking[0].distanceKm);
});

test("map rejects an out-of-range or missing pin", () => {
  const rm = new RoomManager();
  const gm = new GameManager(rm, { minPlayersToStart: 1, setTimer: () => 0, clearTimer: () => {} });
  const { room } = rm.createRoom("h", "Runar");
  rm.updateSettings(room, "h", { mode: "map", rounds: 1 });
  gm.startGame(room, "h");
  assert.equal(gm.submitGuess(room, "h", { lat: 999, lng: 0 }).ok, false);
  assert.equal(gm.submitGuess(room, "h", null).ok, false);
});
