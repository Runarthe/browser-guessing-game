"use strict";
/* Local player stats and unlock state.
 *
 * Stored in localStorage, so progress is per-device and trivially editable by
 * anyone who opens devtools. That is a deliberate trade for a local party game:
 * no accounts, no server state, nothing to run. If progression ever needs to be
 * authoritative, this is the seam where it would move server-side.
 *
 * Depends on progression.js for the catalogue. */
(function (root) {

  const KEY = "confetti-progress";
  const VERSION = 1;

  function blank() {
    return {
      version: VERSION,
      gamesPlayed: 0,
      gamesWon: 0,
      roundsPlayed: 0,
      roundsWon: 0,
      modePlays: {},
      modeWins: {},
      currentStreak: 0,
      bestStreak: 0,
      firstPlayedAt: null,
      lastPlayedAt: null,
      seenUnlocks: []      // ids already celebrated, so we only announce once
    };
  }

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!raw || typeof raw !== "object") return blank();
      // Merge onto a blank so fields added in later versions always exist.
      return { ...blank(), ...raw, version: VERSION };
    } catch {
      return blank();
    }
  }

  function save(stats) {
    try { localStorage.setItem(KEY, JSON.stringify(stats)); } catch { /* private mode */ }
    return stats;
  }

  let stats = load();

  /** Every unlocked cosmetic id, across all four catalogues. */
  function unlockedIds(s = stats) {
    if (!root.Progression) return [];
    const c = root.Progression.catalogue(s);
    return [...c.emojis, ...c.colors, ...c.titles, ...c.frames]
      .filter((i) => i.unlocked)
      .map((i) => i.id || i.value);
  }

  /**
   * Record the end of a match.
   * @param {{mode?:string, won:boolean}} result
   * @returns {string[]} ids unlocked by this result, for a "new unlock" toast
   */
  function recordGame({ mode, won }) {
    const before = new Set(unlockedIds());
    const now = Date.now();

    stats.gamesPlayed += 1;
    if (won) stats.gamesWon += 1;
    if (mode) {
      stats.modePlays[mode] = (stats.modePlays[mode] || 0) + 1;
      if (won) stats.modeWins[mode] = (stats.modeWins[mode] || 0) + 1;
    }
    stats.currentStreak = won ? stats.currentStreak + 1 : 0;
    stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    stats.firstPlayedAt = stats.firstPlayedAt || now;
    stats.lastPlayedAt = now;
    save(stats);

    return unlockedIds().filter((id) => !before.has(id));
  }

  /** Per-minigame round result, tracked separately from whole matches. */
  function recordRound({ mode, won }) {
    stats.roundsPlayed += 1;
    if (won) stats.roundsWon += 1;
    if (mode) {
      stats.modePlays[mode] = (stats.modePlays[mode] || 0) + 1;
      if (won) stats.modeWins[mode] = (stats.modeWins[mode] || 0) + 1;
    }
    stats.lastPlayedAt = Date.now();
    save(stats);
  }

  function isUnlocked(item) {
    return !root.Progression ? true : root.Progression.meets(item.req, stats);
  }

  /** Human-readable rows for the stats panel. */
  function summary() {
    const winRate = stats.gamesPlayed ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;
    const favourite = Object.entries(stats.modePlays)
      .sort((a, b) => b[1] - a[1])[0];
    return {
      gamesPlayed: stats.gamesPlayed,
      gamesWon: stats.gamesWon,
      winRate,
      bestStreak: stats.bestStreak,
      currentStreak: stats.currentStreak,
      roundsWon: stats.roundsWon,
      favouriteMode: favourite ? favourite[0] : null,
      favouriteModePlays: favourite ? favourite[1] : 0
    };
  }

  function reset() { stats = blank(); save(stats); return stats; }

  const api = {
    get stats() { return stats; },
    recordGame, recordRound, unlockedIds, isUnlocked, summary, reset,
    // exposed for tests
    _blank: blank, _load: load, _save: save,
    _setStats(next) { stats = { ...blank(), ...next }; return stats; }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.PlayerProgress = api;
})(typeof window !== "undefined" ? window : globalThis);
