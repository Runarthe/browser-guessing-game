"use strict";

const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");

const server = require(path.join(__dirname, "..", "server.js"));
const { rankAddress, lanCandidates } = server;

/** Swap in a fake interface list for one call. */
function withInterfaces(fake, fn) {
  const real = os.networkInterfaces;
  os.networkInterfaces = () => fake;
  try { return fn(); } finally { os.networkInterfaces = real; }
}
const ip4 = (address) => ({ address, family: "IPv4", internal: false });

test("lan: prefers a real wifi address over a Tailscale CGNAT address", () => {
  // The exact situation seen in the wild: Tailscale enumerated before Wi-Fi,
  // so a naive "first non-internal IPv4" hands out an unroutable address.
  const best = withInterfaces({
    "Tailscale": [ip4("100.65.173.17")],
    "Wi-Fi": [ip4("192.168.1.42")]
  }, () => lanCandidates());
  assert.equal(best[0].address, "192.168.1.42");
  assert.equal(best[0].name, "Wi-Fi");
  assert.equal(best.length, 2, "the Tailscale address is still offered as a fallback");
});

test("lan: prefers physical adapters over Docker/WSL/Hyper-V virtual ones", () => {
  const best = withInterfaces({
    "vEthernet (WSL)": [ip4("172.20.176.1")],
    "vEthernet (Default Switch)": [ip4("172.17.0.1")],
    "Ethernet": [ip4("192.168.0.10")]
  }, () => lanCandidates());
  assert.equal(best[0].address, "192.168.0.10");
});

test("lan: link-local APIPA addresses rank last", () => {
  const best = withInterfaces({
    "Wi-Fi 2": [ip4("169.254.10.5")],
    "Wi-Fi": [ip4("10.0.0.23")]
  }, () => lanCandidates());
  assert.equal(best[0].address, "10.0.0.23");
  assert.equal(best[best.length - 1].address, "169.254.10.5");
});

test("lan: ignores loopback and IPv6 entries", () => {
  const best = withInterfaces({
    "Loopback Pseudo-Interface 1": [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    "Wi-Fi": [{ address: "fe80::1", family: "IPv6", internal: false }, ip4("192.168.4.4")]
  }, () => lanCandidates());
  assert.equal(best.length, 1);
  assert.equal(best[0].address, "192.168.4.4");
});

test("lan: returns nothing when there is no usable address", () => {
  const best = withInterfaces({
    "Loopback": [{ address: "127.0.0.1", family: "IPv4", internal: true }]
  }, () => lanCandidates());
  assert.deepEqual(best, []);
  assert.equal(withInterfaces({}, () => server.lanAddress()), null);
});

test("lan: private ranges outrank CGNAT even on an unnamed adapter", () => {
  assert.ok(rankAddress("", "192.168.1.5") > rankAddress("", "100.70.1.5"));
  assert.ok(rankAddress("", "10.1.2.3") > rankAddress("", "100.70.1.5"));
  assert.ok(rankAddress("", "172.16.0.9") > rankAddress("", "169.254.1.1"));
});
