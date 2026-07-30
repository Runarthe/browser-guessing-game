"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { RoomManager, validateAvatar, AVATAR_EMOJIS, AVATAR_COLORS } = require("../src/roomManager");

test("validateAvatar clamps to allowed sets and defaults bad input", () => {
  const good = validateAvatar({ emoji: AVATAR_EMOJIS[3], color: AVATAR_COLORS[2] });
  assert.equal(good.emoji, AVATAR_EMOJIS[3]);
  assert.equal(good.color, AVATAR_COLORS[2]);

  const bad = validateAvatar({ emoji: "<script>", color: "javascript:alert(1)" });
  assert.ok(AVATAR_EMOJIS.includes(bad.emoji));
  assert.ok(AVATAR_COLORS.includes(bad.color));

  const missing = validateAvatar(undefined);
  assert.ok(AVATAR_EMOJIS.includes(missing.emoji));
  assert.ok(AVATAR_COLORS.includes(missing.color));
});

test("players carry a validated avatar", () => {
  const rm = new RoomManager();
  const { room } = rm.createRoom("s1", "Runar", { emoji: AVATAR_EMOJIS[5], color: AVATAR_COLORS[1] });
  assert.equal(room.players["s1"].avatar.emoji, AVATAR_EMOJIS[5]);
  const join = rm.joinRoom("s2", room.code, "Anna", { emoji: "nope", color: "#000000" });
  assert.ok(AVATAR_EMOJIS.includes(room.players["s2"].avatar.emoji));
});
