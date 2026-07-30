"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCharacterSystem() {
  const source = fs.readFileSync(path.join(__dirname, "../public/characters.js"), "utf8");
  const context = { window: {}, performance: { now: () => 0 } };
  vm.runInNewContext(source, context);
  return context.window.PaperCharacter;
}

test("paper character system exposes canvas, DOM and animation APIs", () => {
  const characters = loadCharacterSystem();
  assert.equal(typeof characters.draw, "function");
  assert.equal(typeof characters.element, "function");
  assert.equal(typeof characters.motion, "function");
});

test("paper character animation states produce distinct poses", () => {
  const { motion } = loadCharacterSystem();
  const idle = motion("idle", 500);
  const run = motion("run", 500);
  const jump = motion("jump", 500);
  const eliminated = motion("eliminated", 500);
  assert.notDeepEqual(run, idle);
  assert.ok(jump.sy > 1, "jump pose should stretch vertically");
  assert.ok(eliminated.sy < 1, "eliminated pose should collapse");
});
