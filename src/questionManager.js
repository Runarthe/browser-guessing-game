"use strict";

const { questions } = require("./questions");
const { timelineEvents } = require("./timelineEvents");
const { mapPlaces } = require("./mapPlaces");

const MAP_POINT_OVERRIDES = {
  "cty-japan": ["Where is the capital of Japan?", 35.68, 139.69],
  "cty-brazil": ["Where is the capital of Brazil?", -15.79, -47.88],
  "cty-australia": ["Where is the capital of Australia?", -35.28, 149.13],
  "cty-egypt": ["Where is the capital of Egypt?", 30.04, 31.24],
  "cty-norway": ["Where is the capital of Norway?", 59.91, 10.75],
  "cty-iceland": ["Where is the capital of Iceland?", 64.15, -21.94],
  "cty-madagascar": ["Where is the capital of Madagascar?", -18.879, 47.508],
  "cty-nz": ["Where is the capital of New Zealand?", -41.287, 174.776],
  "cty-mongolia": ["Where is the capital of Mongolia?", 47.886, 106.906],
  "cty-chile": ["Where is the capital of Chile?", -33.449, -70.669],
  "flag-jp": ["Where is the capital of the country represented by this flag?", 35.68, 139.69],
  "flag-br": ["Where is the capital of the country represented by this flag?", -15.79, -47.88],
  "flag-no": ["Where is the capital of the country represented by this flag?", 59.91, 10.75],
  "flag-eg": ["Where is the capital of the country represented by this flag?", 30.04, 31.24],
  "flag-au": ["Where is the capital of the country represented by this flag?", -35.28, 149.13],
  "flag-ca": ["Where is the capital of the country represented by this flag?", 45.42, -75.70],
  "flag-in": ["Where is the capital of the country represented by this flag?", 28.61, 77.21],
  "flag-za": ["Where is South Africa's executive capital?", -25.748, 28.229],
  "riv-nile": ["Where does the Nile meet the Mediterranean Sea?", 31.46, 30.37],
  "riv-amazon": ["Where does the Amazon meet the Atlantic Ocean?", 0.50, -50.50],
  "riv-mississippi": ["Where does the Mississippi meet the Gulf of Mexico?", 29.15, -89.25],
  "riv-ganges": ["Where does the Ganges delta meet the Bay of Bengal?", 21.90, 89.00],
  "riv-danube": ["Where does the Danube meet the Black Sea?", 45.16, 29.67],
  "riv-yangtze": ["Where does the Yangtze meet the East China Sea?", 31.40, 121.90]
};

/**
 * Strip the correct answer from a server-side question so it is safe to send to
 * clients during the question stage.
 *
 * @param {object} question server-side question (includes `answer`)
 * @returns {{id: string, text: string, unit: string, category: string}}
 */
function toPublicQuestion(question) {
  return {
    id: question.id,
    text: question.text,
    unit: question.unit,
    category: question.category
  };
}

/** Timeline events reshaped to the common question shape (answer = year). */
const timelineAsQuestions = timelineEvents.map((e) => ({
  id: e.id,
  text: e.label,
  answer: e.year,
  unit: "year",
  category: e.category
}));

/** Map places reshaped to the common question shape (answer = {lat,lng}). */
const mapAsQuestions = mapPlaces.map((p) => ({
  id: p.id,
  text: MAP_POINT_OVERRIDES[p.id]?.[0] || p.prompt,
  answer: {
    lat: MAP_POINT_OVERRIDES[p.id]?.[1] ?? p.lat,
    lng: MAP_POINT_OVERRIDES[p.id]?.[2] ?? p.lng
  },
  acceptableRadiusKm: p.category === "Rivers" ? 75 : 50,
  unit: "",
  category: p.category
}));

/** The base pool for a given game mode. Bomb mode uses no questions. */
function poolForMode(mode) {
  if (mode === "timeline") return timelineAsQuestions;
  if (mode === "map") return mapAsQuestions;
  if (["bomb", "platformer", "drawing", "pushy", "redlight", "hidebomb", "colorfloor", "vanish", "bombpass", "fire", "racing", "flappy", "runner", "painter", "pong", "doors"].includes(mode)) return [];
  return questions; // trivia, curling
}

/** Distinct category names available for a mode (for the settings UI). */
function categoriesForMode(mode) {
  const pool = poolForMode(mode);
  return [...new Set(pool.map((q) => q.category))].sort();
}

/**
 * Pick `count` distinct random questions for a game.
 *
 * @param {object} opts
 * @param {string} opts.mode           game mode
 * @param {number} opts.count          how many questions to pick
 * @param {string[]|null} [opts.categories]  only these categories (null = all)
 * @param {string[]} [opts.excludeIds] ids already used this room (avoid repeats)
 * @returns {Array<object>} server-side question objects (include answers)
 */
function pickQuestions({ mode = "trivia", count, categories = null, excludeIds = [] } = {}) {
  let pool = poolForMode(mode);
  if (Array.isArray(categories) && categories.length) {
    pool = pool.filter((q) => categories.includes(q.category));
  }
  const exclude = new Set(excludeIds);
  let candidates = pool.filter((q) => !exclude.has(q.id));
  // If we've exhausted the (filtered) pool, allow repeats rather than stall.
  if (candidates.length < count) candidates = pool.slice();

  const shuffled = candidates.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** How many questions are available for a mode + category filter. */
function availableQuestionCount(mode = "trivia", categories = null) {
  let pool = poolForMode(mode);
  if (Array.isArray(categories) && categories.length) {
    pool = pool.filter((q) => categories.includes(q.category));
  }
  return pool.length;
}

module.exports = {
  toPublicQuestion,
  pickQuestions,
  availableQuestionCount,
  categoriesForMode,
  poolForMode
};
