"use strict";
/* Join panel for the lobby: shows the address other devices type in, plus a QR
 * code to scan. Deliberately self-contained — it injects its own markup and
 * styles and never touches app.js, so it cannot collide with game-logic edits.
 *
 * Works in two situations:
 *   - Desktop build: asks the Electron preload bridge for the LAN address.
 *   - Plain browser: falls back to the page's own origin, which is already the
 *     right address whenever you opened the game over the network. */
(function () {

  const QUIET = 3; // quiet-zone modules required around a QR symbol

  function drawQR(canvas, text) {
    if (!window.QRLite) return false;
    let qr;
    try { qr = QRLite.encode(text); } catch { return false; }
    const total = qr.size + QUIET * 2;
    const scale = Math.max(2, Math.floor(160 / total));
    const px = total * scale;
    canvas.width = px; canvas.height = px;
    canvas.style.width = px + "px"; canvas.style.height = px + "px";
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = "#0b1020";
    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        if (qr.modules[r][c]) ctx.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
      }
    }
    return true;
  }

  /** The address other devices should use, or null if we can't offer one. */
  async function resolveJoinUrl() {
    const bridge = window.miniMayhemDesktop;
    if (bridge && typeof bridge.getHostInfo === "function") {
      try {
        const info = await bridge.getHostInfo();
        if (info && info.lanUrl) {
          return { url: info.lanUrl, port: info.port, desktop: true, alternatives: info.lanUrls || [] };
        }
        if (info) return { url: null, port: info.port, desktop: true, noLan: true };
      } catch { /* fall through to the browser path */ }
    }
    // Plain browser: if the page was opened over the network, that origin is
    // already the address to share. Loopback is useless to anyone else.
    const host = location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
      return { url: location.origin, port: location.port, alternatives: [] };
    }
    return null;
  }

  function styleButton(el) {
    el.style.cssText = "margin-top:10px;margin-right:8px;padding:7px 12px;border-radius:9px;" +
      "border:1px solid rgba(148,205,255,.3);background:rgba(255,255,255,.06);" +
      "color:inherit;font:inherit;font-size:13px;cursor:pointer";
  }

  function buildPanel(info) {
    const wrap = document.createElement("div");
    wrap.id = "host-join-panel";
    wrap.style.cssText = [
      "margin:14px 0 4px", "padding:14px 16px", "border-radius:14px",
      "background:rgba(43,72,96,.35)", "border:1px solid rgba(148,205,255,.22)",
      "display:flex", "gap:16px", "align-items:center", "flex-wrap:wrap"
    ].join(";");

    const left = document.createElement("div");
    left.style.cssText = "flex:1 1 220px;min-width:200px";

    const label = document.createElement("div");
    label.textContent = "Others join from their phone at";
    label.style.cssText = "font-size:12px;letter-spacing:.04em;text-transform:uppercase;opacity:.7;margin-bottom:6px";
    left.appendChild(label);

    if (!info.url) {
      const warn = document.createElement("div");
      warn.textContent = info.noLan
        ? "No network address found — you appear to be offline, so only this computer can play."
        : "Open the game over your network to see a join address.";
      warn.style.cssText = "font-size:14px;opacity:.8;line-height:1.4";
      left.appendChild(warn);
      if (info.port) {
        const p = document.createElement("div");
        p.textContent = `Running on port ${info.port}`;
        p.style.cssText = "font-size:12px;opacity:.55;margin-top:6px;font-family:ui-monospace,Consolas,monospace";
        left.appendChild(p);
      }
      wrap.appendChild(left);
      return wrap;
    }

    // More than one address means VPNs or virtual adapters are present, and our
    // top pick may not be routable from a guest's phone. Let the host switch.
    const options = (info.alternatives && info.alternatives.length > 1)
      ? info.alternatives.slice()
      : [{ url: info.url, name: "" }];
    let current = Math.max(0, options.findIndex((o) => o.url === info.url));

    const urlLine = document.createElement("div");
    urlLine.style.cssText = "font-size:22px;font-weight:800;font-family:ui-monospace,Menlo,Consolas,monospace;word-break:break-all;line-height:1.2";
    left.appendChild(urlLine);

    const hint = document.createElement("div");
    hint.style.cssText = "font-size:12px;opacity:.65;margin-top:6px";
    left.appendChild(hint);

    const qr = document.createElement("canvas");
    qr.style.cssText = "border-radius:8px;flex:0 0 auto;image-rendering:pixelated";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy address";
    styleButton(copy);

    const render = () => {
      const opt = options[current];
      urlLine.textContent = opt.url.replace(/^https?:\/\//, "");
      hint.textContent = options.length > 1
        ? `Same wifi, no install needed — via ${opt.name || "this network"}`
        : "Same wifi. No install needed.";
      drawQR(qr, opt.url);
    };

    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(options[current].url);
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy failed";
      }
      setTimeout(() => { copy.textContent = "Copy address"; }, 1600);
    });

    const buttons = document.createElement("div");
    buttons.appendChild(copy);

    if (options.length > 1) {
      const swap = document.createElement("button");
      swap.type = "button";
      swap.textContent = "Not working? Try another";
      styleButton(swap);
      swap.addEventListener("click", () => {
        current = (current + 1) % options.length;
        render();
      });
      buttons.appendChild(swap);
    }
    left.appendChild(buttons);

    wrap.appendChild(left);
    render();
    if (qr.width > 0) wrap.appendChild(qr);
    return wrap;
  }

  async function mount() {
    if (document.getElementById("host-join-panel")) return;
    const card = document.querySelector("#screen-lobby .card");
    if (!card) return;
    const info = await resolveJoinUrl();
    if (!info) return;                       // localhost-only: nothing to share
    const panel = buildPanel(info);
    const anchor = card.querySelector(".room-header");
    if (anchor && anchor.nextSibling) card.insertBefore(panel, anchor.nextSibling);
    else card.insertBefore(panel, card.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
