"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { questions } = require("../src/questions");
const {
  toPublicQuestion,
  pickQuestions,
  availableQuestionCount
} = require("../src/questionManager");

test("question bank has enough questions for a full game", () => {
  assert.ok(questions.length >= 30, `only ${questions.length} questions`);
  assert.equal(availableQuestionCount(), questions.length);
});

test("every question is well-formed", () => {
  for (const q of questions) {
    assert.equal(typeof q.id, "string", `bad id: ${JSON.stringify(q)}`);
    assert.ok(q.text && typeof q.text === "string", `bad text on ${q.id}`);
    assert.ok(Number.isFinite(q.answer), `non-finite answer on ${q.id}`);
    assert.ok(typeof q.unit === "string" && q.unit.length > 0, `bad unit on ${q.id}`);
    assert.ok(typeof q.category === "string" && q.category.length > 0, `bad category on ${q.id}`);
  }
});

test("question ids are unique", () => {
  const ids = questions.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate question ids found");
});

test("toPublicQuestion never leaks the answer", () => {
  const pub = toPublicQuestion(questions[0]);
  assert.equal(pub.answer, undefined);
  assert.equal(pub.id, questions[0].id);
  assert.equal(pub.text, questions[0].text);
});

test("pickQuestions returns the requested count of distinct questions", () => {
  const picked = pickQuestions({ mode: "trivia", count: 5 });
  assert.equal(picked.length, 5);
  const ids = picked.map((q) => q.id);
  assert.equal(new Set(ids).size, 5, "pickQuestions returned duplicates");
});

test("pickQuestions excludes already-used ids", () => {
  const first = pickQuestions({ mode: "trivia", count: 5 });
  const usedIds = first.map((q) => q.id);
  const second = pickQuestions({ mode: "trivia", count: 5, excludeIds: usedIds });
  const overlap = second.filter((q) => usedIds.includes(q.id));
  assert.equal(overlap.length, 0, "pickQuestions repeated an excluded question");
});

test("pickQuestions honours category filters", () => {
  const picked = pickQuestions({ mode: "trivia", count: 5, categories: ["Space"] });
  assert.ok(picked.every((q) => q.category === "Space"));
});

test("timeline mode draws from timeline events", () => {
  const picked = pickQuestions({ mode: "timeline", count: 5 });
  assert.equal(picked.length, 5);
  assert.ok(picked.every((q) => q.unit === "year" && Number.isFinite(q.answer)));
});
