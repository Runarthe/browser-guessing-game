"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const QR = require(path.join(__dirname, "..", "public", "qrLite.js"));

// GF(256) helpers, kept independent of the encoder so these are real checks
// rather than the implementation agreeing with itself.
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(function () {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

/** A valid Reed-Solomon codeword evaluates to zero at every generator root. */
function rsRootsVanish(codeword, ecLen) {
  for (let i = 0; i < ecLen; i++) {
    let acc = 0;
    for (const b of codeword) acc = mul(acc, EXP[i]) ^ b;
    if (acc !== 0) return false;
  }
  return true;
}

// Version tables for the single-block versions used by LAN URLs (EC level M).
const VERSIONS = { 1: [26, 10], 2: [44, 16], 3: [70, 26] };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22] };
const MASKS = [
  (r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

function reservedMap(version) {
  const size = version * 4 + 17;
  const res = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) res[r][c] = true; };
  const finder = (row, col) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(row + r, col + c); };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  for (const r of ALIGN[version]) for (const c of ALIGN[version]) {
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
  }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  mark(size - 8, 8);
  return res;
}

/** Read the symbol back: recover mask, un-mask, walk the zig-zag, parse bytes. */
function decode(qr) {
  const { size, modules, version } = qr;
  const reserved = reservedMap(version);
  let fmt = 0;
  for (let i = 0; i <= 5; i++) fmt |= (modules[8][i] ? 1 : 0) << i;
  fmt |= (modules[8][7] ? 1 : 0) << 6;
  fmt |= (modules[8][8] ? 1 : 0) << 7;
  fmt |= (modules[7][8] ? 1 : 0) << 8;
  for (let i = 9; i <= 14; i++) fmt |= (modules[14 - i][8] ? 1 : 0) << i;
  const mask = ((fmt ^ 0x5412) >>> 10) & 0b111;

  const grid = modules.map((row) => row.slice());
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (!reserved[r][c] && MASKS[mask](r, c)) grid[r][c] = !grid[r][c];
  }

  const bits = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (!reserved[row][col]) bits.push(grid[row][col] ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const words = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    words.push(b);
  }
  const stream = [];
  for (const w of words) for (let i = 7; i >= 0; i--) stream.push((w >>> i) & 1);
  const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | stream.shift(); return v; };
  const mode = take(4);
  const len = take(8);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(take(8));
  return { mode, mask, words, text: Buffer.from(bytes).toString("utf8") };
}

test("qr: round-trips LAN URLs back to the original text", () => {
  for (const url of [
    "http://192.168.1.42:3000",
    "http://10.0.0.7:54321",
    "http://192.168.86.201:3000",
    "http://172.16.254.1:8080"
  ]) {
    const qr = QR.encode(url);
    const got = decode(qr);
    assert.equal(got.mode, 0b0100, "byte mode");
    assert.equal(got.text, url, `decoded ${url}`);
  }
});

test("qr: error-correction bytes are valid Reed-Solomon", () => {
  // Regression guard: a transposed generator polynomial still round-trips the
  // data but produces EC bytes no real scanner accepts.
  for (const url of ["http://192.168.1.42:3000", "http://10.0.0.7:54321"]) {
    const qr = QR.encode(url);
    const [total, ecPer] = VERSIONS[qr.version];
    const { words } = decode(qr);
    assert.ok(rsRootsVanish(words.slice(0, total), ecPer), `RS valid for ${url}`);
  }
});

test("qr: structural patterns are in the right places", () => {
  const qr = QR.encode("http://192.168.1.42:3000");
  const m = qr.modules, N = qr.size;
  assert.equal(N, qr.version * 4 + 17, "size matches version");
  assert.ok(m[3][3] && m[3][N - 4] && m[N - 4][3], "finder centres dark");
  assert.equal(m[N - 8][8], true, "mandatory dark module");
  for (let i = 8; i < N - 8; i++) assert.equal(m[6][i], i % 2 === 0, `timing at ${i}`);
});

test("qr: rejects text that cannot fit", () => {
  assert.throws(() => QR.encode("x".repeat(4000)), /too long/i);
});
