"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { RoomManager, GAME_STATES } = require("../src/roomManager");

test("new rooms default to trivia with sensible settings", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  assert.equal(room.settings.mode, "trivia");
  assert.equal(room.settings.rounds, 5);
  assert.ok(room.settings.roundSeconds >= 20);
  assert.equal(room.settings.categories, null);
});

test("host can update valid settings; invalid values are ignored", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  rm.updateSettings(room, "s1", { mode: "bomb", rounds: 7, roundSeconds: 60 });
  assert.equal(room.settings.mode, "bomb");
  assert.equal(room.settings.rounds, 7);
  assert.equal(room.settings.roundSeconds, 60);

  // Invalid values leave settings unchanged.
  rm.updateSettings(room, "s1", { mode: "nope", rounds: 999, roundSeconds: 3 });
  assert.equal(room.settings.mode, "bomb");
  assert.equal(room.settings.rounds, 7);
  assert.equal(room.settings.roundSeconds, 60);
});

test("numeric sliders accept one round/win and enforce a ten-second minimum",()=>{
  const rm=new RoomManager();const {room}=rm.createRoom("s1","Runar");
  rm.updateSettings(room,"s1",{rounds:1,roundSeconds:10,battleTarget:1,target:1});
  assert.equal(room.settings.rounds,1);assert.equal(room.settings.roundSeconds,10);
  assert.equal(room.settings.battleTarget,1);assert.equal(room.settings.target,1);
  rm.updateSettings(room,"s1",{roundSeconds:5});assert.equal(room.settings.roundSeconds,10);
});

test("non-host cannot update settings", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  const res = rm.updateSettings(room, "s2", { mode: "curling" });
  assert.equal(res.ok, false);
  assert.equal(room.settings.mode, "trivia");
});

test("settings are locked once the game leaves the lobby", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  room.state = GAME_STATES.QUESTION;
  const res = rm.updateSettings(room, "s1", { mode: "bomb" });
  assert.equal(res.ok, false);
});

test("categories accepts an array and rejects an empty result", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar");
  rm.updateSettings(room, "s1", { categories: ["Space", "Animals"] });
  assert.deepEqual(room.settings.categories, ["Space", "Animals"]);
  rm.updateSettings(room, "s1", { categories: [] });
  assert.equal(room.settings.categories, null); // empty -> treated as "all"
});
