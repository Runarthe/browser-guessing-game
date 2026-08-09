"use strict";
/* Shared cosmetics catalogue — loaded by BOTH the server (require) and the
 * client (<script>), same pattern as vanishMaps.js.
 *
 * The server validates every avatar against these lists, so a cosmetic that
 * only existed on the client would be silently replaced on join. Keeping one
 * source of truth is what stops that class of bug.
 *
 * Unlock state itself is CLIENT-side (localStorage): the server does not know
 * or care whether you earned a cosmetic, only that it is a real one. That is a
 * deliberate trade — progress is per-device and trivially cheatable, which is
 * fine for a local party game and avoids requiring accounts. */
(function (root) {

  // How many people can share a room. Previously this was implied by the
  // palette length, which meant adding a colour silently raised the cap.
  const MAX_PLAYERS = 8;

  // ---- Requirements --------------------------------------------------------
  // Evaluated against a stats object: { gamesPlayed, gamesWon, modeWins:{},
  // modePlays:{}, bestStreak }
  const ALWAYS = { kind: "always" };

  function describe(req) {
    switch (req.kind) {
      case "always": return "Available from the start";
      case "gamesPlayed": return `Play ${req.n} games`;
      case "gamesWon": return `Win ${req.n} games`;
      case "modeWins": return `Win ${req.n} ${req.n === 1 ? "round" : "rounds"} of ${req.modeName}`;
      case "distinctModeWins": return `Win ${req.n} different minigames`;
      case "streak": return `Win ${req.n} games in a row`;
      default: return "Locked";
    }
  }

  function meets(req, stats) {
    const s = stats || {};
    const modeWins = s.modeWins || {};
    switch (req.kind) {
      case "always": return true;
      case "gamesPlayed": return (s.gamesPlayed || 0) >= req.n;
      case "gamesWon": return (s.gamesWon || 0) >= req.n;
      case "modeWins": return (modeWins[req.mode] || 0) >= req.n;
      case "distinctModeWins":
        return Object.values(modeWins).filter((v) => v > 0).length >= req.n;
      case "streak": return (s.bestStreak || 0) >= req.n;
      default: return false;
    }
  }

  // ---- Catalogues ----------------------------------------------------------
  // The first 16 emojis and 8 colours are the originals, always available, so
  // existing saved avatars keep working.
  const EMOJIS = [
    { value: "🦊", req: ALWAYS }, { value: "🐼", req: ALWAYS }, { value: "🐸", req: ALWAYS },
    { value: "🐙", req: ALWAYS }, { value: "🦉", req: ALWAYS }, { value: "🐝", req: ALWAYS },
    { value: "🦄", req: ALWAYS }, { value: "🐲", req: ALWAYS }, { value: "🐳", req: ALWAYS },
    { value: "🦁", req: ALWAYS }, { value: "🐧", req: ALWAYS }, { value: "🦖", req: ALWAYS },
    { value: "🐢", req: ALWAYS }, { value: "🐬", req: ALWAYS }, { value: "🦇", req: ALWAYS },
    { value: "🐰", req: ALWAYS },
    // Unlockable
    { value: "🐺", req: { kind: "gamesPlayed", n: 3 } },
    { value: "🦝", req: { kind: "gamesPlayed", n: 8 } },
    { value: "🦔", req: { kind: "gamesPlayed", n: 15 } },
    { value: "🦩", req: { kind: "gamesPlayed", n: 25 } },
    { value: "🐊", req: { kind: "gamesWon", n: 1 } },
    { value: "🦅", req: { kind: "gamesWon", n: 5 } },
    { value: "🦈", req: { kind: "gamesWon", n: 12 } },
    { value: "🐉", req: { kind: "gamesWon", n: 25 } },
    { value: "👾", req: { kind: "distinctModeWins", n: 3 } },
    { value: "🤖", req: { kind: "distinctModeWins", n: 6 } },
    { value: "👑", req: { kind: "streak", n: 3 } },
    { value: "🔥", req: { kind: "streak", n: 5 } }
  ];

  const COLORS = [
    { value: "#ff6b6b", req: ALWAYS }, { value: "#ffcb3d", req: ALWAYS },
    { value: "#4ade80", req: ALWAYS }, { value: "#60a5fa", req: ALWAYS },
    { value: "#f472b6", req: ALWAYS }, { value: "#a78bfa", req: ALWAYS },
    { value: "#22d3ee", req: ALWAYS }, { value: "#fb923c", req: ALWAYS },
    // Unlockable
    { value: "#f87171", name: "Ember",     req: { kind: "gamesPlayed", n: 5 } },
    { value: "#34d399", name: "Jade",      req: { kind: "gamesPlayed", n: 12 } },
    { value: "#818cf8", name: "Twilight",  req: { kind: "gamesWon", n: 3 } },
    { value: "#e879f9", name: "Orchid",    req: { kind: "gamesWon", n: 8 } },
    { value: "#facc15", name: "Gold",      req: { kind: "gamesWon", n: 15 } },
    { value: "#2dd4bf", name: "Lagoon",    req: { kind: "distinctModeWins", n: 4 } },
    { value: "#fda4af", name: "Blossom",   req: { kind: "streak", n: 2 } },
    { value: "#94a3b8", name: "Platinum",  req: { kind: "streak", n: 4 } }
  ];

  const TITLES = [
    { id: "none",      label: "",                  req: ALWAYS },
    { id: "rookie",    label: "Rookie",            req: { kind: "gamesPlayed", n: 1 } },
    { id: "regular",   label: "Regular",           req: { kind: "gamesPlayed", n: 10 } },
    { id: "veteran",   label: "Veteran",           req: { kind: "gamesPlayed", n: 30 } },
    { id: "winner",    label: "Winner",            req: { kind: "gamesWon", n: 1 } },
    { id: "champion",  label: "Champion",          req: { kind: "gamesWon", n: 10 } },
    { id: "legend",    label: "Legend",            req: { kind: "gamesWon", n: 30 } },
    { id: "allrounder",label: "All-Rounder",       req: { kind: "distinctModeWins", n: 5 } },
    { id: "unstoppable", label: "Unstoppable",     req: { kind: "streak", n: 4 } },
    { id: "vanisher",  label: "Floor Survivor",    req: { kind: "modeWins", mode: "vanish", modeName: "Vanishing Grid", n: 3 } },
    { id: "racer",     label: "Speed Demon",       req: { kind: "modeWins", mode: "racing", modeName: "Racing", n: 3 } },
    { id: "escapee",   label: "Fire Escapee",      req: { kind: "modeWins", mode: "doors", modeName: "Fire Escape", n: 3 } }
  ];

  // Frames are drawn as a ring around the avatar. `style` is consumed by the
  // client renderer; the server only cares that the id exists.
  const FRAMES = [
    { id: "none",   name: "No frame",  style: null,                                   req: ALWAYS },
    { id: "bronze", name: "Bronze",    style: { color: "#cd7f32", width: 3 },         req: { kind: "gamesPlayed", n: 5 } },
    { id: "silver", name: "Silver",    style: { color: "#cbd5e1", width: 3 },         req: { kind: "gamesWon", n: 3 } },
    { id: "gold",   name: "Gold",      style: { color: "#facc15", width: 4, glow: true }, req: { kind: "gamesWon", n: 10 } },
    { id: "flame",  name: "Flame",     style: { color: "#fb923c", width: 4, glow: true, dashed: true }, req: { kind: "streak", n: 3 } },
    { id: "prism",  name: "Prism",     style: { gradient: ["#f472b6", "#60a5fa", "#4ade80"], width: 4 }, req: { kind: "distinctModeWins", n: 6 } }
  ];

  // Plain value lists, used by the server for validation.
  const EMOJI_VALUES = EMOJIS.map((e) => e.value);
  const COLOR_VALUES = COLORS.map((c) => c.value);
  const TITLE_IDS = TITLES.map((t) => t.id);
  const FRAME_IDS = FRAMES.map((f) => f.id);

  /** Every catalogue entry with its unlock state resolved for these stats. */
  function catalogue(stats) {
    const decorate = (list, type) => list.map((item) => ({
      ...item, type,
      unlocked: meets(item.req, stats),
      requirement: describe(item.req)
    }));
    return {
      emojis: decorate(EMOJIS, "emoji"),
      colors: decorate(COLORS, "color"),
      titles: decorate(TITLES, "title"),
      frames: decorate(FRAMES, "frame")
    };
  }

  /** Count of unlocked vs total, for the menu summary. */
  function progressSummary(stats) {
    const c = catalogue(stats);
    const all = [...c.emojis, ...c.colors, ...c.titles, ...c.frames];
    return { unlocked: all.filter((i) => i.unlocked).length, total: all.length };
  }

  const api = {
    MAX_PLAYERS, EMOJIS, COLORS, TITLES, FRAMES,
    EMOJI_VALUES, COLOR_VALUES, TITLE_IDS, FRAME_IDS,
    meets, describe, catalogue, progressSummary
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.Progression = api;
})(typeof window !== "undefined" ? window : globalThis);
