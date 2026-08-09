"use strict";
/* Player-count metadata per minigame — shared by server and client, same
 * pattern as vanishMaps.js and progression.js.
 *
 * Two different things are encoded here, and the distinction matters:
 *
 *   min / max   STRUCTURAL. Below `min` the mode is genuinely broken, not just
 *               less fun: Drawing needs a drawer plus guessers, Hide and Go
 *               BOOM! needs a team plus one solo player, Red Light needs a
 *               controller plus runners.
 *
 *   bestFrom /  TASTE. Where the mode actually sings, from playtesting. These
 *   bestTo      are the numbers to revise as more sessions happen; they only
 *               affect sorting and hints, never whether something is playable.
 *
 * Nothing here blocks a host from choosing a mode. The lobby sorts and
 * annotates; the decision stays with the person running the party. */
(function (root) {

  const MODES = {
    // --- Knowledge and turn-taking: the strongest playtest performers -------
    trivia:     { min: 2, max: 8, bestFrom: 3, bestTo: 8 },
    map:        { min: 2, max: 8, bestFrom: 3, bestTo: 8 },
    timeline:   { min: 2, max: 8, bestFrom: 3, bestTo: 8 },
    bomb:       { min: 2, max: 8, bestFrom: 3, bestTo: 8 },

    // --- Small-group action -------------------------------------------------
    curling:    { min: 2, max: 8, bestFrom: 2, bestTo: 5 },
    golf:       { min: 2, max: 8, bestFrom: 2, bestTo: 5 },
    racing:     { min: 2, max: 8, bestFrom: 2, bestTo: 4 },
    pong:       { min: 2, max: 8, bestFrom: 2, bestTo: 6 },
    platformer: { min: 2, max: 8, bestFrom: 2, bestTo: 6 },
    runner:     { min: 2, max: 8, bestFrom: 2, bestTo: 6 },
    flappy:     { min: 2, max: 8, bestFrom: 2, bestTo: 6 },

    // --- Crowd-hungry -------------------------------------------------------
    fire:       { min: 2, max: 8, bestFrom: 3, bestTo: 6 },
    vanish:     { min: 2, max: 8, bestFrom: 4, bestTo: 8 },
    colorfloor: { min: 2, max: 8, bestFrom: 4, bestTo: 8 },
    pushy:      { min: 2, max: 8, bestFrom: 4, bestTo: 8 },
    doors:      { min: 2, max: 8, bestFrom: 4, bestTo: 8 },
    bombpass:   { min: 3, max: 8, bestFrom: 4, bestTo: 8 },
    // Playtested as the weakest mode at small counts — it is a territory race,
    // so it needs bodies on the board to create any contest at all.
    painter:    { min: 2, max: 8, bestFrom: 5, bestTo: 8 },

    // --- Structurally need a role split ------------------------------------
    drawing:    { min: 3, max: 8, bestFrom: 4, bestTo: 8 },  // drawer + guessers
    hidebomb:   { min: 3, max: 8, bestFrom: 4, bestTo: 8 },  // team + solo player
    redlight:   { min: 3, max: 8, bestFrom: 4, bestTo: 8 }   // controller + runners
  };

  const DEFAULT = { min: 2, max: 8, bestFrom: 2, bestTo: 8 };

  function forMode(mode) { return MODES[mode] || DEFAULT; }

  /** "great" | "ok" | "too-few" | "too-many" for a given room size. */
  function fitFor(mode, players) {
    const m = forMode(mode);
    if (players < m.min) return "too-few";
    if (players > m.max) return "too-many";
    if (players >= m.bestFrom && players <= m.bestTo) return "great";
    return "ok";
  }

  /** Short hint shown under a mode in the lobby. Empty when it just fits. */
  function hintFor(mode, players) {
    const m = forMode(mode);
    switch (fitFor(mode, players)) {
      case "too-few":  return `Needs ${m.min}+ players`;
      case "too-many": return `Best with ${m.max} or fewer`;
      case "great":    return "";
      default:
        return players < m.bestFrom
          ? `Better with ${m.bestFrom}+`
          : `Better with ${m.bestTo} or fewer`;
    }
  }

  /** Browsing bucket, derived from where the mode is at its best. */
  function partySize(mode) {
    const m = forMode(mode);
    if (m.bestFrom >= 4) return "big";
    if (m.bestTo <= 5) return "small";
    return "any";
  }

  /** Sort key: great first, then ok, then unplayable. Stable within a tier. */
  function sortByFit(modes, players) {
    const rank = { great: 0, ok: 1, "too-many": 2, "too-few": 3 };
    return modes
      .map((m, i) => ({ m, i, r: rank[fitFor(m, players)] }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.m);
  }

  /**
   * A playlist suited to this many players, best-fitting modes only.
   * `preferred` is the playtest running order — modes people actually enjoyed —
   * so the recommendation leads with known-good material rather than whatever
   * happens to be first in the object.
   */
  const PREFERRED = [
    "map", "timeline", "trivia", "fire", "pong", "bomb",
    "curling", "vanish", "runner", "platformer", "racing",
    "colorfloor", "doors", "pushy", "flappy", "golf", "painter"
  ];

  function recommendedPlaylist(players, { limit = 10 } = {}) {
    const great = PREFERRED.filter((m) => fitFor(m, players) === "great");
    const ok = PREFERRED.filter((m) => fitFor(m, players) === "ok");
    return [...great, ...ok].slice(0, limit);
  }

  const api = { MODES, DEFAULT, PREFERRED, forMode, fitFor, hintFor, partySize, sortByFit, recommendedPlaylist };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ModeInfo = api;
})(typeof window !== "undefined" ? window : globalThis);
