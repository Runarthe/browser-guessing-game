"use strict";
/* Minimal QR Code encoder — byte mode, EC level M, versions 1-10.
 * Dependency-free on purpose: the desktop build ships offline, so pulling a
 * QR library from a CDN would break the moment there is no internet.
 * Exposes QRLite.encode(text) -> { size, modules } where modules[row][col] is
 * a boolean (true = dark). */
(function (root) {

  // ---- Galois field (GF(256), primitive polynomial 0x11d) -------------------
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1; if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /** Reed-Solomon generator polynomial of the given degree.
   *  Coefficients are stored highest-degree-first, so multiplying by
   *  (x + a^i) keeps the x-term at the same index and shifts the a^i term up.
   *  Getting this order backwards silently produces a non-monic polynomial
   *  (gen[0] != 1) and therefore EC bytes that no scanner will accept. */
  function rsGenerator(degree) {
    let poly = [1];
    for (let i = 0; i < degree; i++) {
      const next = new Array(poly.length + 1).fill(0);
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];                        // x * poly
        next[j + 1] ^= mul(poly[j], EXP[i]);       // a^i * poly
      }
      poly = next;
    }
    return poly;
  }

  /** EC codewords for one data block. */
  function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const res = new Uint8Array(ecLen);
    for (const byte of data) {
      const factor = byte ^ res[0];
      res.copyWithin(0, 1); res[ecLen - 1] = 0;
      for (let i = 0; i < ecLen; i++) res[i] ^= mul(gen[i + 1], factor);
    }
    return res;
  }

  // ---- Version tables (EC level M only) ------------------------------------
  // [ totalCodewords, ecCodewordsPerBlock, group1Blocks, group2Blocks ]
  const VERSIONS = {
    1:  [26,   10, 1, 0],
    2:  [44,   16, 1, 0],
    3:  [70,   26, 1, 0],
    4:  [100,  18, 2, 0],
    5:  [134,  24, 2, 0],
    6:  [172,  16, 4, 0],
    7:  [196,  18, 4, 0],
    8:  [242,  22, 2, 2],
    9:  [292,  22, 3, 2],
    10: [346,  26, 4, 1]
  };
  // Alignment pattern centre coordinates per version.
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

  function capacityBits(version) {
    const [total, ecPer, g1, g2] = VERSIONS[version];
    return (total - ecPer * (g1 + g2)) * 8;
  }

  function pickVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
      const lenBits = v < 10 ? 8 : 16;          // byte-mode count length
      if (4 + lenBits + byteLen * 8 <= capacityBits(v)) return v;
    }
    throw new Error("QRLite: text too long (max ~270 bytes at EC level M)");
  }

  // ---- Bit buffer ----------------------------------------------------------
  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  /** Data codewords: mode + length + payload + terminator + pad. */
  function buildData(bytes, version) {
    const buf = new BitBuffer();
    buf.put(0b0100, 4);                                  // byte mode
    buf.put(bytes.length, version < 10 ? 8 : 16);
    for (const b of bytes) buf.put(b, 8);

    const cap = capacityBits(version);
    buf.put(0, Math.min(4, cap - buf.bits.length));      // terminator
    while (buf.bits.length % 8) buf.bits.push(0);        // byte align

    const words = [];
    for (let i = 0; i < buf.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | buf.bits[i + j];
      words.push(byte);
    }
    const totalData = cap / 8;
    const PAD = [0xec, 0x11];
    for (let i = 0; words.length < totalData; i++) words.push(PAD[i % 2]);
    return words;
  }

  /** Split into blocks, add EC, then interleave as the spec requires. */
  function buildCodewords(dataWords, version) {
    const [total, ecPer, g1, g2] = VERSIONS[version];
    const blockCount = g1 + g2;
    const shortLen = Math.floor(dataWords.length / blockCount);
    const longCount = dataWords.length - shortLen * blockCount; // blocks with +1

    const dataBlocks = [], ecBlocks = [];
    let offset = 0;
    for (let i = 0; i < blockCount; i++) {
      const len = shortLen + (i >= blockCount - longCount ? 1 : 0);
      const block = dataWords.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(block);
      ecBlocks.push(rsEncode(block, ecPer));
    }

    const out = [];
    const maxData = Math.max(...dataBlocks.map((b) => b.length));
    for (let i = 0; i < maxData; i++) {
      for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
    }
    for (let i = 0; i < ecPer; i++) {
      for (const block of ecBlocks) out.push(block[i]);
    }
    if (out.length !== total) throw new Error("QRLite: codeword count mismatch");
    return out;
  }

  // ---- Matrix construction -------------------------------------------------
  function buildMatrix(version) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Array(size).fill(null));
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    const setF = (r, c, v) => { modules[r][c] = v; reserved[r][c] = true; };

    // Finder patterns + separators.
    const finder = (row, col) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                       (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setF(rr, cc, inRing || inCore);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // Timing patterns.
    for (let i = 8; i < size - 8; i++) {
      setF(6, i, i % 2 === 0);
      setF(i, 6, i % 2 === 0);
    }

    // Alignment patterns (skipping those overlapping finders).
    const centres = ALIGN[version];
    for (const r of centres) for (const c of centres) {
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        setF(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }

    // Reserve format-info areas and the dark module.
    for (let i = 0; i < 9; i++) {
      if (modules[8][i] === null) { modules[8][i] = false; reserved[8][i] = true; }
      if (modules[i][8] === null) { modules[i][8] = false; reserved[i][8] = true; }
    }
    for (let i = 0; i < 8; i++) {
      if (modules[8][size - 1 - i] === null) { modules[8][size - 1 - i] = false; reserved[8][size - 1 - i] = true; }
      if (modules[size - 1 - i][8] === null) { modules[size - 1 - i][8] = false; reserved[size - 1 - i][8] = true; }
    }
    setF(size - 8, 8, true); // always-dark module

    return { size, modules, reserved };
  }

  /** Zig-zag placement of the codeword bitstream. */
  function placeData(matrix, codewords) {
    const { size, modules, reserved } = matrix;
    const bits = [];
    for (const word of codewords) for (let i = 7; i >= 0; i--) bits.push((word >>> i) & 1);

    let idx = 0, upward = true;
    for (let right = size - 1; right > 0; right -= 2) {
      if (right === 6) right = 5;                       // skip the timing column
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (const col of [right, right - 1]) {
          if (reserved[row][col]) continue;
          modules[row][col] = idx < bits.length ? bits[idx++] === 1 : false;
        }
      }
      upward = !upward;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  ];

  /** Format information: 5 data bits + BCH(15,5), XORed with the spec mask. */
  function formatBits(maskIndex) {
    const ecBits = 0b00;                       // EC level M
    const data = (ecBits << 3) | maskIndex;
    let rem = data;
    for (let i = 0; i < 10; i++) {
      rem <<= 1;
      if (rem & 0x400) rem ^= 0x537;           // generator 10100110111
    }
    return ((data << 10) | rem) ^ 0x5412;      // spec XOR mask 101010000010010
  }

  function applyFormat(matrix, maskIndex) {
    const { size, modules } = matrix;
    const bits = formatBits(maskIndex);
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) modules[8][i] = bit(i);
    modules[8][7] = bit(6);
    modules[8][8] = bit(7);
    modules[7][8] = bit(8);
    for (let i = 9; i <= 14; i++) modules[14 - i][8] = bit(i);
    for (let i = 0; i <= 7; i++) modules[size - 1 - i][8] = bit(i);
    for (let i = 8; i <= 14; i++) modules[8][size - 15 + i] = bit(i);
    modules[size - 8][8] = true;               // always dark
  }

  /** Penalty score used to choose the least-ambiguous mask. */
  function penalty(modules, size) {
    let score = 0;
    const at = (r, c) => modules[r][c] === true;
    // Rule 1: runs of 5+ same-colour modules.
    for (let r = 0; r < size; r++) {
      for (const horizontal of [true, false]) {
        let run = 1, prev = horizontal ? at(r, 0) : at(0, r);
        for (let i = 1; i < size; i++) {
          const cur = horizontal ? at(r, i) : at(i, r);
          if (cur === prev) { run++; } else { if (run >= 5) score += run - 2; run = 1; prev = cur; }
        }
        if (run >= 5) score += run - 2;
      }
    }
    // Rule 2: 2x2 blocks of one colour.
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) score += 3;
    }
    // Rule 3: finder-like 1:1:3:1:1 patterns.
    const P1 = [true, false, true, true, true, false, true, false, false, false, false];
    const P2 = [false, false, false, false, true, false, true, true, true, false, true];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      for (const horizontal of [true, false]) {
        if (horizontal && c + 11 > size) continue;
        if (!horizontal && r + 11 > size) continue;
        let m1 = true, m2 = true;
        for (let i = 0; i < 11; i++) {
          const v = horizontal ? at(r, c + i) : at(r + i, c);
          if (v !== P1[i]) m1 = false;
          if (v !== P2[i]) m2 = false;
        }
        if (m1) score += 40;
        if (m2) score += 40;
      }
    }
    // Rule 4: deviation from a 50/50 dark ratio.
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (at(r, c)) dark++;
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    const version = pickVersion(bytes.length);
    const codewords = buildCodewords(buildData(bytes, version), version);

    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const matrix = buildMatrix(version);
      placeData(matrix, codewords);
      for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) {
        if (!matrix.reserved[r][c] && MASKS[mask](r, c)) matrix.modules[r][c] = !matrix.modules[r][c];
      }
      applyFormat(matrix, mask);
      const score = penalty(matrix.modules, matrix.size);
      if (!best || score < best.score) best = { score, matrix };
    }
    return {
      version,
      size: best.matrix.size,
      modules: best.matrix.modules.map((row) => row.map((v) => v === true))
    };
  }

  const api = { encode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.QRLite = api;
})(typeof window !== "undefined" ? window : globalThis);
