"use strict";
/* Shared Vanishing-Grid "maps" — loaded by BOTH the server (require) and the
 * client (<script>). The tile grid is a fixed cell field; each map applies a
 * per-floor MASK (which cells are solid vs. holes) plus a render shape + theme.
 * Because a masked-out cell is a hole you fall through, the mask affects gameplay,
 * so it MUST be identical on server and client — hence this single source. */
(function (root) {
  // One bigger board = more tiles per floor + one extra floor => longer rounds.
  const G = { cols: 12, rows: 8, x0: 72, y0: 68, w: 576, h: 304, layers: 5 };
  G.tw = G.w / G.cols; G.th = G.h / G.rows;

  // shape: how a tile is drawn (square | hex)
  // mask:  which cells exist per floor (full | ring | varies | lanes | rhombus | blocks)
  const VMAPS = [
    { id: "void",    name: "Deep Void",    theme: "void",   shape: "square",  mask: "full" },
    { id: "honey",   name: "Honeycomb",    theme: "jungle", shape: "hex",     mask: "full" },
    { id: "star",    name: "Starfall",     theme: "lava",   shape: "square",  mask: "varies" },
    { id: "lanes",   name: "Trenches",     theme: "neon",   shape: "square",  mask: "lanes" },
    { id: "rhombus", name: "Diamond Yard", theme: "ice",    shape: "square",  mask: "rhombus" },
    { id: "islands", name: "Archipelago",  theme: "jungle", shape: "square",  mask: "blocks" },
    { id: "ringmap", name: "Halo",         theme: "void",   shape: "square",  mask: "ring" }
  ];

  function pickVMap(seed) {
    return VMAPS[Math.abs(Math.floor((seed || 0) / 997)) % VMAPS.length];
  }
  function mapById(id) { return VMAPS.find((m) => m.id === id) || VMAPS[0]; }

  function cellCenter(col, row) {
    return [G.x0 + (col + 0.5) * G.tw, G.y0 + (row + 0.5) * G.th];
  }

  /** Is cell (col,row) on the given floor a solid tile (true) or a hole (false)? */
  function cellPresent(mask, floor, col, row) {
    const cx = (G.cols - 1) / 2, cy = (G.rows - 1) / 2;
    const dx = col - cx, dy = row - cy;
    const rx = G.cols / 2 - 0.05, ry = G.rows / 2 - 0.05;
    const e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);   // ellipse metric
    const man = Math.abs(dx) / rx + Math.abs(dy) / ry;         // diamond metric
    switch (mask) {
      case "disc":    return e <= 1.02;                             // filled circle
      case "ring":    return e <= 1.02 && e >= 0.28;                // annulus
      case "lanes":   return ((col + floor) % 3) !== 0;             // shifting vertical trenches
      case "rhombus": return man <= 1.04;                           // square tiles in a diamond outline
      case "blocks":  return (col % 3 !== 2) && (row % 3 !== 2);    // 2x2 islands split by channels
      case "varies": {
        const f = ((floor % 4) + 4) % 4;
        if (f === 0) return true;                                   // full
        if (f === 1) return e <= 1.02 && e >= 0.28;                 // ring
        if (f === 2) return Math.abs(dx) <= 1.5 || Math.abs(dy) <= 1.5;  // plus / cross
        return Math.abs(dx) <= 1.5 || Math.abs(dy) <= 1.5 ||        // star
               Math.abs(dx - dy) < 1.2 || Math.abs(dx + dy) < 1.2;
      }
      case "full": default: return true;
    }
  }

  /** Nearest solid floor-0 cell centre to (x,y) — used to place spawns safely. */
  function snapPresent(mask, x, y) {
    let best = null, bestD = Infinity;
    for (let row = 0; row < G.rows; row++) {
      for (let col = 0; col < G.cols; col++) {
        if (!cellPresent(mask, 0, col, row)) continue;
        const [cx, cy] = cellCenter(col, row);
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d < bestD) { bestD = d; best = [cx, cy]; }
      }
    }
    return best || [x, y];
  }

  const api = { G, VMAPS, pickVMap, mapById, cellCenter, cellPresent, snapPresent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.VanishMaps = api;
})(typeof window !== "undefined" ? window : globalThis);
