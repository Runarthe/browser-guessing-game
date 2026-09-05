"use strict";
/* Start-menu panels: Settings, Credits, and Unlockables & stats.
 *
 * Self-contained (own markup + inline styles) so it does not compete with
 * app.js or styles.css for the same lines. It talks to the game through two
 * small surfaces only: window.ConfettiAudio and window.PlayerProgress. */
(function () {

  const FULLSCREEN_KEY = "confetti-fullscreen";

  // ---- Generic overlay -----------------------------------------------------
  let overlay = null;

  function closePanel() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") closePanel(); }

  function openPanel(title, buildBody) {
    closePanel();
    overlay = document.createElement("div");
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:80", "background:rgba(6,9,22,.72)",
      "display:flex", "align-items:center", "justify-content:center", "padding:20px"
    ].join(";");
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closePanel(); });

    const panel = document.createElement("div");
    panel.style.cssText = [
      "background:#151a33", "border:1px solid rgba(148,205,255,.22)", "border-radius:18px",
      "width:min(560px,100%)", "max-height:min(80vh,720px)", "overflow:auto",
      "padding:20px 22px", "box-shadow:0 24px 60px rgba(0,0,0,.5)"
    ].join(";");

    const head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:14px";
    const h = document.createElement("h3");
    h.textContent = title;
    h.style.cssText = "margin:0;font-size:20px";
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "✕"; x.setAttribute("aria-label", "Close");
    x.style.cssText = "background:none;border:none;color:inherit;font-size:20px;cursor:pointer;opacity:.7;padding:4px 8px";
    x.addEventListener("click", closePanel);
    head.appendChild(h); head.appendChild(x);
    panel.appendChild(head);

    buildBody(panel);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
  }

  // ---- Small builders ------------------------------------------------------
  function row(parent, labelText) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin:0 0 16px";
    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.cssText = "font-size:13px;opacity:.75;margin-bottom:6px";
    wrap.appendChild(label);
    parent.appendChild(wrap);
    return wrap;
  }

  function slider(parent, labelText, get, set) {
    const wrap = row(parent, labelText);
    const line = document.createElement("div");
    line.style.cssText = "display:flex;align-items:center;gap:12px";
    const input = document.createElement("input");
    input.type = "range"; input.min = "0"; input.max = "100"; input.step = "1";
    input.value = String(Math.round(get() * 100));
    input.style.cssText = "flex:1";
    const value = document.createElement("strong");
    value.textContent = `${input.value}%`;
    value.style.cssText = "min-width:44px;text-align:right;font-variant-numeric:tabular-nums";
    input.addEventListener("input", () => {
      value.textContent = `${input.value}%`;
      set(Number(input.value) / 100);
    });
    line.appendChild(input); line.appendChild(value);
    wrap.appendChild(line);
    return input;
  }

  function toggle(parent, labelText, get, set) {
    const wrap = row(parent, "");
    const btn = document.createElement("button");
    btn.type = "button";
    const paint = () => { btn.textContent = `${labelText}: ${get() ? "On" : "Off"}`; };
    btn.style.cssText = "padding:9px 14px;border-radius:10px;border:1px solid rgba(148,205,255,.3);" +
      "background:rgba(255,255,255,.06);color:inherit;font:inherit;font-size:14px;cursor:pointer;width:100%;text-align:left";
    btn.addEventListener("click", () => { set(!get()); paint(); });
    paint();
    wrap.appendChild(btn);
    return btn;
  }

  // ---- Settings ------------------------------------------------------------
  function isFullscreen() { return !!document.fullscreenElement; }
  function setFullscreen(on) {
    try {
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.();
      else if (!on && document.fullscreenElement) document.exitFullscreen?.();
      localStorage.setItem(FULLSCREEN_KEY, JSON.stringify(on));
    } catch { /* browsers can refuse without a user gesture */ }
  }

  function openSettings() {
    openPanel("Settings", (panel) => {
      const audio = window.ConfettiAudio;
      if (audio) {
        slider(panel, "Music volume", audio.getMusicLevel, audio.setMusicLevel);
        const sfxInput = slider(panel, "Sound effects volume", audio.getSfxLevel, (v) => {
          audio.setSfxLevel(v);
          if (v > 0) audio.previewSfx();       // hear what you're setting
        });
        toggle(panel, "Sound effects", audio.isSfxOn, (on) => {
          audio.setSfxOn(on);
          if (on && Number(sfxInput.value) === 0) { sfxInput.value = "50"; audio.setSfxLevel(.5); }
        });
      } else {
        const p = document.createElement("p");
        p.textContent = "Audio controls are unavailable.";
        p.style.cssText = "opacity:.7";
        panel.appendChild(p);
      }

      toggle(panel, "Fullscreen", isFullscreen, setFullscreen);

      const note = document.createElement("p");
      note.textContent = "Settings are saved on this device.";
      note.style.cssText = "font-size:12px;opacity:.5;margin:6px 0 0";
      panel.appendChild(note);
    });
  }

  // ---- Credits -------------------------------------------------------------
  function openCredits() {
    openPanel("Credits", (panel) => {
      const sections = [
        ["Game", ["Runar Warberg"]],
        ["Music", [
          "Abstraction — Tallbeard Studios",
          "Licensed CC0 (public domain)"
        ]],
        ["Sound effects", [
          "Kenney — kenney.nl",
          "Licensed CC0 (public domain)"
        ]],
        ["Built with", [
          "Electron, Express and Socket.IO",
          "Rendering in plain HTML canvas"
        ]]
      ];
      for (const [heading, lines] of sections) {
        const h = document.createElement("div");
        h.textContent = heading;
        h.style.cssText = "font-size:12px;letter-spacing:.05em;text-transform:uppercase;opacity:.6;margin:14px 0 4px";
        panel.appendChild(h);
        for (const line of lines) {
          const p = document.createElement("div");
          p.textContent = line;
          p.style.cssText = "font-size:14px;line-height:1.5";
          panel.appendChild(p);
        }
      }
      const thanks = document.createElement("p");
      thanks.textContent = "The CC0 licences ask for nothing in return — credited because it is the decent thing to do.";
      thanks.style.cssText = "font-size:12px;opacity:.55;margin-top:18px;line-height:1.5";
      panel.appendChild(thanks);
    });
  }

  // ---- Unlockables & stats -------------------------------------------------
  function statTile(parent, value, label) {
    const t = document.createElement("div");
    t.style.cssText = "flex:1 1 90px;background:rgba(255,255,255,.05);border-radius:12px;padding:10px 12px";
    const v = document.createElement("div");
    v.textContent = String(value);
    v.style.cssText = "font-size:22px;font-weight:800;line-height:1.1";
    const l = document.createElement("div");
    l.textContent = label;
    l.style.cssText = "font-size:11px;opacity:.65;margin-top:2px";
    t.appendChild(v); t.appendChild(l);
    parent.appendChild(t);
  }

  function cosmeticChip(item) {
    const chip = document.createElement("div");
    const locked = !item.unlocked;
    chip.title = locked ? item.requirement : (item.name || item.label || item.value || "Unlocked");
    chip.style.cssText = [
      "display:flex", "align-items:center", "justify-content:center",
      "min-width:38px", "height:38px", "padding:0 8px", "border-radius:10px",
      "font-size:18px", "border:1px solid rgba(148,205,255,.2)",
      locked ? "opacity:.32" : "opacity:1",
      "background:rgba(255,255,255,.05)"
    ].join(";");

    if (item.type === "color") {
      chip.style.background = item.value;
      chip.style.minWidth = "38px";
      chip.textContent = locked ? "🔒" : "";
      if (locked) { chip.style.background = "rgba(255,255,255,.06)"; }
    } else if (item.type === "emoji") {
      // Custom face cosmetics are SVG badges; original animals remain emoji.
      if (locked) chip.textContent = "🔒";
      else if (typeof window.avatarGlyph === "function") chip.innerHTML = window.avatarGlyph(item.value);
      else chip.textContent = item.value;
    } else if (item.type === "title") {
      chip.textContent = locked ? "🔒" : (item.label || "—");
      chip.style.fontSize = "13px";
      chip.style.fontWeight = "700";
    } else {
      chip.textContent = locked ? "🔒" : (item.name || item.id);
      chip.style.fontSize = "13px";
      if (!locked && item.style && item.style.color) {
        chip.style.borderColor = item.style.color;
        chip.style.borderWidth = "2px";
      }
    }
    return chip;
  }

  function section(panel, heading, items) {
    const h = document.createElement("div");
    const got = items.filter((i) => i.unlocked).length;
    h.textContent = `${heading} — ${got}/${items.length}`;
    h.style.cssText = "font-size:12px;letter-spacing:.05em;text-transform:uppercase;opacity:.6;margin:16px 0 6px";
    panel.appendChild(h);
    const grid = document.createElement("div");
    grid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px";
    for (const item of items) grid.appendChild(cosmeticChip(item));
    panel.appendChild(grid);
  }

  function openUnlocks() {
    openPanel("Unlockables & stats", (panel) => {
      const progress = window.PlayerProgress;
      const catalogueOf = window.Progression;
      if (!progress || !catalogueOf) {
        const p = document.createElement("p");
        p.textContent = "Progress tracking is unavailable.";
        panel.appendChild(p);
        return;
      }
      const s = progress.summary();
      const tiles = document.createElement("div");
      tiles.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px";
      statTile(tiles, s.gamesPlayed, "Games played");
      statTile(tiles, s.gamesWon, "Games won");
      statTile(tiles, `${s.winRate}%`, "Win rate");
      statTile(tiles, s.bestStreak, "Best streak");
      panel.appendChild(tiles);

      if (s.favouriteMode) {
        const fav = document.createElement("div");
        fav.textContent = `Most played: ${s.favouriteMode} (${s.favouriteModePlays})`;
        fav.style.cssText = "font-size:12px;opacity:.6;margin-top:4px";
        panel.appendChild(fav);
      }

      const c = catalogueOf.catalogue(progress.stats);
      section(panel, "Characters", c.emojis);
      section(panel, "Colours", c.colors);
      section(panel, "Titles", c.titles.filter((t) => t.id !== "none"));
      section(panel, "Frames", c.frames.filter((f) => f.id !== "none"));

      const hint = document.createElement("p");
      hint.textContent = "Hover a locked item to see how to earn it. Progress is saved on this device.";
      hint.style.cssText = "font-size:12px;opacity:.5;margin-top:18px;line-height:1.5";
      panel.appendChild(hint);
    });
  }

  window.ConfettiMenu = { openSettings, openCredits, openUnlocks, closePanel };
})();
