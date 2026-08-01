"use strict";

/* Closest Wins — client. The server is authoritative; this file only renders
   state pushed from the server and forwards player actions. */

const socket = io();

// ---- Local view state -------------------------------------------------------
const state = {
  selfId: null,
  isHost: false,
  room: null,
  meta: null,
  mode: "trivia",
  unit: "",
  deadline: null,
  submitted: false
};

const MODE_INFO = {
  trivia:   { name: "Trivia",   emoji: "🧠", desc: "Everyone guesses a number at once. Closest wins." },
  timeline: { name: "Timeline", emoji: "🕰️", desc: "Hitster-style: slot each event into your timeline. First to the target wins." },
  curling:  { name: "Curling",  emoji: "🥌", desc: "Take turns — the leader shoots first and everyone sees each shot." },
  bomb:     { name: "Balloon",  emoji: "🎈", desc: "Take turns pumping 1–3 times. Whoever pops the balloon loses the round." }
};

// Character options — must match the server's allowed sets (server validates).
const AVATAR_EMOJIS = ["🦊","🐼","🐸","🐙","🦉","🐝","🦄","🐲","🐳","🦁","🐧","🦖","🐢","🐬","🦇","🐰"];
MODE_INFO.map = { name: "Place It", emoji: "🗺️", desc: "Drop a pin on the world map. Closest wins." };
MODE_INFO.platformer = { name: "Build & Race", emoji: "🏗️", desc: "Place an obstacle each round, then race the course." };
MODE_INFO.drawing = { name: "Drawing", emoji: "🎨", desc: "One player draws a secret word while everyone else guesses." };
MODE_INFO.pushy = { name: "Pushy", emoji: "🐧", desc: "Dodge the crowds and stay on the icy platform." };
MODE_INFO.redlight = { name: "Red Light", emoji: "🚦", desc: "Mash on green, freeze on red, and race to the finish." };
MODE_INFO.hidebomb = { name: "Hide and Go BOOM!", emoji: "💣", desc: "Hide in one of four cannons while the solo player lights three fuses." };
MODE_INFO.colorfloor = { name: "Color Twister", emoji: "🌈", desc: "Race onto the called color before every other tile turns to lava." };
MODE_INFO.vanish = { name: "Vanishing Grid", emoji: "🕳️", desc: "Every tile you step on crumbles. Be the last player standing." };
MODE_INFO.bombpass = { name: "Bomb Pass", emoji: "💣", desc: "Tag another player to pass the bomb before its hidden fuse runs out." };
MODE_INFO.fire = { name: "Playing with Fire", emoji: "💥", desc: "Place bombs, blast through crates, and be the last player standing." };
MODE_INFO.racing = { name: "Pocket Racers", emoji: "🏎️", desc: "Race tiny cars around a top-down circuit for three laps." };
MODE_INFO.flappy = { name: "Dragon Rider", emoji: "🐉", desc: "Guide your tiny dragon through a jagged canyon. Furthest distance wins." };
MODE_INFO.runner = { name: "Wild Run", emoji: "🏃", desc: "Run through an enchanted wilderness, leap over hazards, and go the furthest." };
MODE_INFO.painter = { name: "Territory Painter", emoji: "🎨", desc: "Every tile you touch becomes your color. Paint over rivals and claim the largest area." };
MODE_INFO.pong = { name: "Polygon Pong", emoji: "🏓", desc: "Defend your side of the arena. Three misses and you are out." };
MODE_INFO.doors = { name: "Choose a Door", emoji: "🚪", desc: "Pick through three mystery doors and survive their surprises." };
const AVATAR_COLORS = ["#ff6b6b","#ffcb3d","#4ade80","#60a5fa","#f472b6","#a78bfa","#22d3ee","#fb923c"];
const AVATAR_KEY = "closest-wins-avatar";
let myAvatar = loadAvatar();
function loadAvatar() {
  try {
    const a = JSON.parse(localStorage.getItem(AVATAR_KEY) || "null");
    if (a && AVATAR_EMOJIS.includes(a.emoji) && AVATAR_COLORS.includes(a.color)) return a;
  } catch {}
  return { emoji: AVATAR_EMOJIS[Math.floor(Math.random()*AVATAR_EMOJIS.length)],
           color: AVATAR_COLORS[Math.floor(Math.random()*AVATAR_COLORS.length)] };
}
function saveAvatar() { try { localStorage.setItem(AVATAR_KEY, JSON.stringify(myAvatar)); } catch {} }

/** Small avatar chip for a player object (or an {emoji,color} avatar). */
function avatarHtml(av) {
  const a = (av && av.avatar) ? av.avatar : av;
  const emoji = (a && a.emoji) || "🎮";
  const color = (a && a.color) || "#888";
  return `<span class="ava" style="background:${esc(color)}">${esc(emoji)}</span>`;
}

// Session persistence so a page refresh rejoins the same game.
const SESSION_KEY = "closest-wins-session";
function saveSession(code, token) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, token })); } catch {}
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

let timerInterval = null;

// ---- Element helpers --------------------------------------------------------
const $ = (id) => document.getElementById(id);
const screens = {
  home: $("screen-home"),
  lobby: $("screen-lobby"),
  question: $("screen-question"),
  turn: $("screen-turn"),
  map: $("screen-map"),
  platformer: $("screen-platformer"),
  drawing: $("screen-drawing"),
  pushy: $("screen-pushy"),
  redlight: $("screen-redlight"),
  hidebomb: $("screen-hidebomb"),
  arena: $("screen-arena"),
  doors: $("screen-doors"),
  results: $("screen-results"),
  intermission: $("screen-intermission"),
  final: $("screen-final")
};

let currentScreen = "home";
function showScreen(name) {
  currentScreen = name;
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle("hidden", key !== name);
  }
  // The Leave button is available whenever we're in a room.
  $("leave-top-btn").classList.toggle("hidden", name === "home");
}

// ---- Reusable confirm dialog -----------------------------------------------
let _confirmResolve = null;
function confirmDialog({ title = "Are you sure?", text = "", confirmLabel = "Confirm", danger = false } = {}) {
  $("modal-title").textContent = title;
  $("modal-text").textContent = text;
  const cbtn = $("modal-confirm");
  cbtn.textContent = confirmLabel;
  cbtn.classList.toggle("btn-danger", danger);
  $("modal-overlay").classList.remove("hidden");
  return new Promise((resolve) => { _confirmResolve = resolve; });
}
function closeModal(result) {
  $("modal-overlay").classList.add("hidden");
  if (_confirmResolve) { _confirmResolve(result); _confirmResolve = null; }
}
$("modal-cancel").addEventListener("click", () => closeModal(false));
$("modal-confirm").addEventListener("click", () => closeModal(true));
$("modal-overlay").addEventListener("click", (e) => { if (e.target === $("modal-overlay")) closeModal(false); });

$("leave-top-btn").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Leave the room?",
    text: "You'll return to the home screen and drop out of the current game.",
    confirmLabel: "Leave", danger: true
  });
  if (!ok) return;
  socket.emit("room:leave");
  clearSession();
  resetToHome();
});

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function fmt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function flashError(el, message) {
  el.textContent = message;
  if (message) setTimeout(() => { if (el.textContent === message) el.textContent = ""; }, 4000);
}

// ---- Sound ------------------------------------------------------------------
const sound = {
  on: true, ctx: null,
  ensure() {
    if (!this.ctx && typeof AudioContext !== "undefined") this.ctx = new AudioContext();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  beep(freq = 440, dur = 0.12, type = "sine", gain = 0.05) {
    if (!this.on) return;
    this.ensure();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type; osc.frequency.value = freq; g.gain.value = gain;
    osc.connect(g).connect(this.ctx.destination);
    const t = this.ctx.currentTime;
    osc.start(t);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.stop(t + dur);
  },
  chord(freqs, dur = 0.4) {
    freqs.forEach((f, i) => setTimeout(() => this.beep(f, dur, "triangle", 0.04), i * 90));
  },
  // Character reactions.
  happy() { [523, 659, 880].forEach((f, i) => setTimeout(() => this.beep(f, 0.16, "triangle", 0.05), i * 80)); },
  neutral() { this.beep(440, 0.14, "sine", 0.04); },
  sad() { [440, 349, 262].forEach((f, i) => setTimeout(() => this.beep(f, 0.22, "sine", 0.05), i * 130)); }
};

$("sound-btn").addEventListener("click", () => {
  sound.on = !sound.on;
  $("sound-btn").textContent = sound.on ? "🔊" : "🔇";
  if (sound.on) { sound.ensure(); sound.beep(660, 0.1); }
});

// ---- Character creator ------------------------------------------------------
function buildCreator() {
  const eg = $("emoji-grid");
  eg.innerHTML = "";
  AVATAR_EMOJIS.forEach((em) => {
    const b = document.createElement("button");
    b.className = "emoji-opt" + (em === myAvatar.emoji ? " on" : "");
    b.textContent = em;
    b.addEventListener("click", () => { myAvatar.emoji = em; saveAvatar(); buildCreator(); });
    eg.appendChild(b);
  });
  const cg = $("color-grid");
  cg.innerHTML = "";
  AVATAR_COLORS.forEach((col) => {
    const b = document.createElement("button");
    b.className = "color-opt" + (col === myAvatar.color ? " on" : "");
    b.style.background = col;
    b.addEventListener("click", () => { myAvatar.color = col; saveAvatar(); buildCreator(); });
    cg.appendChild(b);
  });
  const pv = $("char-preview");
  pv.textContent = myAvatar.emoji;
  pv.style.background = myAvatar.color;
}

// ---- Home -------------------------------------------------------------------
$("create-btn").addEventListener("click", () => {
  sound.ensure();
  const name = $("name-input").value.trim();
  if (name.length < 2) return flashError($("home-error"), "Enter a name (2–20 characters).");
  socket.emit("room:create", { playerName: name, avatar: myAvatar });
});
$("test-btn").addEventListener("click", () => {
  const name = $("name-input").value.trim() || "Tester";
  $("home-error").textContent = "";
  socket.emit("test:create", { playerName: name, avatar: myAvatar });
});
$("join-btn").addEventListener("click", () => {
  sound.ensure();
  const name = $("name-input").value.trim();
  const code = $("code-input").value.trim().toUpperCase();
  if (name.length < 2) return flashError($("home-error"), "Enter a name (2–20 characters).");
  if (code.length !== 6) return flashError($("home-error"), "Room codes are 6 characters.");
  socket.emit("room:join", { roomCode: code, playerName: name, avatar: myAvatar });
});
$("code-input").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });
$("code-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("join-btn").click(); });
$("name-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("create-btn").click(); });

// ---- Lobby ------------------------------------------------------------------
$("copy-btn").addEventListener("click", async () => {
  if (!state.room) return;
  const link = `${location.origin}/?room=${state.room.code}`;
  try {
    await navigator.clipboard.writeText(link);
    $("copy-btn").textContent = "Link copied!";
    setTimeout(() => { $("copy-btn").textContent = "Copy invite link"; }, 1500);
  } catch { $("copy-btn").textContent = state.room.code; }
});
$("start-btn").addEventListener("click", () => { sound.beep(520, 0.1); socket.emit("game:start"); });

// ---- Question (trivia / timeline) ------------------------------------------
$("submit-btn").addEventListener("click", () => {
  const raw = $("guess-input").value;
  if (raw === "" || raw === null) return flashError($("question-error"), "Enter a number.");
  const guess = Number(raw);
  if (!Number.isFinite(guess)) return flashError($("question-error"), "That is not a valid number.");
  sound.beep(600, 0.09);
  socket.emit("guess:submit", { guess });
});
$("guess-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("submit-btn").click(); });

// ---- Turn (curling) ---------------------------------------------------------
$("turn-submit").addEventListener("click", () => {
  if(state.mode==="curling"){curlingPress();return;}
  const raw = $("turn-guess").value;
  if (raw === "" || raw === null) return flashError($("turn-error"), "Enter a number.");
  const guess = Number(raw);
  if (!Number.isFinite(guess)) return flashError($("turn-error"), "That is not a valid number.");
  sound.beep(600, 0.09);
  socket.emit("guess:submit", { guess });
  $("turn-submit").disabled = true;
});
$("turn-guess").addEventListener("keydown", (e) => { if (e.key === "Enter") $("turn-submit").click(); });
window.addEventListener("keydown",(e)=>{
  if(currentScreen==="turn"&&state.mode==="curling"&&e.code==="Space"&&!e.repeat){
    e.preventDefault();curlingPress();
  }
});
$("turn-guess").addEventListener("input",()=>{$("curling-power-value").textContent=$("turn-guess").value;});

// ---- Turn (bomb) ------------------------------------------------------------
document.querySelectorAll(".press-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const times = Number(btn.dataset.times);
    sound.beep(240 + times * 80, 0.07, "square", 0.04);
    socket.emit("bomb:press", { times });
    document.querySelectorAll(".press-btn").forEach((b) => (b.disabled = true));
  });
});

// ---- Results / Final --------------------------------------------------------
$("next-btn").addEventListener("click", () => { sound.beep(520, 0.1); socket.emit("round:next"); });
$("playagain-btn").addEventListener("click", () => socket.emit("game:restart"));
$("leave-btn").addEventListener("click", async () => {
  const ok = await confirmDialog({ title: "Leave the room?", confirmLabel: "Leave", danger: true });
  if (!ok) return;
  socket.emit("room:leave"); clearSession(); resetToHome();
});
function resetToHome() {
  state.room = null; state.isHost = false; state.submitted = false;
  stopTimer(); showScreen("home");
}

// ===================== CONNECTION / RECONNECT =====================
socket.on("connect", () => {
  hideBanner();
  const saved = loadSession();
  if (saved && saved.code && saved.token && currentScreen === "home") {
    socket.emit("room:rejoin", { roomCode: saved.code, token: saved.token });
  }
});
socket.on("disconnect", () => { if (currentScreen !== "home") showBanner("Reconnecting…"); });

socket.on("room:resumed", ({ room, youAreHost, selfId, token, meta, resume }) => {
  hideBanner();
  state.selfId = selfId; state.isHost = youAreHost; state.room = room;
  if (meta) state.meta = meta;
  state.mode = resume.mode || room.settings?.mode || "trivia";
  saveSession(room.code, token);

  if (resume.state === "question" && resume.hidebomb) {
    applyHideBombState(resume.hidebomb);
  } else if (resume.state === "question" && resume.arena) {
    applyArenaStart(resume.arena);
  } else if (resume.state === "question" && resume.doors) {
    applyDoorsChoose(resume.doors);
  } else if (resume.state === "question" && resume.redlight) {
    applyRedLightStart(resume.redlight);
  } else if (resume.state === "question" && resume.drawing) {
    applyDrawingStart(resume.drawing);
  } else if (resume.state === "question" && resume.pushy) {
    applyPushyStart(resume.pushy);
  } else if (resume.state === "question" && resume.platformer) {
    if (resume.platformer.phase === "mapvote") applyPlatformerMapVote(resume.platformer);
    else if (resume.platformer.phase === "maproulette") {
      applyPlatformerMapVote(resume.platformer);
      applyPlatformerMapSelected(resume.platformer);
    } else if (resume.platformer.phase === "build") applyPlatformerBuild(resume.platformer);
    else applyPlatformerRace(resume.platformer);
  } else if (resume.state === "question" && resume.question && resume.question.mode === "map") {
    applyMapQuestion(resume.question, { alreadyGuessed: resume.yourGuess !== null, guess: resume.yourGuess });
  } else if (resume.state === "question" && resume.question) {
    applyQuestion(resume.question, { alreadyGuessed: resume.yourGuess !== null, guess: resume.yourGuess });
    if (resume.progress) $("progress-label").textContent =
      `${resume.progress.answered} of ${resume.progress.total} players have answered`;
  } else if (resume.state === "question" && resume.turn) {
    applyTurn(resume.turn);
  } else if (resume.state === "results" && resume.results) {
    renderResults(resume.results); showScreen("results");
  } else if (resume.state === "intermission" && resume.intermission) {
    renderIntermission(resume.intermission); showScreen("intermission");
  } else if (resume.state === "finished" && resume.final) {
    renderFinal(resume.final, { silent: true }); showScreen("final");
  } else {
    renderLobby(room); showScreen("lobby");
  }
});
socket.on("room:rejoin:failed", () => { clearSession(); hideBanner(); });

// ===================== SOCKET EVENTS =====================
socket.on("room:error", ({ message }) => {
  if (currentScreen === "question") flashError($("question-error"), message);
  else if (currentScreen === "turn") flashError($("turn-error"), message);
  else if (currentScreen === "platformer") flashError($("platformer-status"), message);
  else if (currentScreen === "drawing") flashError($("drawing-status"), message);
  else if (currentScreen === "pushy") flashError($("pushy-status"), message);
  else if (currentScreen === "redlight") flashError($("redlight-status"), message);
  else if (currentScreen === "hidebomb") flashError($("hidebomb-status"), message);
  else flashError($("home-error"), message);
  sound.beep(200, 0.2, "sawtooth", 0.03);
});

socket.on("room:created", ({ room, youAreHost, selfId, token, meta }) => enterLobby(room, youAreHost, selfId, token, meta));
socket.on("room:joined", ({ room, youAreHost, selfId, token, meta }) => enterLobby(room, youAreHost, selfId, token, meta));
function enterLobby(room, youAreHost, selfId, token, meta) {
  state.selfId = selfId; state.isHost = youAreHost; state.room = room;
  if (meta) state.meta = meta;
  saveSession(room.code, token);
  renderLobby(room); showScreen("lobby");
}

socket.on("room:updated", (room) => {
  state.room = room;
  state.isHost = room.hostId === state.selfId;
  state.mode = room.currentMode || room.settings?.mode || "trivia";
  if (room.state === "lobby") { renderLobby(room); showScreen("lobby"); }
  else if (room.state === "question" && currentScreen === "question") updateQuestionProgressFromRoom(room);
});

socket.on("host:changed", ({ hostId }) => {
  state.isHost = hostId === state.selfId;
  if (state.room) {
    state.room.hostId = hostId;
    if (currentScreen === "lobby") renderLobby(state.room);
    if (currentScreen === "results") updateResultsHostControls();
    if (currentScreen === "final") updateFinalHostControls();
    if (state.isHost) showBanner("You are now the host.", 2500);
  }
});

// Simultaneous modes.
socket.on("round:question", (payload) => {
  state.mode = payload.mode || "trivia";
  if (payload.mode === "map") applyMapQuestion(payload, { alreadyGuessed: false });
  else applyQuestion(payload, { alreadyGuessed: false });
  sound.beep(700, 0.08);
});
socket.on("guess:accepted", ({ guess }) => {
  state.submitted = true;
  if (currentScreen === "map") {
    $("map-submit").disabled = true;
    $("map-submit").textContent = "Submitted ✓";
    $("map-hint").textContent = "Location submitted. Waiting for others…";
  } else if (currentScreen === "turn") {
    $("curling-input").classList.add("hidden");
    $("curling-wait").textContent = "Shot taken. Waiting for the others…";
  } else {
    $("submitted-value").textContent = `${fmt(guess)} ${esc(state.unit)}`.trim();
    $("guess-area").classList.add("hidden");
    $("submitted-area").classList.remove("hidden");
  }
});
socket.on("round:progress", ({ answered, total }) => {
  const txt = `${answered} of ${total} players have answered`;
  $("progress-label").textContent = txt;
  $("map-progress").textContent = txt;
});

// Turn modes.
socket.on("turn:started", (payload) => { state.mode = payload.mode; applyTurn(payload); });
socket.on("turn:update", (payload) => {
  if (payload.mode === "curling") updateCurling(payload);
  else if (payload.mode === "bomb") updateBomb(payload);
});
socket.on("timeline:votes", ({ votes }) => { updateVotes(votes); });
socket.on("timeline:result", (payload) => {
  if (payload.teamVote) showTeamResult(payload);
  else showTimelineToast(payload);
});
socket.on("platformer:build", applyPlatformerBuild);
socket.on("platformer:map-vote", applyPlatformerMapVote);
socket.on("platformer:map-votes", ({ votes, votedPlayerIds }) => {
  if(platformer.phase!=="mapvote")return;
  platformer.mapVotes=votes||{};platformer.votedPlayerIds=votedPlayerIds||[];
  renderPlatformerMapVotes();
});
socket.on("platformer:map-selected", applyPlatformerMapSelected);
socket.on("platformer:placed", ({ placements, pool, builders, removableTiles }) => {
  if (!platformer.view || platformer.phase !== "build") return;
  platformer.view.placements = placements || [];
  if (pool) platformer.view.pool = pool;
  if (builders) platformer.view.builders = builders;
  if (removableTiles) platformer.view.removableTiles = removableTiles;
  updatePlatformerLock();
  renderPlatformerTools();
  drawPlatformer();
});
socket.on("platformer:builders", ({ builders, pool }) => {
  if (!platformer.view || platformer.phase !== "build") return;
  platformer.view.builders = builders || [];
  platformer.view.pool = pool || platformer.view.pool;
  const mine = platformer.view.builders.find((p) => p.playerId === state.selfId);
  platformer.selected = mine?.selected || null;
  renderPlatformerTools();
  drawPlatformer();
});
socket.on("platformer:race", applyPlatformerRace);
socket.on("platformer:positions", ({ players }) => updatePlatformerPositions(players));
socket.on("platformer:progress", ({ done, total }) => {
  $("platformer-status").textContent = `${done} of ${total} racers finished`;
});
socket.on("drawing:start", applyDrawingStart);
socket.on("drawing:secret", ({ word }) => {
  drawing.word = word;
  $("drawing-title").textContent = `Draw: ${word}`;
});
socket.on("drawing:stroke", drawRemoteStroke);
socket.on("drawing:cleared", clearDrawingCanvas);
socket.on("drawing:guess", showDrawingGuess);
socket.on("pushy:start", applyPushyStart);
socket.on("pushy:progress", ({ done, total }) => {
  $("pushy-status").textContent = `${done} of ${total} players finished`;
});
socket.on("pushy:positions", ({ players }) => updatePushyPositions(players));
socket.on("redlight:start", applyRedLightStart);
socket.on("redlight:light", ({ light, players }) => {
  redlight.light = light; renderRedLightSignal(); renderRedLightPlayers(players);
});
socket.on("redlight:progress", ({ players }) => renderRedLightPlayers(players));
socket.on("redlight:caught", ({ playerId, name, players }) => {
  renderRedLightPlayers(players);
  if (playerId === state.selfId) {
    redlight.done = true;
    stopRedLightMove();
    $("redlight-status").textContent = "Caught moving on red! You’re out.";
    $("redlight-move").disabled = true;
  } else {
    $("redlight-status").textContent = `${name} moved on red and was eliminated.`;
  }
});
socket.on("redlight:feint", ({ durationMs }) => {
  if (redlight.light !== "green") return;
  const signal = $("redlight-signal");
  signal.classList.remove("green"); signal.classList.add("red");
  $("redlight-title").textContent = "RED LIGHT?";
  setTimeout(() => { if (redlight.light === "green") renderRedLightSignal(); }, durationMs || 450);
});
socket.on("redlight:battery", ({ battery }) => {
  redlight.battery = battery;
  renderRedLightBattery();
});
socket.on("hidebomb:start", applyHideBombState);
socket.on("hidebomb:attack", applyHideBombState);
socket.on("hidebomb:ignite", (payload) => {
  applyHideBombState(payload);
  sound.beep(760, .08, "square", .025);
  setTimeout(() => sound.beep(920, .08, "square", .02), 700);
  setTimeout(() => sound.beep(1120, .1, "square", .02), 1400);
});
socket.on("hidebomb:chosen", ({ objectIndex }) => {
  hidebomb.ownChoice = objectIndex;
  renderHideBombBoard();
  $("hidebomb-status").textContent = "Hidden! Waiting for the other players…";
});
socket.on("hidebomb:progress", ({ hidden, total }) => {
  $("hidebomb-status").textContent = `${hidden} of ${total} players are hidden`;
});
socket.on("hidebomb:reveal", applyHideBombReveal);
socket.on("arena:start", applyArenaStart);
socket.on("arena:positions", ({ players, holderId }) => {
  arena.holderId = holderId;
  updateArenaPlayers(players);
});
socket.on("arena:eliminated", ({ playerId, reason }) => {
  const p = arena.players.get(playerId);
  const eliminatedAt = performance.now();
  if (p) {
    p.eliminated = true;
    p.visualEliminatedAt ||= eliminatedAt;
    p.eliminationDirection ||= p.x < 360 ? -1 : 1;
  }
  if(playerId===state.selfId&&arena.player){
    arena.player.visualEliminatedAt ||= eliminatedAt;
    arena.player.eliminationDirection ||= arena.player.x < 360 ? -1 : 1;
  }
  if (playerId === state.selfId) {
    arena.done = true;
    $("arena-status").textContent = reason === "exploded" ? "BOOM! You’re out." :
      reason === "miss" ? "No hearts left—watch the remaining paddles!" : "You fell! Watch the survivors.";
  }
  arena.bursts.push({x:p?.x||360,y:p?.y||220,born:performance.now(),color:reason==="lava"?"#fb923c":"#7dd3fc",count:18});
  const canvas=$("arena-canvas");canvas.classList.remove("shake");void canvas.offsetWidth;canvas.classList.add("shake");
});
socket.on("arena:jumped", ({playerId,jumpingUntil}) => {
  const p=arena.players.get(playerId);
  if(p)p.jumpingUntil=jumpingUntil;
  if(playerId===state.selfId&&arena.player)arena.player.jumpingUntil=jumpingUntil;
});
socket.on("arena:bump", ({targetId,intensity,nx,ny,racing,impulses}) => {
  const target=targetId===state.selfId?arena.player:arena.players.get(targetId);
  if(target)target.bumpUntil=performance.now()+220+intensity*180;
  if(racing&&impulses){
    for(const [id,impulse] of Object.entries(impulses)){
      const car=id===state.selfId?arena.player:arena.players.get(id);
      if(!car)continue;
      car.impactVx=(car.impactVx||0)*.35+(Number(impulse.x)||0);
      car.impactVy=(car.impactVy||0)*.35+(Number(impulse.y)||0);
      car.bumpUntil=performance.now()+240+intensity*180;
      if(id===state.selfId)car.speed=(car.speed||0)*(1-intensity*.16);
    }
  }
  arena.bursts.push({x:target?.x||360,y:target?.y||220,born:performance.now(),color:"#fef08a",count:5+Math.round(intensity*7)});
  if(targetId===state.selfId)sound.beep(145+intensity*90,.045,"square",.018);
});
socket.on("arena:layer", ({playerId,layer}) => {
  const p=arena.players.get(playerId);
  if(p)p.layer=layer;
  if(playerId===state.selfId&&arena.player){
    arena.player.layer=layer;arena.player.fellAt=performance.now();
    arena.fallFlash={at:performance.now(),floor:layer+1};
    $("arena-status").textContent=layer<VANISH.layers-1?`You fell to floor ${layer+1}!`:"Last floor—keep moving!";
  }
  const source=playerId===state.selfId?arena.player:p;
  arena.bursts.push({x:source?.x||360,y:source?.y||220,born:performance.now(),color:"#93c5fd",count:20});
  const canvas=$("arena-canvas");canvas.classList.remove("shake");void canvas.offsetWidth;canvas.classList.add("shake");
});
socket.on("colorfloor:signal", applyColorSignal);
socket.on("vanish:tile", (tile) => {
  arena.tiles.set(tile.key, tile);
  if(arena.localTileTimes)arena.localTileTimes.delete(tile.key);
  const [layer,col,row]=tile.key.split(":").map(Number);
  const rc=cellRect(col,row);
  // Tag the dust with its floor so it's drawn ON that floor, not bleeding onto ours.
  arena.bursts.push({x:rc.x+VANISH.tw/2,y:rc.y+VANISH.th/2,born:performance.now(),color:"#fde68a",count:7,layer});
});
socket.on("bombpass:holder", ({ holderId, fromId }) => {
  arena.holderId = holderId;
  arena.holderSince = performance.now();
  $("arena-status").textContent = holderId === state.selfId ? "You have the bomb—tag someone!" :
    (fromId === state.selfId ? "Passed! Get away!" : "");
});
socket.on("arena:fire", ({bombs,blasts,crates,powerups}) => {
  arena.bombs=bombs||[];arena.blasts=blasts||[];arena.crates=crates||[];
  if(powerups)arena.powerups=powerups;
});
socket.on("arena:powerup", ({playerId,type,upgrades}) => {
  const target=playerId===state.selfId?arena.player:arena.players.get(playerId);
  if(target)target.upgrades=upgrades;
  const labels={range:"BIGGER BLAST!",bombs:"EXTRA BOMB!",speed:"SPEED UP!"};
  if(playerId===state.selfId){$("arena-status").textContent=labels[type]||"POWER UP!";sound.happy();}
});
socket.on("arena:racer-finished", ({playerId,place}) => {
  const p=arena.players.get(playerId);if(p)p.finished=true;
  if(place===1)arena.raceCelebration={started:performance.now(),playerId};
  if(playerId===state.selfId){arena.done=true;$("arena-status").textContent=`Finished #${place}!`;}
});
socket.on("arena:checkpoint", ({playerId,checkpoint,checkpointCount,lap}) => {
  if(playerId!==state.selfId||checkpoint<=0)return;
  $("arena-status").textContent=`Lap ${Math.min(3,(lap||0)+1)} · checkpoint ${checkpoint}/${checkpointCount}`;
});
socket.on("arena:racer-crashed", ({playerId,from,respawn}) => {
  const target=playerId===state.selfId?arena.player:arena.players.get(playerId);
  if(!target)return;
  target.crashVisual={started:performance.now(),from,respawn};
  target.speed=0;
  if(playerId===state.selfId)$("arena-status").textContent="Off the track! Respawning…";
});
socket.on("arena:flap",({playerId,vy})=>{
  const p=playerId===state.selfId?arena.player:arena.players.get(playerId);
  if(p)p.vy=vy;
});
socket.on("arena:flappy-obstacles",({obstacles})=>{
  if(Array.isArray(obstacles))arena.obstacles.push(...obstacles);
});
socket.on("arena:runner-coin",({playerId,index,coins})=>{
  const p=playerId===state.selfId?arena.player:arena.players.get(playerId);
  if(p){p.coins=coins;p.collectedCoins??=[];p.collectedCoins.push(index);}
  if(playerId===state.selfId){sound.beep(760,.05,"sine",.025);arena.runnerFlash={text:`COIN SPEED +${coins}`,at:performance.now(),color:"#fde047"};}
});
socket.on("arena:runner-perfect",({playerId,type})=>{
  const p=playerId===state.selfId?arena.player:arena.players.get(playerId);if(p)p.perfects=(p.perfects||0)+1;
  if(playerId===state.selfId){if(p)p.boostUntil=Date.now()+1300;sound.beep(940,.08,"triangle",.03);arena.runnerFlash={text:`PERFECT ${type.toUpperCase()}!`,at:performance.now(),color:"#67e8f9"};}
});
socket.on("arena:painter",({territory,trails,players})=>{
  arena.painterTerritory=territory||{};arena.painterTrails=trails||{};updateArenaPlayers(players||[]);
  const own=(players||[]).find((p)=>p.playerId===state.selfId);
  if(own&&arena.player&&Math.hypot(own.x-arena.player.x,own.y-arena.player.y)>80){arena.player.x=own.x;arena.player.y=own.y;arena.player.vx=0;arena.player.vy=0;}
  updatePainterLegend();
});
socket.on("arena:painter-buckets",({buckets})=>{arena.painterBuckets=buckets||[];});
socket.on("arena:painter-bucket",({playerId,type,buckets})=>{
  arena.painterBuckets=buckets||arena.painterBuckets||[];
  const who=playerId===state.selfId?"YOU":(arena.players.get(playerId)?.name||"A PLAYER");
  arena.painterFlash={text:`${who} SPILLED A ${type.toUpperCase()} BUCKET!`,at:performance.now()};
  sound.beep(type==="lightning"?180:(playerId===state.selfId?820:540),type==="lightning" ? .22 : .14,type==="lightning"?"sawtooth":"triangle",.03);
});
socket.on("arena:painter-capture",({playerId})=>{if(playerId===state.selfId){sound.beep(760,.12,"triangle",.03);arena.painterFlash={text:"LOOP COMPLETE!",at:performance.now()};}});
socket.on("arena:painter-cut",({playerId,by})=>{if(playerId===state.selfId){sound.beep(120,.18,"sawtooth",.035);arena.painterFlash={text:by===playerId?"LOOP BROKEN!":"TRAIL CUT!",at:performance.now()};}});
socket.on("arena:pong",({balls,lives,players})=>{
  arena.balls=balls||[];arena.ballReceivedAt=performance.now();arena.lives=lives||{};updateArenaPlayers(players||[]);
});
socket.on("arena:pong-life",({playerId,lives,side})=>{
  arena.lives[playerId]=lives;
  arena.pongLifeEffects??=[];
  arena.pongLifeEffects.push({playerId,side,started:performance.now()});
  const canvas=$("arena-canvas");canvas.classList.remove("shake");void canvas.offsetWidth;canvas.classList.add("shake");
  sound.beep(105,.16,"sawtooth",.035);
  if(playerId===state.selfId){$("arena-status").textContent=lives?`You have ${lives} heart${lives===1?"":"s"} left!`:"You’re out!";}
});
socket.on("arena:pong-ball",({count})=>{
  $("arena-status").textContent=`MULTIBALL! ${count} balls in play`;
  sound.beep(720,.12,"square",.03);
});
socket.on("doors:choose", applyDoorsChoose);
socket.on("doors:selected", ({ doorIndex }) => { doors.selected = doorIndex; renderDoors(); });
socket.on("doors:progress", ({ chosen, total }) => { $("doors-status").textContent = `${chosen} of ${total} players chose`; });
socket.on("doors:reveal", applyDoorsReveal);
socket.on("doors:positions", ({players}) => updateDoorPlayers(players));

socket.on("round:results", (payload) => {
  stopTimer();
  state.mode = payload.mode || state.mode;
  if(payload.mode==="curling"&&curlingVisual.anim){
    curlingVisual.pendingResults=payload;
    $("curling-input").classList.add("hidden");
    $("curling-wait").textContent="Final shot — watch it settle…";
    return;
  }
  if (payload.mode === "bomb" && balloonActiveNow()) {
    // Don't pop yet — let the queued pumps finish, walk the popper up for the
    // final pump, and only then burst + fling them off. Results follow.
    const finalJumps = Math.max(1, Math.min(3, (payload.total ?? 0) - (balloon.prevTotal ?? 0)));
    balloon.prevTotal = payload.total ?? balloon.prevTotal;
    balloon.turnActiveId = payload.popperId || balloon.turnActiveId;
    balloon.pendingPop = { payload };
    balloon.popResolve = () => { renderResults(payload); showScreen("results"); };
    bombPump(balloon.turnActiveId, finalJumps, true);
    if (!balloon.active && !balloon.pumpBacklog.length) { // couldn't animate — just show it
      const r = balloon.popResolve; balloon.popResolve = null; balloon.pendingPop = null; r(); return;
    }
    balloon.popFallback = setTimeout(() => {
      if (balloon.popResolve) { const r = balloon.popResolve; balloon.popResolve = null; balloon.pendingPop = null; balloon.burst = null; r(); }
    }, 9000);
    startBalloonLoop();
    return;
  }
  renderResults(payload);
  showScreen("results");
  sound.beep(payload.mode === "bomb" ? 130 : 880, 0.14, "triangle");
});

socket.on("arcade:intermission", (payload) => { renderIntermission(payload); showScreen("intermission"); });
socket.on("game:finished", (payload) => { renderFinal(payload); showScreen("final"); });

$("inter-next-btn").addEventListener("click", () => { sound.beep(560, 0.1); socket.emit("arcade:advance"); });

function renderIntermission(payload) {
  const leg = (payload.legIndex ?? 0) + 1;
  const total = payload.totalLegs ?? 1;
  $("inter-kicker").textContent = `GAME ${leg} OF ${total} COMPLETE`;
  const nm = MODE_INFO[payload.nextMode] || {};
  $("inter-next").textContent = `Up next: ${nm.emoji || ""} ${nm.name || payload.nextMode}`;
  $("inter-progress").textContent = `${nm.desc || ""}`;

  const list = $("inter-standings");
  list.innerHTML = "";
  (payload.standings || []).forEach((s, i) => {
    const li = document.createElement("li");
    if (s.playerId === state.selfId) li.classList.add("self");
    const medal = ["🥇", "🥈", "🥉"][i] || (i + 1);
    li.innerHTML =
      `<span class="rank">${medal}</span>` +
      `<div class="r-main"><div class="r-top"><span class="r-name">${avatarHtml(s.avatar)} ${esc(s.name)}</span>` +
      `${s.cumulativeDistanceKm != null ? `<span class="r-guess">${fmt(s.cumulativeDistanceKm)} km total error</span>` : ""}</div></div>` +
      `<span class="r-points">${fmt(s.score)}</span>`;
    list.appendChild(li);
  });

  if (state.isHost) {
    $("inter-next-btn").classList.remove("hidden");
    $("inter-host-note").textContent = "";
  } else {
    $("inter-next-btn").classList.add("hidden");
    $("inter-host-note").textContent = "Waiting for the host to start the next game.";
  }
  sound.chord([440, 587, 740], 0.3);
}

// ===================== LOBBY + SETTINGS =====================
function renderLobby(room) {
  $("lobby-code").textContent = room.code;
  const list = $("lobby-players");
  list.innerHTML = "";
  for (const p of room.players) {
    const li = document.createElement("li");
    const isSelf = p.id === state.selfId;
    const isHost = p.id === room.hostId;
    li.innerHTML =
      avatarHtml(p) +
      `<span class="player-name ${isSelf ? "self" : ""}">${esc(p.name)}</span>` +
      (isHost ? `<span class="badge">HOST</span>` : (p.isBot ? `<span class="badge">BOT</span>` :
        (isSelf ? `<span class="badge you">YOU</span>` : "")));
    list.appendChild(li);
  }

  renderSettings(room);

  const count = room.players.filter((p) => p.connected).length;
  $("lobby-status").textContent = count < 2
    ? "Waiting for more players to join…" : `${count} players ready.`;

  if (state.isHost) {
    $("start-btn").classList.remove("hidden");
    $("start-btn").disabled = count < 2;
    $("lobby-host-note").textContent = count < 2 ? "Need at least 2 players to start." : "";
  } else {
    $("start-btn").classList.add("hidden");
    $("lobby-host-note").textContent = "Only the host can change settings and start.";
  }
}

function seg(containerId, options, current, onPick) {
  const c = $(containerId);
  c.innerHTML = "";
  for (const opt of options) {
    const b = document.createElement("button");
    b.className = "seg-btn" + (opt.value === current ? " active" : "");
    b.innerHTML = opt.label;
    b.disabled = !state.isHost;
    b.addEventListener("click", () => onPick(opt.value));
    c.appendChild(b);
  }
}

function renderSettings(room) {
  const s = room.settings || {};
  const meta = state.meta || { modes: ["trivia"], rounds: [5], seconds: [45], targets: [11], categoriesByMode: {} };
  const arcade = !!s.arcade;
  const playlist = Array.isArray(s.playlist) ? s.playlist : [];

  seg("set-arcade",
    [{ value: false, label: "Off" }, { value: true, label: "🎮 On" }],
    arcade, (v) => socket.emit("settings:update", { arcade: v }));

  // Mode selector (single mode) vs playlist builder (arcade).
  $("set-mode-wrap").classList.toggle("hidden", arcade);
  $("mode-desc").classList.toggle("hidden", arcade);
  $("set-playlist-wrap").classList.toggle("hidden", !arcade);

  if (!arcade) {
    seg("set-mode",
      meta.modes.map((m) => ({ value: m, label: `${MODE_INFO[m]?.emoji || ""} ${MODE_INFO[m]?.name || m}` })),
      s.mode,
      (v) => socket.emit("settings:update", { mode: v, categories: null }));
    $("mode-desc").textContent = MODE_INFO[s.mode]?.desc || "";
  } else {
    const box = $("set-playlist");
    box.innerHTML = "";
    meta.modes.forEach((m) => {
      const pos = playlist.indexOf(m);
      const chip = document.createElement("button");
      chip.className = "chip" + (pos >= 0 ? " on" : "");
      chip.innerHTML = `${MODE_INFO[m]?.emoji || ""} ${MODE_INFO[m]?.name || m}` +
        (pos >= 0 ? ` <b>${pos + 1}</b>` : "");
      chip.disabled = !state.isHost;
      chip.addEventListener("click", () => {
        let next = playlist.slice();
        if (pos >= 0) next.splice(pos, 1); else next.push(m);
        if (next.length === 0) next = [m]; // keep at least one
        socket.emit("settings:update", { playlist: next, arcade: true });
      });
      box.appendChild(chip);
    });
    $("playlist-preview").textContent = playlist.length
      ? "Order: " + playlist.map((m) => MODE_INFO[m]?.name || m).join(" → ")
      : "Pick at least one mode.";
  }

  seg("set-rounds",
    meta.rounds.map((r) => ({ value: r, label: String(r) })),
    s.rounds, (v) => socket.emit("settings:update", { rounds: v }));

  seg("set-seconds",
    meta.seconds.map((sec) => ({ value: sec, label: `${sec}s` })),
    s.roundSeconds, (v) => socket.emit("settings:update", { roundSeconds: v }));

  // Target (Hitster / timeline).
  const timelineInvolved = arcade ? playlist.includes("timeline") : s.mode === "timeline";
  const targetWrap = $("set-target-wrap");
  if (timelineInvolved && meta.targets) {
    targetWrap.classList.remove("hidden");
    seg("set-target",
      meta.targets.map((t) => ({ value: t, label: `${t}🃏` })),
      s.target, (v) => socket.emit("settings:update", { target: v }));
  } else {
    targetWrap.classList.add("hidden");
  }

  // Categories (single-mode only, and not for bomb).
  const cats = (!arcade && meta.categoriesByMode && meta.categoriesByMode[s.mode]) || [];
  const wrap = $("set-categories-wrap");
  if (arcade || s.mode === "bomb" || cats.length === 0) {
    wrap.classList.add("hidden");
  } else {
    wrap.classList.remove("hidden");
    const enabled = s.categories === null ? new Set(cats) : new Set(s.categories);
    const box = $("set-categories");
    box.innerHTML = "";
    for (const cat of cats) {
      const chip = document.createElement("button");
      chip.className = "chip" + (enabled.has(cat) ? " on" : "");
      chip.textContent = cat;
      chip.disabled = !state.isHost;
      chip.addEventListener("click", () => {
        if (enabled.has(cat)) enabled.delete(cat); else enabled.add(cat);
        const arr = [...enabled];
        const next = (arr.length === 0 || arr.length === cats.length) ? null : arr;
        socket.emit("settings:update", { categories: next });
      });
      box.appendChild(chip);
    }
  }
}

// ===================== QUESTION (trivia / timeline) =====================
function applyQuestion(payload, { alreadyGuessed, guess } = {}) {
  state.mode = payload.mode || state.mode;
  state.unit = payload.question.unit || "";
  state.deadline = payload.deadline;
  state.submitted = !!alreadyGuessed;

  $("round-label").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
  $("question-category").textContent = payload.question.category || "";
  $("question-text").textContent =
    state.mode === "timeline" ? `Which year? ${payload.question.text}` : payload.question.text;
  $("guess-unit").textContent = state.unit;
  $("guess-input").value = "";
  $("guess-input").placeholder = state.mode === "timeline" ? "e.g. 1969" : "0";
  configureGuessSlider(payload.question);
  $("question-error").textContent = "";

  if (state.mode === "timeline") renderTimelineViz($("timeline-viz"), payload.placedEvents || [], payload.question.text);
  else $("timeline-viz").classList.add("hidden");

  if (alreadyGuessed) {
    $("submitted-value").textContent = `${fmt(guess)} ${esc(state.unit)}`.trim();
    $("guess-area").classList.add("hidden");
    $("submitted-area").classList.remove("hidden");
  } else {
    $("guess-area").classList.remove("hidden");
    $("submitted-area").classList.add("hidden");
    $("submit-btn").disabled = false;
  }

  showScreen("question");
  if (!alreadyGuessed) $("guess-input").focus();
  startTimer(payload.deadline, "timer");
}

function triviaSliderConfig(question) {
  const hint = `${question?.text || ""} ${question?.unit || ""}`.toLowerCase();
  let max = 1_000_000;
  if (/%|percent/.test(hint)) max = 100;
  else if (/\b(age|years old)\b/.test(hint)) max = 150;
  else if (/\b(year|date|founded|released|born|built)\b/.test(hint)) max = 2500;
  else if (/\btemperature|°c|celsius|fahrenheit/.test(hint)) max = 1000;
  else if (/\bseconds?|minutes?|hours?|days?\b/.test(hint)) max = 10_000;
  else if (/\bprice|cost|dollars?|\$|euros?|€/.test(hint)) max = 10_000_000;
  else if (/\bkilometres?|kilometers?|km\b/.test(hint)) max = 100_000;
  return { max, step: 1 };
}

function configureGuessSlider(question) {
  const wrap = $("guess-slider-wrap");
  if (state.mode !== "trivia") {
    wrap.classList.add("hidden");
    return;
  }
  state.guessSliderConfig = triviaSliderConfig(question);
  $("guess-slider").value = "0";
  $("guess-slider-value").textContent = "0";
  $("guess-slider-max").textContent = state.guessSliderConfig.max.toLocaleString();
  wrap.classList.remove("hidden");
}

$("guess-slider").addEventListener("input", () => {
  const config = state.guessSliderConfig;
  if (!config) return;
  const raw = Math.pow(config.max + 1, Number($("guess-slider").value) / 10000) - 1;
  const value = Math.max(0, Math.min(config.max, Math.round(raw / config.step) * config.step));
  $("guess-input").value = value;
  $("guess-slider-value").textContent = value.toLocaleString();
});

$("guess-input").addEventListener("input", () => {
  const config = state.guessSliderConfig;
  if (!config || state.mode !== "trivia") return;
  const value = Math.max(0, Math.min(config.max, Number($("guess-input").value) || 0));
  $("guess-slider").value = Math.round(Math.log(value + 1) / Math.log(config.max + 1) * 10000);
  $("guess-slider-value").textContent = (Number($("guess-input").value) || 0).toLocaleString();
});

function legPrefix() {
  const a = state.room && state.room.arcade;
  return a ? `🎮 Game ${a.legIndex + 1}/${a.totalLegs} · ` : "";
}

function updateQuestionProgressFromRoom(room) {
  const connected = room.players.filter((p) => p.connected);
  const answered = connected.filter((p) => p.hasGuessed).length;
  $("progress-label").textContent = `${answered} of ${connected.length} players have answered`;
}

function renderTimelineViz(el, placed, pendingLabel) {
  el.classList.remove("hidden");
  const events = placed.slice().sort((a, b) => a.year - b.year);
  if (events.length === 0) {
    el.innerHTML = `<p class="muted small center">First event — no reference points yet.</p>`;
    return;
  }
  const years = events.map((e) => e.year);
  const min = Math.min(...years), max = Math.max(...years);
  const span = Math.max(1, max - min);
  el.innerHTML =
    `<div class="tl-line">` +
    events.map((e) => {
      const pct = ((e.year - min) / span) * 100;
      return `<div class="tl-dot" style="left:${pct}%"><span class="tl-year">${e.year}</span>` +
             `<span class="tl-label">${esc(e.label)}</span></div>`;
    }).join("") +
    `</div>`;
}

// ===================== TURN (curling / bomb) =====================
function applyTurn(payload) {
  showScreen("turn");
  $("turn-error").textContent = "";
  startTimer(payload.deadline, "turn-timer");

  $("curling-area").classList.toggle("hidden", payload.mode !== "curling");
  $("bomb-area").classList.toggle("hidden", payload.mode !== "bomb");
  $("timeline-area").classList.toggle("hidden", payload.mode !== "timeline");

  if (payload.mode === "curling") {
    $("turn-round-label").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
    state.unit = payload.question.unit || "";
    $("turn-category").textContent = payload.question.category || "";
    $("turn-question").textContent = payload.question.text;
    $("turn-unit").textContent = state.unit;
    $("turn-guess").value = "500";
    $("curling-power-value").textContent = "500";
    updateCurling(payload);
  } else if (payload.mode === "bomb") {
    $("turn-round-label").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
    updateBomb(payload);
  } else if (payload.teamVote) {
    $("turn-round-label").textContent = legPrefix() + "🕰️ Timeline — team vote";
    renderTimelineTeam(payload);
  } else {
    $("turn-round-label").textContent = legPrefix() + "🕰️ Timeline";
    renderTimelineTurn(payload);
  }
}

// ---- Timeline TEAM VOTING ---------------------------------------------------
$("tl-lock-btn").addEventListener("click", () => {
  const mine = (state.team && state.team.votes || []).find((v) => v.playerId === state.selfId);
  const nowLocked = !(mine && mine.locked);
  socket.emit("timeline:lock", { locked: nowLocked });
  sound.beep(nowLocked ? 620 : 360, 0.08);
});

function renderTimelineTeam(payload) {
  state.team = {
    shared: payload.sharedTimeline || [],
    votes: payload.votes || [],
    target: payload.target
  };
  $("tl-target-chip").textContent = `First to ${payload.target} points`;
  $("tl-card-label").textContent = payload.card ? payload.card.label : "…";
  $("tl-wait").textContent = "Tap where it belongs, discuss, then lock in your vote.";
  $("tl-vote-controls").classList.remove("hidden");
  $("tl-others-title").textContent = "Scores";
  renderVoteTimeline();
  renderVoteStatus();
  renderTeamStandings(payload.standings || []);
}

function updateVotes(votes) {
  if (!state.team) return;
  state.team.votes = votes || [];
  renderVoteTimeline();
  renderVoteStatus();
}

function renderVoteTimeline() {
  const el = $("tl-myrow");
  const shared = state.team.shared.slice().sort((a, b) => a.year - b.year);
  const votes = state.team.votes;
  const myVote = votes.find((v) => v.playerId === state.selfId);
  const votersAt = (slot) => votes.filter((v) => v.slot === slot);

  const voterChips = (slot) => votersAt(slot).map((v) =>
    `<span class="tl-voter ${v.locked ? "locked" : ""}" title="${esc(v.name)}">${avatarHtml(v.avatar)}${v.locked ? "🔒" : ""}</span>`
  ).join("");

  const slotEl = (i) =>
    `<div class="tl-vslot">` +
      `<button class="tl-slot ${myVote && myVote.slot === i ? "mine" : ""}" data-slot="${i}">＋</button>` +
      `<div class="tl-voters">${voterChips(i)}</div>` +
    `</div>`;

  let html = `<div class="tl-row">` + slotEl(0);
  shared.forEach((c, i) => {
    html += `<div class="tl-known"><span class="tl-known-year">${c.year}</span>` +
            `<span class="tl-known-label">${esc(c.label)}</span></div>`;
    html += slotEl(i + 1);
  });
  html += `</div>`;
  el.innerHTML = html;

  el.querySelectorAll(".tl-slot").forEach((b) => {
    b.addEventListener("click", () => {
      sound.beep(500, 0.05);
      socket.emit("timeline:vote", { slot: Number(b.dataset.slot) });
    });
  });
}

function renderVoteStatus() {
  const votes = state.team.votes;
  const locked = votes.filter((v) => v.locked).length;
  const total = (state.room ? state.room.players.filter((p) => p.connected).length : votes.length);
  $("tl-vote-status").textContent = `${locked}/${total} locked in`;
  const mine = votes.find((v) => v.playerId === state.selfId);
  const btn = $("tl-lock-btn");
  btn.disabled = !mine;
  btn.textContent = mine && mine.locked ? "🔓 Unlock my vote" : "🔒 Lock in vote";
}

function renderTeamStandings(standings) {
  const el = $("tl-others");
  el.innerHTML = standings.map((s) =>
    `<div class="tl-player ${s.playerId === state.selfId ? "self" : ""}">` +
    `<div class="tl-player-head">${avatarHtml(s.avatar)}<span class="tl-player-name">${esc(s.name)}</span>` +
    `<span class="tl-player-score">${s.score}</span></div></div>`
  ).join("");
}

// ---- Timeline (Hitster) -----------------------------------------------------
function renderTimelineTurn(payload) {
  state.tlTarget = payload.target;
  $("tl-vote-controls").classList.add("hidden");
  $("tl-others-title").textContent = "Everyone's timelines";
  $("tl-target-chip").textContent = `First to ${payload.target} cards`;
  $("tl-card-label").textContent = payload.card ? payload.card.label : "…";

  const mine = (payload.timelines || []).find((t) => t.playerId === state.selfId);
  const activeName = (payload.timelines || []).find((t) => t.playerId === payload.activePlayerId)?.name;
  const myTurn = payload.activePlayerId === state.selfId;

  if (myTurn && mine) {
    $("tl-wait").textContent = "Your turn — slot the card into your timeline:";
    renderMyTimeline(mine.cards, true);
    sound.beep(760, 0.1);
  } else {
    $("tl-wait").textContent = activeName ? `${activeName} is placing a card…` : "Waiting…";
    renderMyTimeline(mine ? mine.cards : [], false);
  }
  renderOtherTimelines(payload.timelines || [], payload.activePlayerId);
}

function renderMyTimeline(cards, interactive) {
  const el = $("tl-myrow");
  const sorted = cards.slice().sort((a, b) => a.year - b.year);
  let html = `<div class="tl-row">`;
  const slotBtn = (i) => interactive
    ? `<button class="tl-slot" data-slot="${i}">＋</button>`
    : `<span class="tl-slot ghost"></span>`;
  html += slotBtn(0);
  sorted.forEach((c, i) => {
    html += `<div class="tl-known"><span class="tl-known-year">${c.year}</span>` +
            `<span class="tl-known-label">${esc(c.label)}</span></div>`;
    html += slotBtn(i + 1);
  });
  html += `</div>`;
  el.innerHTML = html;
  if (interactive) {
    el.querySelectorAll(".tl-slot").forEach((b) => {
      b.addEventListener("click", () => {
        sound.beep(620, 0.08);
        socket.emit("timeline:place", { slot: Number(b.dataset.slot) });
        el.querySelectorAll(".tl-slot").forEach((x) => (x.disabled = true));
      });
    });
  }
}

function showTimelineToast(p) {
  const el = $("tl-toast");
  const who = p.playerId === state.selfId ? "You" : esc(p.name);
  el.className = "tl-toast " + (p.correct ? "good" : "bad");
  el.innerHTML =
    `<strong>${who} ${p.correct ? "nailed it! ✅" : "missed ❌"}</strong>` +
    `<span>${esc(p.card.label)} — <b>${p.card.year}</b></span>`;
  el.classList.remove("hidden");
  sound.beep(p.correct ? 900 : 200, 0.16, p.correct ? "triangle" : "sawtooth", 0.04);
  clearTimeout(showTimelineToast._t);
  showTimelineToast._t = setTimeout(() => el.classList.add("hidden"), 2400);
}

function showTeamResult(p) {
  if (state.team) { state.team.shared = p.sharedTimeline || state.team.shared; renderVoteTimeline(); }
  renderTeamStandings(p.standings || []);
  const el = $("tl-toast");
  el.className = "tl-toast " + (p.majorityCorrect ? "good" : "bad");
  el.innerHTML =
    `<strong>${p.majorityCorrect ? "Placed! ✅" : "Discarded ❌"}</strong>` +
    `<span>${esc(p.card.label)} — <b>${p.card.year}</b></span>`;
  el.classList.remove("hidden");
  // React based on how the player personally voted.
  const me = (p.perPlayer || []).find((x) => x.playerId === state.selfId);
  if (me && me.correct) sound.happy();
  else if (me && me.locked) sound.sad();
  else sound.neutral();
  clearTimeout(showTeamResult._t);
  showTeamResult._t = setTimeout(() => el.classList.add("hidden"), 2600);
}

function renderOtherTimelines(timelines, activeId) {
  const el = $("tl-others");
  el.innerHTML = timelines.map((t) => {
    const sorted = t.cards.slice().sort((a, b) => a.year - b.year);
    const cards = sorted.map((c) => `<span class="tl-mini">${c.year}</span>`).join("");
    return `<div class="tl-player ${t.playerId === activeId ? "active" : ""} ${t.playerId === state.selfId ? "self" : ""}">` +
      `<div class="tl-player-head">${avatarHtml(t.avatar)}<span class="tl-player-name">${esc(t.name)}</span>` +
      `<span class="tl-player-score">${t.score}</span></div>` +
      `<div class="tl-mini-row">${cards || '<span class="muted small">—</span>'}</div></div>`;
  }).join("");
}

function updateCurling(payload) {
  if(payload.stones)curlingVisual.stones=payload.stones;
  if(payload.trajectory?.length)curlingVisual.anim={frames:payload.trajectory,started:performance.now()};
  if (payload.order) renderTurnOrder($("curling-order"), payload.order);
  const active = payload.order ? payload.order.find((o) => o.active) : null;
  const activeName = active ? active.name : payload.lastName;
  // I should shoot only if I'm the active player and haven't shot yet.
  let myTurn = active && active.playerId === state.selfId && !active.done && !payload.trajectory;
  if(curlingVisual.anim){
    if(!payload.trajectory)curlingVisual.pendingPayload=payload;
    myTurn=false;
    $("curling-input").classList.add("hidden");
    $("curling-wait").textContent="Watch the shot settle on the ice…";
  }

  if (myTurn) {
    $("curling-input").classList.remove("hidden");
    $("turn-submit").disabled = false;
    $("curling-wait").textContent = "";
    if(curlingControl.stage==="idle"||curlingControl.stage==="done"){
      curlingControl={stage:"direction",direction:0,power:0,started:performance.now()};
      $("turn-submit").textContent="LOCK DIRECTION";
      $("curling-meter-status").textContent="Press SPACE or the button to stop the sweeping aim arrow";
    }
    sound.beep(760, 0.1);
  } else {
    $("curling-input").classList.add("hidden");
    $("curling-wait").textContent = activeName ? `${activeName} is taking their shot…` : "Waiting…";
  }
  if(!myTurn&&["direction","power"].includes(curlingControl.stage))curlingControl.stage="idle";
  if(payload.shots)renderShots(payload.shots);
  cancelAnimationFrame(curlingVisual.raf);drawCurlingRink();
}

let curlingControl={stage:"idle",direction:0,power:0,started:0};
let curlingVisual={shots:[],stones:[],anim:null,raf:0,pendingPayload:null,pendingResults:null};
function curlingDirection(now){return Math.sin((now-curlingControl.started)/430);}
function curlingPower(now){return .08+.92*(.5+.5*Math.sin((now-curlingControl.started)/360));}
function curlingPress(){
  if(!["direction","power"].includes(curlingControl.stage)||
      $("curling-input").classList.contains("hidden")||$("turn-submit").disabled)return;
  const canShowAim=!$("curling-input").classList.contains("hidden")&&!$("turn-submit").disabled;
  if(canShowAim&&curlingControl.stage==="direction"){
    curlingControl.direction=curlingDirection(performance.now());curlingControl.stage="power";curlingControl.started=performance.now();
    const degrees=Math.round(curlingControl.direction*18);
    $("turn-submit").textContent="RELEASE STONE";$("curling-meter-status").textContent=`Direction locked: ${degrees===0?"STRAIGHT":`${Math.abs(degrees)}° ${degrees<0?"LEFT":"RIGHT"}`} — now stop the power`;
    sound.beep(500,.07,"square",.025);return;
  }
  if(curlingControl.stage==="power"){
    curlingControl.power=curlingPower(performance.now());curlingControl.stage="done";
    $("turn-submit").disabled=true;$("curling-meter-status").textContent="Stone away!";
    socket.emit("guess:submit",{guess:{direction:curlingControl.direction,power:curlingControl.power}});
    sound.beep(720,.1,"triangle",.03);
  }
}
function drawCurlingAim(ctx,direction,power=null,now=performance.now()){
  const angle=direction*18*Math.PI/180,startX=250,startY=612;
  const strength=power==null ? .48 : power,length=92+strength*78;
  // Use the rink's x/y projection when drawing the guide. Without this, the
  // non-square lane makes the stone appear to leave at a different angle.
  const rawX=Math.sin(angle)*1.3,rawY=-Math.cos(angle)*.78,norm=Math.hypot(rawX,rawY);
  const dx=rawX/norm,dy=rawY/norm,tipX=startX+dx*length,tipY=startY+dy*length;
  ctx.save();ctx.setLineDash([3,8]);ctx.lineCap="round";ctx.strokeStyle="rgba(220,38,38,.9)";ctx.lineWidth=4;
  ctx.beginPath();ctx.moveTo(startX,startY);ctx.lineTo(tipX,tipY);ctx.stroke();ctx.setLineDash([]);
  const sideX=-dy,sideY=dx,head=20;
  ctx.fillStyle="#dc2626";ctx.strokeStyle="rgba(127,29,29,.9)";ctx.lineWidth=3;ctx.beginPath();
  ctx.moveTo(tipX+dx*8,tipY+dy*8);
  ctx.lineTo(tipX-dx*head+sideX*11,tipY-dy*head+sideY*11);
  ctx.lineTo(tipX-dx*head-sideX*11,tipY-dy*head-sideY*11);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.fillStyle="rgba(8,47,73,.76)";ctx.beginPath();ctx.roundRect(168,556,164,28,14);ctx.fill();
  const degrees=Math.round(direction*18),directionText=degrees===0?"STRAIGHT":`${Math.abs(degrees)}° ${degrees<0?"LEFT":"RIGHT"}`;
  ctx.fillStyle="#fff";ctx.font="900 13px sans-serif";ctx.textAlign="center";ctx.fillText(directionText,250,575);
  ctx.fillStyle="#f97316";ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(startX,startY,14,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle="#e2e8f0";ctx.fillRect(startX-5,startY-20,10,8);
  ctx.restore();
}
function drawCurlingRink(now=performance.now()){
  const canvas=$("curling-canvas"),ctx=canvas.getContext("2d");
  // Aim controls only belong to the local player while their shot is active.
  // Keep this in renderer scope: both aim branches and the RAF condition use it.
  const canShowAim=!$("curling-input").classList.contains("hidden")&&!$("turn-submit").disabled;
  ctx.clearRect(0,0,500,680);
  ctx.fillStyle="#082f49";ctx.fillRect(0,0,500,680);
  const ice=ctx.createLinearGradient(0,20,0,660);ice.addColorStop(0,"#effcff");ice.addColorStop(1,"#b9e8f5");
  ctx.fillStyle=ice;ctx.fillRect(55,20,390,640);
  ctx.strokeStyle="#7dd3fc";ctx.lineWidth=4;ctx.strokeRect(55,20,390,640);
  ctx.strokeStyle="rgba(14,116,144,.14)";ctx.lineWidth=1;
  for(let y=30;y<660;y+=35){ctx.beginPath();ctx.moveTo(55,y);ctx.lineTo(445,y-22);ctx.stroke();}
  const zones=[
    {top:20,bottom:47,color:"rgba(250,204,21,.62)",label:"5 — BACK EDGE"},
    {top:47,bottom:114,color:"rgba(239,68,68,.30)",label:"3 POINTS"},
    {top:114,bottom:156,color:"rgba(59,130,246,.28)",label:"2 POINTS"},
    {top:156,bottom:202,color:"rgba(34,197,94,.25)",label:"1 POINT"}
  ];
  for(const zone of zones){
    ctx.fillStyle=zone.color;ctx.fillRect(57,zone.top,386,zone.bottom-zone.top);
    ctx.strokeStyle="rgba(15,23,42,.42)";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(57,zone.bottom);ctx.lineTo(443,zone.bottom);ctx.stroke();
    ctx.fillStyle="rgba(15,23,42,.82)";ctx.font=zone.top===20?"900 12px sans-serif":"900 11px sans-serif";ctx.textAlign="left";
    ctx.fillText(zone.label,68,zone.top+(zone.bottom-zone.top)/2+4);
  }
  // This mode scores by horizontal bands, so a traditional curling house and
  // hog line would suggest the wrong objective. Keep the board visually simple.
  ctx.fillStyle="rgba(8,47,73,.62)";ctx.beginPath();ctx.roundRect(176,603,148,25,13);ctx.fill();
  ctx.fillStyle="#e0f2fe";ctx.font="900 11px sans-serif";ctx.textAlign="center";ctx.fillText("LAUNCH AREA",250,620);
  ctx.strokeStyle="rgba(14,116,144,.3)";ctx.lineWidth=2;ctx.setLineDash([7,8]);
  ctx.beginPath();ctx.moveTo(72,202);ctx.lineTo(428,202);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle="rgba(14,116,144,.62)";ctx.font="800 10px sans-serif";ctx.textAlign="right";ctx.fillText("NO SCORE BELOW THIS LINE",425,216);
  let stones=curlingVisual.stones||[],animating=false;
  if(curlingVisual.anim){
    const frameMs=25,settleHold=1200,age=now-curlingVisual.anim.started;
    const index=Math.min(curlingVisual.anim.frames.length-1,Math.floor(age/frameMs));
    stones=curlingVisual.anim.frames[index]||stones;animating=index<curlingVisual.anim.frames.length-1;
    if(!animating&&age<curlingVisual.anim.frames.length*frameMs+settleHold)animating=true;
    if(!animating){
      curlingVisual.anim=null;
      const results=curlingVisual.pendingResults;curlingVisual.pendingResults=null;
      const pending=curlingVisual.pendingPayload;curlingVisual.pendingPayload=null;
      if(results)queueMicrotask(()=>{renderResults(results);showScreen("results");sound.beep(880,.14,"triangle");});
      else if(pending)queueMicrotask(()=>updateCurling(pending));
    }
  }
  stones.forEach((stone,index)=>{
    if(stone.off)return;
    const x=250+stone.x*1.3,y=30+stone.y*.78,shot=curlingVisual.shots.find(s=>s.stoneId===stone.stoneId);
    const color=shot?.avatar?.color||["#f97316","#22c55e","#a855f7","#0ea5e9"][index%4];
    ctx.fillStyle="rgba(0,0,0,.22)";ctx.beginPath();ctx.ellipse(x+3,y+6,17,7,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=color;ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle="#e2e8f0";ctx.fillRect(x-5,y-20,10,8);
    ctx.fillStyle="#fff";ctx.font="900 9px sans-serif";ctx.textAlign="center";ctx.fillText(shot?.throwNumber||"",x,y+3);
  });
  if(canShowAim&&curlingControl.stage==="direction"){
    const dir=curlingDirection(now);drawCurlingAim(ctx,dir,null,now);
  }else if(canShowAim&&curlingControl.stage==="power"){
    const power=curlingPower(now);drawCurlingAim(ctx,curlingControl.direction,power,now);
    ctx.fillStyle="rgba(8,15,30,.92)";ctx.strokeStyle="rgba(255,255,255,.65)";ctx.lineWidth=2;
    ctx.beginPath();ctx.roundRect(55,630,390,40,12);ctx.fill();ctx.stroke();
    const grad=ctx.createLinearGradient(68,0,432,0);grad.addColorStop(0,"#38bdf8");grad.addColorStop(.62,"#22c55e");grad.addColorStop(.84,"#facc15");grad.addColorStop(1,"#fb7185");
    ctx.fillStyle=grad;ctx.beginPath();ctx.roundRect(68,641,364*power,18,8);ctx.fill();
    ctx.strokeStyle="#fff";ctx.lineWidth=3;const marker=68+364*power;ctx.beginPath();ctx.moveTo(marker,636);ctx.lineTo(marker,664);ctx.stroke();
    ctx.fillStyle="#fff";ctx.font="900 12px sans-serif";ctx.textAlign="right";ctx.fillText(`${Math.round(power*100)}% POWER`,432,625);
  }
  if(animating||(canShowAim&&(curlingControl.stage==="direction"||curlingControl.stage==="power")))
    curlingVisual.raf=requestAnimationFrame(drawCurlingRink);
}

function renderShots(shots) {
  curlingVisual.shots=shots;
  const list = $("shot-list");
  list.innerHTML = "";
  shots.forEach((s) => {
    const li = document.createElement("li");
    if (s.playerId === state.selfId) li.classList.add("self");
    li.innerHTML =
      `<span class="r-name">${esc(s.name)}</span>` +
      `<span class="r-guess">${s.stone?.off?"OFF THE EDGE":`${Math.round((s.guess?.power||0)*100)}% power`}</span>`;
    list.appendChild(li);
  });
}

function renderTurnOrder(el, order) {
  el.innerHTML = order.map((o) => {
    const cls = ["turn-chip"];
    if (o.active) cls.push("active");
    if (o.done) cls.push("done");
    if (o.connected === false) cls.push("gone");
    const stones=Number.isFinite(o.stonesThrown)?` · ${o.stonesThrown}/${o.stonesTotal}`:"";
    return `<span class="${cls.join(" ")}">${esc(o.name)}${stones}</span>`;
  }).join("");
}

function updateBomb(payload) {
  const total = typeof payload.total === "number" ? payload.total : balloon.total;
  balloon.total = total;
  balloon.popped = false;
  const fresh = (total === 0); // a fresh, empty balloon this round
  if (fresh) {
    balloon.shown = 0; balloon.shownTarget = 0; balloon.pumps = 0; balloon.active = null;
    balloon.pumpBacklog.length = 0; balloon.pendingPop = null; balloon.burst = null;
    balloon.line = []; // rebuilt below by bombSyncLine
    clearBalloonCanvas(); // wipe last round's final frame so it never flashes
  }

  if (payload.order) {
    // turn:started — refresh the line-up and note whose turn it is next.
    $("bomb-order").classList.add("hidden"); // the canvas queue shows the order now

    balloon.roster = payload.order.map((o) => {
      const pl = state.room && state.room.players.find((p) => p.id === o.playerId);
      return {
        id: o.playerId, name: o.name,
        emoji: (pl && pl.avatar && pl.avatar.emoji) || "🐧",
        color: (pl && pl.avatar && pl.avatar.color) || "#8a90c8",
        phase: (balloon.bobPhase[o.playerId] ??= Math.random() * 6) // stable, desynced bob
      };
    });
    const active = payload.order.find((o) => o.active);
    balloon.turnActiveId = active ? active.playerId : null;
    balloon.prevTotal = total; // baseline before this player pumps
    const activePlayer = active && state.room ? state.room.players.find((p) => p.id === active.playerId) : null;
    if (activePlayer && activePlayer.avatar) balloon.color = activePlayer.avatar.color;
    bombSyncLine(fresh);
  } else {
    // turn:update — a pump happened. Derive WHO pumped (whoever's turn it was)
    // and HOW MANY from the change in total, so it works even when the payload
    // omits lastPlayerId / lastPress.
    const pumperId = payload.lastPlayerId || balloon.turnActiveId;
    let jumps = Number(payload.lastPress) || Math.max(1, total - (balloon.prevTotal ?? total));
    jumps = Math.max(1, Math.min(3, jumps));
    balloon.prevTotal = total;
    if (pumperId) {
      const rm = balloon.roster.find((r) => r.id === pumperId);
      if (rm) balloon.color = rm.color;
      bombPump(pumperId, jumps);
    }
  }

  const activeName = payload.order ? payload.order.find((o) => o.active)?.name : payload.lastName;
  const myTurn = payload.activePlayerId === state.selfId || isSelfActive(payload.order);

  if (myTurn) {
    $("bomb-input").classList.remove("hidden");
    document.querySelectorAll(".press-btn").forEach((b) => (b.disabled = false));
    $("bomb-wait").textContent = "Your turn — pump carefully!";
    sound.beep(520, 0.08);
  } else {
    $("bomb-input").classList.add("hidden");
    $("bomb-wait").textContent = activeName ? `${activeName} is at the pump…` : "Waiting…";
  }
  startBalloonLoop();
}

// ---- 2.5D balloon renderer --------------------------------------------------
const balloon = { total: 0, shown: 0, shownTarget: 0, pumps: 0, wobble: 0, pumpPulse: 0, handle: 0, popped: false, color: "#ff5b6e", raf: null, lastTs: 0, roster: [], line: [], active: null, pumpBacklog: [], bobPhase: {}, prevTotal: 0, turnActiveId: null, _dt: 0, pendingPop: null, burst: null, popResolve: null, burstResolveAt: 0, popFallback: null };
const ACT = { jump: 0.5 }; // jump duration (seconds) per pump — the balloon grows one pump per landed jump

function balloonActiveNow() {
  return currentScreen === "turn" && state.mode === "bomb" &&
    !$("bomb-area").classList.contains("hidden");
}
function clearBalloonCanvas() {
  const cv = $("balloon-canvas"); if (!cv || !cv.getContext) return;
  cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
}
function startBalloonLoop() {
  if (balloon.raf) return;
  balloon.lastTs = performance.now();
  const step = (ts) => {
    if (!balloonActiveNow()) { balloon.raf = null; return; }
    const dt = Math.min(0.05, (ts - balloon.lastTs) / 1000); balloon.lastTs = ts;
    // The balloon only grows as characters actually land their pumps — so the
    // felt pacing follows the animation, not how fast the server resolves.
    balloon.shown += ((balloon.shownTarget || 0) - balloon.shown) * Math.min(1, dt * 5);
    balloon.wobble += dt * (2.4 + balloon.shown * 0.14);
    balloon.pumpPulse = Math.max(0, balloon.pumpPulse - dt * 3.4);
    balloon.handle = Math.max(0, balloon.handle - dt * 4);
    balloon._dt = dt;
    $("bomb-total").textContent = balloon.pumps || 0;
    if (balloon.burst && performance.now() >= balloon.burstResolveAt) {
      balloon.burst = null; balloon.pendingPop = null;
      if (balloon.popFallback) { clearTimeout(balloon.popFallback); balloon.popFallback = null; }
      const r = balloon.popResolve; balloon.popResolve = null; balloon.raf = null;
      if (r) r();
      return;
    }
    if (balloon.burst) balloon.burst.t += dt;
    drawBalloon(balloon.burst ? Math.min(1, balloon.burst.t / 0.16) : undefined);
    balloon.raf = requestAnimationFrame(step);
  };
  balloon.raf = requestAnimationFrame(step);
}

function hexToRgb(h) { const n = parseInt(h.replace("#", ""), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgb(a) { return `rgb(${a[0]|0},${a[1]|0},${a[2]|0})`; }
function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
function lighten(hex, t) { return rgb(mix(hexToRgb(hex), [255, 255, 255], t)); }
function darken(hex, t) { return rgb(mix(hexToRgb(hex), [0, 0, 0], t)); }
function strainColor(hex, t) { return rgb(mix(hexToRgb(hex), [255, 60, 60], t * 0.5)); }

function drawBalloon(popT) {
  const cv = $("balloon-canvas"); if (!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d"); const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const cx = Math.round(W * 0.74), groundY = H - 30; // balloon sits on the right
  const inf = balloon.shown;
  let r = 30 + 74 * (1 - Math.exp(-inf * 0.16)) + balloon.pumpPulse * 8;
  const strain = Math.min(1, inf / 15);
  if (popT != null) r *= 1 + popT * 0.35; // brief expand right before the burst
  const sway = Math.sin(balloon.wobble) * (2 + inf * 0.28);
  const squash = 1 + Math.sin(balloon.wobble * 2) * 0.02 - balloon.pumpPulse * 0.05;
  const rx = r * 0.92 / squash, ry = r * 1.06 * squash;
  const by = groundY - ry - 40, bx = cx + sway;
  const col = strainColor(balloon.color, strain);

  // ground shadow (grows with size)
  ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = "#000";
  ctx.beginPath(); ctx.ellipse(cx, groundY + 8, rx * 0.95, 11, 0, 0, 7); ctx.fill(); ctx.restore();

  // string
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(bx, by + ry);
  for (let t = 0; t <= 1; t += 0.1) {
    const yy = (by + ry) + t * (groundY - 8 - (by + ry));
    const xx = bx + Math.sin(balloon.wobble + t * 6) * 7 * (1 - t);
    ctx.lineTo(xx, yy);
  }
  ctx.stroke();

  // pump (fixed position) with a flexible hose that reaches up to the knot
  const pumpX = Math.round(W * 0.48); // pump just left of the balloon
  drawPump(ctx, pumpX, groundY, balloon.handle);
  drawHose(ctx, pumpX + 14, groundY - 22, bx, by + ry + 4);
  updateBombChars(balloon._dt || 0, W, groundY, pumpX);

  if (popT != null && popT >= 1) { drawBombChars(ctx, W, groundY, pumpX); drawBurst(ctx, bx, by, rx, col); return; }

  // balloon body — volumetric radial gradient for the 2.5D look
  const g = ctx.createRadialGradient(bx - rx * 0.36, by - ry * 0.42, r * 0.12, bx, by, r * 1.2);
  g.addColorStop(0, lighten(balloon.color, 0.55));
  g.addColorStop(0.5, col);
  g.addColorStop(1, darken(balloon.color, 0.34));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(bx, by, rx, ry, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 2; ctx.stroke();

  // glossy highlight
  ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.ellipse(bx - rx * 0.34, by - ry * 0.42, rx * 0.2, ry * 0.28, -0.4, 0, 7); ctx.fill();
  ctx.restore();

  // knot
  ctx.fillStyle = darken(balloon.color, 0.22);
  ctx.beginPath(); ctx.moveTo(bx - 6, by + ry - 1); ctx.lineTo(bx + 6, by + ry - 1); ctx.lineTo(bx, by + ry + 10); ctx.closePath(); ctx.fill();

  // strain sparkle when nearly bursting
  if (strain > 0.55) {
    ctx.save(); ctx.globalAlpha = 0.25 + 0.25 * Math.abs(Math.sin(balloon.wobble * 4));
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.ellipse(bx + rx * 0.3, by - ry * 0.1, rx * 0.12, ry * 0.05, 0.6, 0, 7); ctx.fill();
    ctx.restore();
  }

  // the queue + pumping character, drawn on top
  drawBombChars(ctx, W, groundY, pumpX);
}

/** Curved, stretchy hose from the pump nozzle up to the balloon's knot. */
function drawHose(ctx, x0, y0, x1, y1) {
  const midx = (x0 + x1) / 2, midy = Math.max(y0, y1) + 22;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#3a3f6b"; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(midx, midy, x1, y1); ctx.stroke();
  ctx.strokeStyle = "#565c94"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(midx, midy, x1, y1); ctx.stroke();
}

/** Draw one character (shared PaperCharacter art) with its feet at footY. */
function drawCharAt(ctx, x, footY, member, st, dir, extraRot) {
  const avatar = { emoji: member.emoji, color: member.color };
  if (window.PaperCharacter) {
    if (extraRot) { ctx.save(); ctx.translate(x, footY - 17); ctx.rotate(extraRot); ctx.translate(-x, -(footY - 17)); }
    window.PaperCharacter.draw(ctx, { x, y: footY - 17, size: 34, direction: dir, state: st, avatar, time: performance.now() + (member.phase || 0) * 1000 });
    if (extraRot) ctx.restore();
  } else {
    ctx.fillStyle = member.color; ctx.beginPath(); ctx.arc(x, footY - 17, 14, 0, 7); ctx.fill();
    ctx.font = "18px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(member.emoji, x, footY - 16);
  }
}

// ---- rotating pump queue ----------------------------------------------------
function bombSlotX(i, W) { return Math.round(W * 0.48) - 52 - i * 32; } // slot 0 = front (nearest pump)

/** Build or reconcile the visible line from the roster (turn order). */
function bombSyncLine(reset) {
  if (reset || !balloon.line.length) {
    // Start off-screen to the left and let them walk into line (smooth entrance).
    balloon.line = balloon.roster.map((m, i) => ({ ...m, ax: -50 - i * 30, ay: null, dir: 1, moving: true }));
    return;
  }
  const rosterIds = new Set(balloon.roster.map((m) => m.id));
  balloon.line = balloon.line.filter((m) => rosterIds.has(m.id));
  const present = new Set(balloon.line.map((m) => m.id));
  if (balloon.active) present.add(balloon.active.id);
  for (const m of balloon.roster) {
    if (!present.has(m.id)) balloon.line.push({ ...m, ax: null, ay: null, dir: 1, moving: false });
  }
}

/** Send a player out of the line to pump; if busy, queue it. */
function bombPump(pumperId, jumps, isPop) {
  if (balloon.active) { balloon.pumpBacklog.push({ pumperId, jumps, isPop }); return; }
  let idx = balloon.line.findIndex((m) => m.id === pumperId);
  if (idx < 0) idx = 0;
  const m = balloon.line.splice(idx, 1)[0];
  if (!m) return;
  balloon.active = Object.assign(m, { anim: "toPump", t: 0, jumps, done: 0, impacted: false, isPop: !!isPop, mine: pumperId === state.selfId });
}

/** Advance the eased positions of everyone in the line + the active pumper. */
function updateBombChars(dt, W, groundY, pumpX) {
  const slotX = (i) => bombSlotX(i, W);
  balloon.line.forEach((m, i) => {
    const tx = slotX(i);
    if (m.ax == null) { m.ax = tx; m.ay = groundY; m.dir = 1; m.moving = false; return; }
    const prev = m.ax;
    m.ax += (tx - m.ax) * Math.min(1, dt * 7);
    m.ay = groundY;
    m.moving = Math.abs(tx - m.ax) > 1.2;
    if (m.ax < prev - 0.06) m.dir = -1; else if (m.ax > prev + 0.06) m.dir = 1;
  });

  const a = balloon.active;
  if (!a) return;
  if (a.ax == null) { a.ax = slotX(0); a.ay = groundY; a.dir = 1; }
  a.t += dt;
  if (a.anim === "fly") {                      // popped the balloon — launch off screen
    a.vx = (a.vx || 0); a.vy = (a.vy || 0) + dt * 900;
    a.ax += a.vx * dt; a.ay += a.vy * dt; a.spin = (a.spin || 0) + dt * 12;
    if (a.ay > groundY + 400 || a.ax < -60 || a.ax > W + 60) balloon.active = null;
    return;
  }
  if (a.anim === "toPump") {
    a.ax += (pumpX - a.ax) * Math.min(1, dt * 6); a.ay = groundY; a.dir = 1; a.moving = true;
    if (Math.abs(a.ax - pumpX) < 3) { a.anim = "jump"; a.t = 0; a.done = 0; a.impacted = false; }
  } else if (a.anim === "jump") {
    a.moving = false; a.dir = 1; a.ax = pumpX;
    const jt = Math.min(1, a.t / ACT.jump);
    const pistonTop = groundY - 78 + balloon.handle * 20;
    a.ay = pistonTop - Math.abs(Math.sin(jt * Math.PI)) * 30;
    if (jt >= 0.8 && !a.impacted) {
      a.impacted = true; balloon.handle = 1; balloon.pumpPulse = 1;
      balloon.pumps = (balloon.pumps || 0) + 1;        // one real pump
      balloon.shownTarget = balloon.pumps;             // visual grows with it
      sound.beep(200 + a.done * 40, 0.07, "square", 0.05);
      if (a.mine && navigator.vibrate) navigator.vibrate(16);
      a.done++;
    }
    if (a.t >= ACT.jump) {
      if (a.done >= a.jumps) {
        if (a.isPop) startBurst(a);          // fatal pump — burst now
        else { a.anim = "toBack"; a.t = 0; }
      } else { a.t = 0; a.impacted = false; }
    }
  } else if (a.anim === "toBack") {
    const backX = slotX(balloon.line.length);
    a.ay = groundY; a.dir = -1; a.moving = true;
    a.ax += (backX - a.ax) * Math.min(1, dt * 6);
    if (Math.abs(a.ax - backX) < 3) {
      a.ax = null; delete a.anim; balloon.line.push(a); balloon.active = null;
      if (balloon.pumpBacklog.length) { const n = balloon.pumpBacklog.shift(); bombPump(n.pumperId, n.jumps, n.isPop); }
    }
  }
}

/** The popper's final pump landed — burst the balloon and fling them off. */
function startBurst(a) {
  // Fling away from the balloon (which sits on the right) — up and to the left.
  a.anim = "fly"; a.vx = -(90 + Math.random() * 70); a.vy = -470 - Math.random() * 140; a.spin = -(6 + Math.random() * 8);
  balloon.shownTarget = (balloon.pumps || 0) + 4; // brief visual over-inflate only
  balloon.burst = { t: 0 };
  balloon.burstResolveAt = performance.now() + 850;
  sound.beep(150, 0.2, "sawtooth", 0.05);
  setTimeout(() => sound.beep(90, 0.14, "square", 0.06), 130);
  if (navigator.vibrate) navigator.vibrate([40, 30, 80]);
}

function drawBombChars(ctx, W, groundY, pumpX) {
  const slotX = (i) => bombSlotX(i, W);
  const n = Math.max(balloon.line.length, 1);
  const leftX = slotX(n - 1), rightX = slotX(0);
  ctx.save(); ctx.fillStyle = "rgba(74,222,128,0.16)";
  roundRect(ctx, leftX - 22, groundY - 2, (rightX - leftX) + 44, 14, 7); ctx.fill(); ctx.restore();
  ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "10px system-ui"; ctx.textAlign = "center";
  ctx.fillText("safe zone", (leftX + rightX) / 2, groundY + 24);

  balloon.line.forEach((m) => {
    if (m.ax == null) return;
    drawCharAt(ctx, m.ax, m.ay ?? groundY, m, m.moving ? "walk" : "idle", m.dir || 1);
  });
  const a = balloon.active;
  if (a && a.ax != null) {
    const st = a.anim === "jump" ? "jump" : (a.anim === "fly" ? "stunned" : "walk");
    drawCharAt(ctx, a.ax, a.ay ?? groundY, a, st, a.dir || 1, a.anim === "fly" ? a.spin : 0);
  }
}

function drawPump(ctx, x, groundY, handle) {
  // cylinder
  ctx.fillStyle = "#3a3f6b"; roundRect(ctx, x - 18, groundY - 58, 34, 58, 7); ctx.fill();
  ctx.fillStyle = "#2a2e52"; roundRect(ctx, x - 18, groundY - 12, 34, 12, 4); ctx.fill();
  // piston pushed down by `handle`
  const py = groundY - 78 + handle * 20;
  ctx.fillStyle = "#8a90c8"; roundRect(ctx, x - 4, py, 8, 30, 3); ctx.fill();
  ctx.fillStyle = "#c8cdf2"; roundRect(ctx, x - 20, py - 10, 40, 12, 5); ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBurst(ctx, x, y, r, col) {
  ctx.save();
  ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = "round";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5);
    ctx.lineTo(x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 1.5);
    ctx.stroke();
  }
  ctx.fillStyle = "#fff"; ctx.font = "bold 34px system-ui"; ctx.textAlign = "center";
  ctx.fillText("POP!", x, y + 10);
  ctx.restore();
}

// ===================== MAP (place it) =====================
const WORLD = (typeof window !== "undefined" && window.WORLD_MAP) || { W: 1000, H: 500, land: "" };
const mapView = { x: 0, y: 0, w: 1000, h: 500, drag: null, suppressClick: false };
function initMap() {
  if ($("map-land")) $("map-land").setAttribute("d", WORLD.land);
  if ($("results-map-land")) $("results-map-land").setAttribute("d", WORLD.land);
}
function applyMapView() {
  $("map-svg").setAttribute("viewBox", `${mapView.x} ${mapView.y} ${mapView.w} ${mapView.h}`);
}
function resetMapView() {
  Object.assign(mapView, { x: 0, y: 0, w: WORLD.W, h: WORLD.H, drag: null, suppressClick: false });
  applyMapView();
}
function zoomMap(factor, clientX, clientY) {
  const svg = $("map-svg");
  const rect = svg.getBoundingClientRect();
  const cx = clientX == null ? mapView.x + mapView.w / 2 :
    mapView.x + ((clientX - rect.left) / rect.width) * mapView.w;
  const cy = clientY == null ? mapView.y + mapView.h / 2 :
    mapView.y + ((clientY - rect.top) / rect.height) * mapView.h;
  const newW = Math.max(180, Math.min(WORLD.W, mapView.w * factor));
  const newH = newW * WORLD.H / WORLD.W;
  const rx = (cx - mapView.x) / mapView.w;
  const ry = (cy - mapView.y) / mapView.h;
  mapView.x = Math.max(0, Math.min(WORLD.W - newW, cx - rx * newW));
  mapView.y = Math.max(0, Math.min(WORLD.H - newH, cy - ry * newH));
  mapView.w = newW; mapView.h = newH;
  applyMapView();
}
function renderMapPrompt(question) {
  const prompt = $("map-prompt");
  const flagMatch = question.id && question.id.match(/^flag-([a-z]{2})$/i);
  if (!flagMatch) {
    prompt.textContent = question.text;
    return;
  }
  const code = flagMatch[1].toLowerCase();
  prompt.textContent = "Where is the capital of the country represented by this flag? ";
  const img = document.createElement("img");
  img.className = "map-flag";
  img.src = `https://flagcdn.com/w160/${code}.png`;
  img.alt = `${code.toUpperCase()} flag`;
  img.addEventListener("error", () => {
    const fallback = document.createElement("strong");
    fallback.textContent = `[${code.toUpperCase()} flag]`;
    img.replaceWith(fallback);
  });
  prompt.appendChild(img);
}
function lonLatToXY(lat, lng) {
  return [((lng + 180) / 360) * WORLD.W, ((90 - lat) / 180) * WORLD.H];
}
function svgToLonLat(svg, clientX, clientY) {
  const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
  const m = svg.getScreenCTM(); if (!m) return null;
  const p = pt.matrixTransform(m.inverse());
  return {
    lat: Math.max(-90, Math.min(90, 90 - (p.y / WORLD.H) * 180)),
    lng: Math.max(-180, Math.min(180, (p.x / WORLD.W) * 360 - 180))
  };
}
const SVGNS = "http://www.w3.org/2000/svg";
function drawPin(g, lat, lng, color, big) {
  const [x, y] = lonLatToXY(lat, lng);
  const c = document.createElementNS(SVGNS, "circle");
  c.setAttribute("cx", x); c.setAttribute("cy", y); c.setAttribute("r", big ? 9 : 7);
  c.setAttribute("fill", color || "#ffcb3d");
  c.setAttribute("stroke", "#0f1226"); c.setAttribute("stroke-width", "2");
  g.appendChild(c);
  return [x, y];
}
function drawStar(g, lat, lng) {
  const [x, y] = lonLatToXY(lat, lng);
  const t = document.createElementNS(SVGNS, "text");
  t.setAttribute("x", x); t.setAttribute("y", y + 7); t.setAttribute("text-anchor", "middle");
  t.setAttribute("font-size", "24"); t.textContent = "⭐";
  g.appendChild(t);
}

function applyMapQuestion(payload, { alreadyGuessed, guess } = {}) {
  state.mode = "map";
  state.deadline = payload.deadline;
  state.submitted = !!alreadyGuessed;
  state.mapGuess = alreadyGuessed ? guess : null;
  $("map-round-label").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
  renderMapPrompt(payload.question);
  resetMapView();
  $("map-error").textContent = "";
  $("map-pins").innerHTML = "";
  if (alreadyGuessed && guess) {
    drawPin($("map-pins"), guess.lat, guess.lng, myAvatar.color, true);
    $("map-hint").textContent = "Location submitted. Waiting for others…";
    $("map-submit").disabled = true;
    $("map-submit").textContent = "Submitted ✓";
  } else {
    $("map-hint").textContent = "Tap the map to drop your pin.";
    $("map-submit").disabled = true;
    $("map-submit").textContent = "Submit location";
  }
  showScreen("map");
  startTimer(payload.deadline, "map-timer");
}

$("map-svg").addEventListener("click", (e) => {
  if (mapView.suppressClick) {
    mapView.suppressClick = false;
    return;
  }
  if (state.submitted || currentScreen !== "map") return;
  const ll = svgToLonLat($("map-svg"), e.clientX, e.clientY);
  if (!ll) return;
  state.mapGuess = ll;
  $("map-pins").innerHTML = "";
  drawPin($("map-pins"), ll.lat, ll.lng, myAvatar.color, true);
  $("map-submit").disabled = false;
  $("map-hint").textContent = "Tap again to adjust, then submit.";
  sound.beep(500, 0.05);
});
$("map-zoom-in").addEventListener("click", () => zoomMap(0.72));
$("map-zoom-out").addEventListener("click", () => zoomMap(1.38));
$("map-reset").addEventListener("click", resetMapView);
$("map-svg").addEventListener("wheel", (e) => {
  e.preventDefault();
  zoomMap(e.deltaY < 0 ? 0.82 : 1.22, e.clientX, e.clientY);
}, { passive: false });
$("map-svg").addEventListener("pointerdown", (e) => {
  mapView.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY };
  $("map-svg").setPointerCapture(e.pointerId);
});
$("map-svg").addEventListener("pointermove", (e) => {
  const drag = mapView.drag;
  if (!drag || drag.id !== e.pointerId || mapView.w >= WORLD.W) return;
  const rect = $("map-svg").getBoundingClientRect();
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) mapView.suppressClick = true;
  mapView.x = Math.max(0, Math.min(WORLD.W - mapView.w, mapView.x - dx * mapView.w / rect.width));
  mapView.y = Math.max(0, Math.min(WORLD.H - mapView.h, mapView.y - dy * mapView.h / rect.height));
  drag.x = e.clientX; drag.y = e.clientY;
  applyMapView();
});
function endMapDrag(e) {
  if (mapView.drag?.id === e.pointerId) mapView.drag = null;
}
$("map-svg").addEventListener("pointerup", endMapDrag);
$("map-svg").addEventListener("pointercancel", endMapDrag);
$("map-submit").addEventListener("click", () => {
  if (!state.mapGuess) return flashError($("map-error"), "Tap the map first.");
  sound.beep(620, 0.08);
  socket.emit("guess:submit", { guess: state.mapGuess });
  $("map-submit").disabled = true;
});

function renderMapResults(payload) {
  $("results-caption").textContent = "Correct location";
  $("correct-answer").textContent = "🗺️ " + (payload.prompt || "");
  $("correct-answer").classList.remove("boom");
  $("results-head").classList.remove("hidden");
  $("results-timeline").classList.add("hidden");
  $("results-map-wrap").classList.remove("hidden");

  const g = $("results-map-pins");
  g.innerHTML = "";
  resetResultsMapView();
  const [cx, cy] = lonLatToXY(payload.answer.lat, payload.answer.lng);
  if (payload.acceptableRadiusKm) {
    const area = document.createElementNS(SVGNS, "ellipse");
    const latScale = Math.max(0.2, Math.cos(payload.answer.lat * Math.PI / 180));
    area.setAttribute("cx", cx); area.setAttribute("cy", cy);
    area.setAttribute("rx", payload.acceptableRadiusKm / 111.32 / latScale * WORLD.W / 360);
    area.setAttribute("ry", payload.acceptableRadiusKm / 111.32 * WORLD.H / 180);
    area.setAttribute("class", "map-target-area");
    g.appendChild(area);
  }
  (payload.ranking || []).forEach((r) => {
    if (!r.guess) return;
    const [x, y] = lonLatToXY(r.guess.lat, r.guess.lng);
    const line = document.createElementNS(SVGNS, "line");
    line.setAttribute("x1", x); line.setAttribute("y1", y);
    line.setAttribute("x2", cx); line.setAttribute("y2", cy);
    line.setAttribute("stroke", "rgba(255,255,255,0.25)"); line.setAttribute("stroke-width", "1.5");
    g.appendChild(line);
    drawPin(g, r.guess.lat, r.guess.lng, (r.avatar && r.avatar.color) || "#888", r.playerId === state.selfId);
  });
  drawStar(g, payload.answer.lat, payload.answer.lng);

  const list = $("result-list");
  list.innerHTML = "";
  const rows = [...(payload.ranking || []), ...(payload.noAnswer || [])];
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (r.playerId === state.selfId) li.classList.add("self");
    const rank = r.distanceKm === null ? "—" : (i + 1);
    const dtext = r.distanceKm === null ? "no answer" :
      r.withinTarget ? "Correct area!" : `${fmt(r.distanceKm)} km outside target`;
    const isWin = i === 0 && r.distanceKm !== null;
    li.innerHTML =
      `<span class="rank">${isWin ? "🏆" : rank}</span>` +
      `<div class="r-main"><div class="r-top">` +
        `<span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span>` +
        `<span class="r-guess">${dtext}${r.cumulativeDistanceKm != null ? `<small>${fmt(r.cumulativeDistanceKm)} km total</small>` : ""}</span></div></div>` +
      `<span class="r-points ${r.pointsAwarded ? "" : "zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  updateResultsHostControls(payload.isFinalRound);
}

const resultsMapView = { x:0, y:0, w:1000, h:500, drag:null };
function applyResultsMapView() {
  $("results-map-svg").setAttribute("viewBox", `${resultsMapView.x} ${resultsMapView.y} ${resultsMapView.w} ${resultsMapView.h}`);
}
function resetResultsMapView() {
  Object.assign(resultsMapView, { x:0, y:0, w:WORLD.W, h:WORLD.H, drag:null });
  applyResultsMapView();
}
function zoomResultsMap(factor, clientX, clientY) {
  const svg = $("results-map-svg"), rect = svg.getBoundingClientRect();
  const cx = clientX == null ? resultsMapView.x + resultsMapView.w / 2 : resultsMapView.x + (clientX - rect.left) / rect.width * resultsMapView.w;
  const cy = clientY == null ? resultsMapView.y + resultsMapView.h / 2 : resultsMapView.y + (clientY - rect.top) / rect.height * resultsMapView.h;
  const nw = Math.max(180, Math.min(WORLD.W, resultsMapView.w * factor)), nh = nw / 2;
  const rx = (cx-resultsMapView.x)/resultsMapView.w, ry = (cy-resultsMapView.y)/resultsMapView.h;
  resultsMapView.x = Math.max(0, Math.min(WORLD.W-nw, cx-rx*nw));
  resultsMapView.y = Math.max(0, Math.min(WORLD.H-nh, cy-ry*nh));
  resultsMapView.w=nw; resultsMapView.h=nh; applyResultsMapView();
}
$("results-map-zoom-in").addEventListener("click", () => zoomResultsMap(.72));
$("results-map-zoom-out").addEventListener("click", () => zoomResultsMap(1.38));
$("results-map-reset").addEventListener("click", resetResultsMapView);
$("results-map-svg").addEventListener("wheel", (e) => { e.preventDefault(); zoomResultsMap(e.deltaY < 0 ? .82 : 1.22, e.clientX, e.clientY); }, {passive:false});
$("results-map-svg").addEventListener("pointerdown", (e) => {
  resultsMapView.drag={id:e.pointerId,x:e.clientX,y:e.clientY};
  $("results-map-svg").setPointerCapture(e.pointerId);
});
$("results-map-svg").addEventListener("pointermove", (e) => {
  const d=resultsMapView.drag; if(!d || d.id!==e.pointerId || resultsMapView.w>=WORLD.W) return;
  const r=$("results-map-svg").getBoundingClientRect();
  resultsMapView.x=Math.max(0,Math.min(WORLD.W-resultsMapView.w,resultsMapView.x-(e.clientX-d.x)*resultsMapView.w/r.width));
  resultsMapView.y=Math.max(0,Math.min(WORLD.H-resultsMapView.h,resultsMapView.y-(e.clientY-d.y)*resultsMapView.h/r.height));
  d.x=e.clientX; d.y=e.clientY; applyResultsMapView();
});
["pointerup","pointercancel"].forEach((event) => $("results-map-svg").addEventListener(event, () => { resultsMapView.drag=null; }));

// ===================== HIDE & BLOW UP =====================
const hidebomb = {
  state: null, ownChoice: null, revealChoices: [],
  objects: [
    { emoji: "💣", name: "B Cannon", key: "B" }, { emoji: "💣", name: "A Cannon", key: "A" },
    { emoji: "💣", name: "Y Cannon", key: "Y" }, { emoji: "💣", name: "X Cannon", key: "X" }
  ]
};

function applyHideBombState(payload) {
  state.mode = "hidebomb"; state.deadline = payload.deadline;
  hidebomb.state = payload;
  hidebomb.ownChoice = Number.isInteger(payload.ownChoice) ? payload.ownChoice : null;
  hidebomb.revealChoices = payload.choices || [];
  const isBomber = payload.bomberId === state.selfId;
  const me = payload.alive?.find((p) => p.playerId === state.selfId);
  const blindfolded = isBomber && payload.stage === "hide";
  $("hidebomb-blindfold").classList.toggle("hidden", !blindfolded);
  $("hidebomb-board").classList.toggle("hidden", blindfolded);
  $("hidebomb-round").textContent = legPrefix() +
    `Round ${payload.roundNumber} · Fuse ${payload.turn} of ${payload.maxTurns}`;
  if (payload.stage === "hide") {
    $("hidebomb-title").textContent = isBomber
      ? "Blindfold on!"
      : (me?.alive ? "Quickly choose a hiding spot!" : "You’re out");
    $("hidebomb-hint").textContent = isBomber
      ? "The team has 10 seconds to hide. Your screen stays covered until time is up."
      : (me?.alive
        ? "You have 10 seconds. Tap B, A, Y or X. You may change your mind—the LAST cannon you choose counts. No choice means trapdoor elimination!"
        : "You have been eliminated. Watch the remaining survivors.");
  } else if (payload.stage === "attack") {
    $("hidebomb-title").textContent = isBomber ? "Where are they hiding?" : `${payload.bomberName} is guessing…`;
    $("hidebomb-hint").textContent = isBomber
      ? `Choose one cannon and light its fuse. Guess ${payload.turn} of ${payload.maxTurns}.`
      : "Your cannon is locked in. Stay quiet and hope the solo player guesses wrong.";
  } else if (payload.stage === "ignite") {
    const cannon = hidebomb.objects[payload.pendingTarget];
    $("hidebomb-title").textContent = "The fuse is burning…";
    $("hidebomb-hint").textContent = `${payload.bomberName} chose the ${cannon?.name || "cannon"}. Is anyone inside?`;
  } else {
    $("hidebomb-title").textContent = "Explosion!";
  }
  $("hidebomb-status").textContent = "";
  renderHideBombBoard(); renderHideBombPlayers();
  startTimer(payload.deadline, "hidebomb-timer"); showScreen("hidebomb");
}

function renderHideBombBoard(exploded = null) {
  const board = $("hidebomb-board"), payload = hidebomb.state;
  if (!payload) return;
  board.innerHTML = "";
  const isBomber = payload.bomberId === state.selfId;
  const me = payload.alive?.find((p) => p.playerId === state.selfId);
  hidebomb.objects.forEach((obj, index) => {
    const destroyed = payload.attacked?.includes(index);
    const button = document.createElement("button");
    const igniting = payload.stage === "ignite" && payload.pendingTarget === index;
    button.className = "hide-object" + (destroyed ? " destroyed" : "") +
      (hidebomb.ownChoice === index ? " selected" : "") +
      (exploded === index ? " explode" : "") + (igniting ? " igniting" : "");
    button.disabled = destroyed || payload.stage === "ignite" || payload.stage === "reveal";
    button.innerHTML = `<span class="object-emoji">${destroyed ? "💥" : obj.emoji}</span>` +
      `<span class="object-name">${obj.name}</span><span class="cannon-fuse"></span>`;
    if (payload.stage === "hide" && !isBomber && me?.alive && !destroyed) {
      button.addEventListener("click", () => socket.emit("hidebomb:choose", { objectIndex: index }));
    } else if (payload.stage === "attack" && isBomber && !destroyed) {
      button.addEventListener("click", () => socket.emit("hidebomb:attack", { objectIndex: index }));
    }
    if (payload.stage === "reveal") {
      const hidden = hidebomb.revealChoices.filter((p) => p.objectIndex === index);
      hidden.forEach((p) => {
        const span = document.createElement("span"); span.className = "hidden-avatar";
        span.appendChild(PaperCharacter.element(
          p.avatar, exploded === index ? "eliminated" : "stunned", p.name
        ));
        span.title = p.name; button.appendChild(span);
      });
    } else if (hidebomb.ownChoice === index) {
      const meAvatar = state.room?.players?.find((p) => p.id === state.selfId)?.avatar;
      const marker = document.createElement("span"); marker.className = "hidden-avatar";
      marker.appendChild(PaperCharacter.element(meAvatar, "idle", "You"));
      button.appendChild(marker);
    }
    board.appendChild(button);
  });
}

function renderHideBombPlayers() {
  const box = $("hidebomb-players"); box.innerHTML = "";
  (hidebomb.state?.alive || []).forEach((p) => {
    const tag = document.createElement("span");
    tag.className = "hidebomb-player" + (p.alive ? "" : " out");
    tag.appendChild(PaperCharacter.element(p.avatar, p.alive ? "idle" : "eliminated", p.name));
    tag.append(` ${p.name} ${p.alive ? "" : "💥"}`);
    box.appendChild(tag);
  });
}

function applyHideBombReveal(payload) {
  hidebomb.state = payload; hidebomb.revealChoices = payload.choices || [];
  hidebomb.ownChoice = null;
  $("hidebomb-title").textContent = payload.eliminated?.length ? "Direct hit! 💥" : "Nobody there!";
  $("hidebomb-hint").textContent = payload.eliminated?.length
    ? `${payload.eliminated.length} player${payload.eliminated.length === 1 ? "" : "s"} eliminated.`
    : "The survivors escaped this blast.";
  $("hidebomb-status").textContent = payload.turn < payload.maxTurns ? "The bomber is moving to the next fuse…" : "";
  renderHideBombBoard(payload.target); renderHideBombPlayers();
  sound.beep(75,.45,"sawtooth",.06);
  setTimeout(()=>sound.beep(48,.55,"triangle",.045),70);
}

window.addEventListener("keydown", (e) => {
  if (currentScreen !== "hidebomb" || e.repeat || !hidebomb.state) return;
  const index = hidebomb.objects.findIndex((o) => o.key.toLowerCase() === e.key.toLowerCase());
  if (index < 0 || hidebomb.state.attacked?.includes(index)) return;
  const isBomber = hidebomb.state.bomberId === state.selfId;
  const me = hidebomb.state.alive?.find((p) => p.playerId === state.selfId);
  if (hidebomb.state.stage === "hide" && !isBomber && me?.alive) {
    socket.emit("hidebomb:choose", { objectIndex: index });
  } else if (hidebomb.state.stage === "attack" && isBomber) {
    socket.emit("hidebomb:attack", { objectIndex: index });
  }
});

// ===================== RED LIGHT, GREEN LIGHT =====================
const redlight = { light: "green", done: false, players: [], isController: false, controllerId: null, moveTimer: null, battery: 100 };

function applyRedLightStart(payload) {
  state.mode = "redlight"; state.deadline = payload.deadline;
  redlight.light = payload.light; redlight.players = payload.players || [];
  redlight.controllerId = payload.controllerId;
  redlight.battery = Number.isFinite(payload.battery) ? payload.battery : 100;
  redlight.isController = payload.controllerId === state.selfId;
  const me = redlight.players.find((p) => p.playerId === state.selfId);
  redlight.done = redlight.isController || !!(me?.eliminated || me?.finished);
  $("redlight-round").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
  $("redlight-status").textContent = redlight.isController ? "You control the light this round." :
    (me?.finished ? "You reached the finish!" : (me?.eliminated ? "You were eliminated." : ""));
  $("redlight-hint").textContent = redlight.isController
    ? "Catch runners with a real red light—or bluff with a harmless feint."
    : `Hold MOVE during green. ${payload.controllerName} controls the light.`;
  $("redlight-move").classList.toggle("hidden", redlight.isController);
  $("redlight-controls").classList.toggle("hidden", !redlight.isController);
  $("redlight-battery-wrap").classList.toggle("hidden", !redlight.isController);
  $("redlight-move").disabled = redlight.done;
  renderRedLightSignal(); renderRedLightBattery(); renderRedLightPlayers(redlight.players);
  startTimer(payload.deadline, "redlight-timer"); showScreen("redlight");
}

function renderRedLightSignal() {
  const signal = $("redlight-signal"), green = redlight.light === "green";
  signal.classList.toggle("green", green); signal.classList.toggle("red", !green);
  $("redlight-title").textContent = green ? "GREEN LIGHT" : "RED LIGHT";
  $("redlight-move").classList.toggle("btn-primary", green);
  $("redlight-move").classList.toggle("btn-danger", !green);
  $("redlight-toggle").textContent = green ? "Switch to red" : "Switch to green";
  $("redlight-feint").disabled = !green || redlight.battery < 12;
}

function renderRedLightBattery() {
  const amount = Math.max(0, Math.min(100, redlight.battery));
  $("redlight-battery").style.width = `${amount}%`;
  $("redlight-battery").classList.toggle("low", amount < 25);
  $("redlight-battery-label").textContent = `${Math.round(amount)}%`;
  if (redlight.isController) {
    $("redlight-toggle").disabled = redlight.light === "green" && amount < 20;
    $("redlight-feint").disabled = redlight.light !== "green" || amount < 12;
  }
}

function renderRedLightPlayers(players) {
  redlight.players = players || redlight.players;
  const track = $("redlight-track"); track.innerHTML = "";
  redlight.players.forEach((p) => {
    if (p.playerId === redlight.controllerId) return;
    const row = document.createElement("div"); row.className = "runner-row";
    const token = document.createElement("div");
    token.className = "runner-token" + (p.eliminated ? " out" : "");
    token.style.left = `calc(${Math.min(92, p.progress*.92)}% - ${p.progress ? 20 : 0}px)`;
    token.appendChild(PaperCharacter.element(
      p.avatar,
      p.eliminated ? "eliminated" : (p.finished ? "celebrate" : (redlight.light === "green" ? "run" : "idle")),
      p.name
    ));
    token.append(` ${p.name}${p.eliminated ? " 💥" : (p.finished ? " 🏁" : "")}`);
    row.appendChild(token); track.appendChild(row);
    if (p.playerId === state.selfId && (p.eliminated || p.finished)) {
      redlight.done = true; $("redlight-move").disabled = true;
      if (p.finished) $("redlight-status").textContent = "You reached the finish!";
    }
  });
}

function startRedLightMove() {
  if (redlight.done || redlight.isController || redlight.moveTimer) return;
  socket.emit("redlight:press");
  redlight.moveTimer = setInterval(() => socket.emit("redlight:press"), 70);
}
function stopRedLightMove() {
  clearInterval(redlight.moveTimer); redlight.moveTimer = null;
}
$("redlight-move").addEventListener("pointerdown", (e) => { e.preventDefault(); startRedLightMove(); });
$("redlight-move").addEventListener("pointerup", stopRedLightMove);
$("redlight-move").addEventListener("pointercancel", stopRedLightMove);
$("redlight-move").addEventListener("pointerleave", stopRedLightMove);
$("redlight-toggle").addEventListener("click", () => socket.emit("redlight:control", { action: "toggle" }));
$("redlight-feint").addEventListener("click", () => socket.emit("redlight:control", { action: "feint" }));
window.addEventListener("keydown", (e) => {
  if (currentScreen === "redlight" && [" ", "Enter"].includes(e.key)) {
    e.preventDefault(); startRedLightMove();
  }
});
window.addEventListener("keyup", (e) => {
  if (currentScreen === "redlight" && [" ", "Enter"].includes(e.key)) stopRedLightMove();
});

// ===================== DRAWING =====================
const drawing = { active: false, isDrawer: false, word: null, pointer: null };

function clearDrawingCanvas() {
  const c = $("drawing-canvas"), ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
}

function drawRemoteStroke(s) {
  const c = $("drawing-canvas"), ctx = c.getContext("2d");
  ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(s.x0*c.width, s.y0*c.height);
  ctx.lineTo(s.x1*c.width, s.y1*c.height); ctx.stroke();
}

function applyDrawingStart(payload) {
  state.mode = "drawing"; state.deadline = payload.deadline;
  drawing.active = true; drawing.isDrawer = payload.drawerId === state.selfId;
  drawing.word = payload.word || null;
  $("drawing-round").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
  $("drawing-title").textContent = drawing.isDrawer
    ? (drawing.word ? `Draw: ${drawing.word}` : "Your turn to draw!")
    : `${payload.drawerName} is drawing`;
  $("drawing-clue").textContent = drawing.isDrawer ? "Help everyone guess it." : `${payload.wordLength} letters`;
  $("drawing-tools").classList.toggle("hidden", !drawing.isDrawer);
  $("drawing-guess-form").classList.toggle("hidden", drawing.isDrawer || payload.alreadyGuessed);
  $("drawing-status").textContent = payload.alreadyGuessed ? "You got it! Waiting for the others…" : "";
  $("drawing-feed").innerHTML = "";
  clearDrawingCanvas();
  (payload.strokes || []).forEach(drawRemoteStroke);
  startTimer(payload.deadline, "drawing-timer");
  showScreen("drawing");
}

function drawingPoint(e) {
  const c = $("drawing-canvas"), r = c.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (e.clientX-r.left)/r.width)), y: Math.max(0, Math.min(1, (e.clientY-r.top)/r.height)) };
}
const drawingCanvas = $("drawing-canvas");
drawingCanvas.addEventListener("pointerdown", (e) => {
  if (!drawing.isDrawer || !drawing.active) return;
  drawing.pointer = drawingPoint(e); drawingCanvas.setPointerCapture(e.pointerId);
});
drawingCanvas.addEventListener("pointermove", (e) => {
  if (!drawing.pointer || !drawing.isDrawer) return;
  const next = drawingPoint(e);
  socket.emit("drawing:stroke", {
    x0: drawing.pointer.x, y0: drawing.pointer.y, x1: next.x, y1: next.y,
    color: $("drawing-color").value, width: Number($("drawing-width").value)
  });
  drawing.pointer = next;
});
const endDrawingPointer = () => { drawing.pointer = null; };
drawingCanvas.addEventListener("pointerup", endDrawingPointer);
drawingCanvas.addEventListener("pointercancel", endDrawingPointer);
$("drawing-clear").addEventListener("click", () => socket.emit("drawing:clear"));
$("drawing-guess-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("drawing-guess"), guess = input.value.trim();
  if (guess) socket.emit("drawing:guess", { guess });
  input.value = "";
});

function showDrawingGuess(item) {
  const feed = $("drawing-feed"), p = document.createElement("p");
  p.textContent = item.correct ? `✅ ${item.name} guessed the word!` : `${item.name}: ${item.guess}`;
  if (item.correct && item.playerId === state.selfId) {
    $("drawing-guess-form").classList.add("hidden");
    $("drawing-status").textContent = "Correct! Waiting for the others…";
  }
  feed.appendChild(p); feed.scrollTop = feed.scrollHeight;
}

// ===================== PUSHY SURVIVAL =====================
const pushy = {
  phase: null, raf: 0, player: null, penguins: [], keys: {},
  startedAt: 0, done: false, seed: 1, lastSpawn: 0,
  remotePlayers: new Map(), lastPositionSent: 0
};
function pushyRandom() {
  pushy.seed = (pushy.seed * 1664525 + 1013904223) >>> 0;
  return pushy.seed / 4294967296;
}
function applyPushyStart(payload) {
  state.mode = "pushy"; state.deadline = payload.deadline;
  pushy.phase = "playing"; pushy.done = !!payload.alreadyDone; pushy.seed = payload.seed || 1;
  const ownStart = (payload.players || []).find((p) => p.playerId === state.selfId);
  pushy.player = { x: ownStart?.x ?? 360, y: ownStart?.y ?? 220, r: 17, vx: 0, vy: 0 };
  pushy.remotePlayers = new Map();
  updatePushyPositions(payload.players || []);
  pushy.penguins = [];
  const elapsedAlready = Math.max(0, 22000 - (payload.deadline - Date.now()));
  pushy.startedAt = performance.now() - elapsedAlready;
  pushy.lastSpawn = 0;
  $("pushy-round").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
  $("pushy-title").textContent = pushy.done ? "Run already recorded" : "Stay on the ice!";
  $("pushy-controls").classList.toggle("hidden", pushy.done);
  $("pushy-status").textContent = pushy.done ? "Waiting for the others…" : "";
  startTimer(payload.deadline, "pushy-timer"); showScreen("pushy");
  let previous = performance.now();
  const frame = (now) => {
    const dt = Math.min(.033, (now-previous)/1000); previous = now;
    if (!pushy.done) stepPushy(dt, now);
    drawPushy();
    if (pushy.phase === "playing") pushy.raf = requestAnimationFrame(frame);
  };
  cancelAnimationFrame(pushy.raf); pushy.raf = requestAnimationFrame(frame);
}
function stepPushy(dt, now) {
  const p = pushy.player, ax = ((pushy.keys.right?1:0)-(pushy.keys.left?1:0))*650;
  const ay = ((pushy.keys.down?1:0)-(pushy.keys.up?1:0))*650;
  p.vx = (p.vx+ax*dt)*Math.pow(.04,dt); p.vy = (p.vy+ay*dt)*Math.pow(.04,dt);
  p.x += p.vx*dt; p.y += p.vy*dt;
  const elapsed = now-pushy.startedAt;
  if (elapsed-pushy.lastSpawn > Math.max(360, 820-elapsed/38)) {
    pushy.lastSpawn = elapsed;
    const count=3+Math.floor(pushyRandom()*5),baseY=78+pushyRandom()*260;
    for(let i=0;i<count;i++){
      const large=pushyRandom()<.16,r=large?20:13+pushyRandom()*3;
      pushy.penguins.push({
        x:-35-i*(25+pushyRandom()*19),
        y:Math.max(78,Math.min(362,baseY+(i-(count-1)/2)*31+(pushyRandom()-.5)*16)),
        vx:165+elapsed/100+pushyRandom()*65-(large?18:0),vy:0,r,large,
        phase:pushyRandom()*Math.PI*2
      });
    }
  }
  for (const q of pushy.penguins) {
    q.x += q.vx*dt; q.y += q.vy*dt;
    const dx=p.x-q.x, dy=p.y-q.y, dist=Math.hypot(dx,dy), min=p.r+q.r;
    if (dist < min && dist > 0) {
      const force=(min-dist)*(q.large?11:8); p.vx += dx/dist*force; p.vy += dy/dist*force;
      p.stunUntil = performance.now() + 180;
    }
  }
  pushy.penguins = pushy.penguins.filter((q) => q.x>-340&&q.x<780&&q.y>-60&&q.y<500);
  // Other players share the same ice and can gently bump one another.
  for (const other of pushy.remotePlayers.values()) {
    if (other.done) continue;
    const dx=p.x-other.x,dy=p.y-other.y,dist=Math.hypot(dx,dy),min=34;
    if(dist>0&&dist<min){const force=(min-dist)*5;p.vx+=dx/dist*force;p.vy+=dy/dist*force;}
  }
  if (now-pushy.lastPositionSent > 80) {
    pushy.lastPositionSent=now;
    socket.emit("pushy:position",{x:p.x,y:p.y,vx:p.vx,vy:p.vy});
  }
  if (p.x < 105 || p.x > 615 || p.y < 65 || p.y > 375) finishPushy("dead");
  if (Date.now() >= state.deadline-120) finishPushy("survived");
}
function drawCrowdPenguin(ctx,q,now){
  const scale=q.r/15,waddle=Math.sin(now/80+q.phase),step=Math.sin(now/55+q.phase);
  ctx.save();ctx.translate(q.x,q.y);ctx.rotate(waddle*.075);ctx.scale(scale,scale);
  ctx.fillStyle="rgba(8,47,73,.25)";ctx.beginPath();ctx.ellipse(0,15,14,5,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#f59e0b";ctx.beginPath();
  ctx.ellipse(-6+step*1.5,13,6,3,-.12,0,Math.PI*2);ctx.ellipse(6-step*1.5,13,6,3,.12,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#111827";ctx.beginPath();ctx.ellipse(0,0,13,18,0,0,Math.PI*2);ctx.fill();
  ctx.beginPath();ctx.ellipse(-13,-1,4,11,-.35+waddle*.18,0,Math.PI*2);
  ctx.ellipse(13,-1,4,11,.35+waddle*.18,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#f8fafc";ctx.beginPath();ctx.ellipse(0,3,8.5,12,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#111827";ctx.beginPath();ctx.arc(0,-10,10,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(-3.6,-11,2.8,0,Math.PI*2);ctx.arc(3.6,-11,2.8,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#0f172a";ctx.beginPath();ctx.arc(-3.2,-10.7,1.25,0,Math.PI*2);ctx.arc(4,-10.7,1.25,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#fb923c";ctx.beginPath();ctx.moveTo(-4,-7);ctx.lineTo(7,-5);ctx.lineTo(-4,-2);ctx.closePath();ctx.fill();
  if(q.large){ctx.strokeStyle="rgba(255,255,255,.5)";ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,15,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
}
function drawPushy() {
  const c=$("pushy-canvas"), ctx=c.getContext("2d"), p=pushy.player;
  ctx.clearRect(0,0,c.width,c.height);
  const water=ctx.createLinearGradient(0,0,0,c.height);
  water.addColorStop(0,"#0891b2");water.addColorStop(1,"#155e75");
  ctx.fillStyle=water;ctx.fillRect(0,0,c.width,c.height);
  ctx.strokeStyle="rgba(255,255,255,.16)";ctx.lineWidth=3;
  for(let y=25;y<c.height;y+=38){ctx.beginPath();ctx.moveTo(0,y);ctx.quadraticCurveTo(c.width*.5,y+12,c.width,y);ctx.stroke();}
  const ice=ctx.createLinearGradient(100,60,620,380);
  ice.addColorStop(0,"#cffafe");ice.addColorStop(.55,"#67e8f9");ice.addColorStop(1,"#a5f3fc");
  ctx.fillStyle=ice;ctx.fillRect(100,60,520,320);
  ctx.strokeStyle="#ecfeff";ctx.lineWidth=8;ctx.strokeRect(100,60,520,320);
  ctx.strokeStyle="rgba(14,116,144,.22)";ctx.lineWidth=2;
  [[170,120,210,155],[520,105,485,155],[270,330,305,292],[460,300,430,267]].forEach(v=>{
    ctx.beginPath();ctx.moveTo(v[0],v[1]);ctx.lineTo(v[2],v[3]);ctx.lineTo(v[2]+15,v[3]+8);ctx.stroke();
  });
  pushy.penguins.slice().sort((a,b)=>a.y-b.y)
    .forEach((q)=>drawCrowdPenguin(ctx,q,performance.now()));
  for (const other of pushy.remotePlayers.values()) {
    PaperCharacter.draw(ctx,{
      x:other.x,y:other.y,size:48,avatar:other.avatar,
      state:other.done?"eliminated":(Math.hypot(other.vx||0,other.vy||0)>20?"run":"idle"),
      direction:(other.vx||0)<-2?-1:1,time:performance.now()
    });
    ctx.fillStyle="rgba(15,23,42,.8)";ctx.font="bold 13px sans-serif";
    ctx.textAlign="center";ctx.fillText(other.name||"",other.x,other.y-32);
  }
  if (p) {
    const me=state.room?.players?.find((x)=>x.id===state.selfId);
    PaperCharacter.draw(ctx,{
      x:p.x,y:p.y,size:52,avatar:me?.avatar,
      state:p.animState||(performance.now() < (p.stunUntil||0)?"stunned":(Math.hypot(p.vx,p.vy)>22?"run":"idle")),
      direction:p.vx < -2 ? -1 : 1,time:performance.now()
    });
    ctx.fillStyle="rgba(15,23,42,.88)";ctx.font="bold 13px sans-serif";
    ctx.textAlign="center";ctx.fillText("You",p.x,p.y-35);
  }
}
function updatePushyPositions(players) {
  if (!Array.isArray(players)) return;
  const next = new Map();
  players.forEach((p) => {
    if (p.playerId !== state.selfId) next.set(p.playerId,p);
  });
  pushy.remotePlayers = next;
}
function finishPushy(outcome) {
  if (pushy.done) return;
  pushy.done=true; pushy.player.animState=outcome==="survived"?"celebrate":"eliminated";
  $("pushy-controls").classList.add("hidden");
  $("pushy-title").textContent=outcome==="survived" ? "You survived! 🎉" : "Splash! You fell in.";
  $("pushy-status").textContent="Waiting for the other players…";
  socket.emit("pushy:outcome",{outcome,timeMs:performance.now()-pushy.startedAt});
}
function setPushyKey(key, down) { pushy.keys[key]=down; }
window.addEventListener("keydown",(e)=>{
  if(pushy.phase!=="playing") return;
  const map={ArrowLeft:"left",a:"left",A:"left",ArrowRight:"right",d:"right",D:"right",ArrowUp:"up",w:"up",W:"up",ArrowDown:"down",s:"down",S:"down"};
  if(map[e.key]) { setPushyKey(map[e.key],true); e.preventDefault(); }
});
window.addEventListener("keyup",(e)=>{
  const map={ArrowLeft:"left",a:"left",A:"left",ArrowRight:"right",d:"right",D:"right",ArrowUp:"up",w:"up",W:"up",ArrowDown:"down",s:"down",S:"down"};
  if(map[e.key]) setPushyKey(map[e.key],false);
});
document.querySelectorAll("[data-pushy]").forEach((b)=>{
  const key=b.dataset.pushy, down=(e)=>{e.preventDefault();setPushyKey(key,true);}, up=(e)=>{e.preventDefault();setPushyKey(key,false);};
  b.addEventListener("pointerdown",down); b.addEventListener("pointerup",up); b.addEventListener("pointercancel",up); b.addEventListener("pointerleave",up);
});

// ===================== PLATFORMER =====================
const platformer = {
  phase: null, view: null, selected: null, locked: false, raf: 0,
  keys: { left: false, right: false, jump: false }, player: null, startedAt: 0, done: false,
  remotePlayers: new Map(), lastPositionSent: 0, lastHoverSent: 0, hover: null,
  maps:[],mapVotes:{},votedPlayerIds:[],rouletteTimer:null
};

function applyPlatformerMapVote(payload) {
  cancelAnimationFrame(platformer.raf);clearInterval(platformer.rouletteTimer);
  state.mode="platformer";state.deadline=payload.deadline;
  platformer.phase="mapvote";platformer.maps=payload.maps||[];
  platformer.mapVotes=payload.votes||{};platformer.votedPlayerIds=payload.votedPlayerIds||[];
  $("platformer-round").textContent=legPrefix()+"Choose the course";
  $("platformer-title").textContent="Vote for a map";
  $("platformer-hint").textContent="Pick your favorite. A tied vote triggers the random map roulette!";
  $("platformer-map-vote").classList.remove("hidden");
  document.querySelector(".platformer-wrap").classList.add("hidden");
  $("platformer-tools").classList.add("hidden");$("platformer-lock").classList.add("hidden");
  $("platformer-controls").classList.add("hidden");$("platformer-status").textContent="";
  renderPlatformerMapVotes();
  startTimer(payload.deadline,"platformer-timer");showScreen("platformer");
}

function renderPlatformerMapVotes() {
  const wrap=$("platformer-map-vote");wrap.innerHTML="";
  platformer.maps.forEach((map)=>{
    const card=document.createElement("button");card.className="map-vote-card";
    card.dataset.mapId=map.id;
    const canvas=document.createElement("canvas");canvas.width=240;canvas.height=140;
    const ctx=canvas.getContext("2d"),theme=map.theme||{};
    const grad=ctx.createLinearGradient(0,0,0,140);grad.addColorStop(0,theme.skyTop||"#7dd3fc");grad.addColorStop(1,theme.skyBottom||"#dbeafe");
    ctx.fillStyle=grad;ctx.fillRect(0,0,240,140);ctx.fillStyle=theme.void||"#312e81";ctx.fillRect(0,110,240,30);
    (map.preview||[]).forEach(([c,r,type])=>{
      ctx.fillStyle=type==="ice"?"#67e8f9":type==="crumble"?"#f59e0b":type==="bouncy"?"#4ade80":"#64748b";
      ctx.fillRect(c*10,r*10,10,10);
    });
    ctx.fillStyle="#facc15";ctx.fillRect(200,85,3,25);
    const title=document.createElement("strong");title.textContent=`${map.emoji} ${map.name}`;
    const desc=document.createElement("small");desc.textContent=map.description;
    const count=document.createElement("span");count.className="map-vote-count";count.textContent=platformer.mapVotes[map.id]||0;
    card.append(canvas,title,desc,count);
    card.addEventListener("click",()=>socket.emit("platformer:map-vote",{mapId:map.id}));
    wrap.appendChild(card);
  });
}

function applyPlatformerMapSelected(payload) {
  platformer.phase="maproulette";clearInterval(platformer.rouletteTimer);
  $("platformer-title").textContent=(payload.finalistIds?.length||0)>1?"TIE! Random map roulette…":"Map selected!";
  $("platformer-hint").textContent="Watch the glow—where will it stop?";
  const ids=payload.finalistIds?.length?payload.finalistIds:platformer.maps.map((m)=>m.id);
  let step=0;
  platformer.rouletteTimer=setInterval(()=>{
    const cards=[...$("platformer-map-vote").children];
    cards.forEach((c)=>c.classList.remove("roulette","winner"));
    const nearEnd=step>=13;
    const id=nearEnd?payload.selectedId:ids[step%ids.length];
    const card=cards.find((c)=>c.dataset.mapId===id);
    if(card)card.classList.add(nearEnd?"winner":"roulette");
    step++;
    if(step>=17){
      clearInterval(platformer.rouletteTimer);
      cards.forEach((c)=>c.classList.toggle("winner",c.dataset.mapId===payload.selectedId));
      const chosen=platformer.maps.find((m)=>m.id===payload.selectedId);
      $("platformer-title").textContent=`${chosen?.emoji||"🏁"} ${chosen?.name||"Map"} wins!`;
    }
  },Math.max(90,Math.min(160,(payload.rouletteMs||2600)/17)));
}

function applyPlatformerBuild(payload) {
  cancelAnimationFrame(platformer.raf);
  state.mode = "platformer"; state.deadline = payload.deadline;
  platformer.phase = "build"; platformer.view = payload; platformer.done = false; platformer.hover = null;
  // Never carry racers from the previous round onto the construction board.
  platformer.player = null;
  platformer.remotePlayers = new Map();
  const canvas=$("platformer-canvas");
  canvas.width=payload.level.cols*payload.level.tile;
  canvas.height=payload.level.rows*payload.level.tile;
  platformer.selected=payload.builders?.find((p)=>p.playerId===state.selfId)?.selected || null;
  platformer.keys.left = platformer.keys.right = platformer.keys.jump = false;
  $("platformer-map-vote").classList.add("hidden");
  document.querySelector(".platformer-wrap").classList.remove("hidden");
  $("platformer-round").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
  $("platformer-title").textContent = "Build the course";
  $("platformer-hint").textContent = "Choose a tile, then tap an empty square. Everyone adds one.";
  $("platformer-controls").classList.add("hidden");
  $("platformer-tools").classList.remove("hidden");
  $("platformer-lock").classList.remove("hidden");
  $("platformer-status").textContent = "";
  renderPlatformerTools();
  startTimer(payload.deadline, "platformer-timer");
  drawPlatformer();
  updatePlatformerLock();
  showScreen("platformer");
}

function renderPlatformerTools() {
  if (!platformer.view) return;
  const tools=$("platformer-tools"), pool=platformer.view.pool || {};
  tools.innerHTML="";
  const labels={
    solid:"🧱 Block",spike:"🔺 Spikes",bouncy:"🟩 Bounce",
    ice:"🧊 Ice",crumble:"🟧 Crumble",saw:"⚙️ Saw",
    conveyor:"➡️ Conveyor",bombtrap:"💣 Demolish"
  };
  (platformer.view.hand || []).forEach((type) => {
    const b = document.createElement("button");
    b.className = "btn btn-secondary" + (type === platformer.selected ? " active" : "");
    const remaining=pool[type] ?? 0;
    b.textContent=`${labels[type] || type} · ${remaining}`;
    b.disabled=platformer.locked || (remaining < 1 && type !== platformer.selected);
    b.addEventListener("click", () => {
      platformer.selected = type;
      socket.emit("platformer:select",{type});
      renderPlatformerTools();
      drawPlatformer();
    });
    tools.appendChild(b);
  });
}

function updatePlatformerLock() {
  const mine = platformer.view?.placements?.find((p) => p.playerId === state.selfId);
  platformer.locked = !!mine?.locked;
  $("platformer-lock").textContent = platformer.locked ? "Unlock tile" : (mine ? "Lock in tile" : "Skip & lock");
}

$("platformer-canvas").addEventListener("click", (e) => {
  if (platformer.phase !== "build" || platformer.locked || !platformer.selected) return;
  const canvas = $("platformer-canvas"), r = canvas.getBoundingClientRect(), l = platformer.view.level;
  socket.emit("platformer:place", {
    col: Math.floor((e.clientX-r.left)/r.width*l.cols),
    row: Math.floor((e.clientY-r.top)/r.height*l.rows),
    type: platformer.selected
  });
});
$("platformer-canvas").addEventListener("pointermove", (e) => {
  if (platformer.phase !== "build" || platformer.locked) return;
  const canvas=$("platformer-canvas"), r=canvas.getBoundingClientRect(), l=platformer.view.level;
  platformer.hover = {
    col: Math.max(0,Math.min(l.cols-1,Math.floor((e.clientX-r.left)/r.width*l.cols))),
    row: Math.max(0,Math.min(l.rows-1,Math.floor((e.clientY-r.top)/r.height*l.rows)))
  };
  const now=performance.now();
  if(now-platformer.lastHoverSent>45){
    platformer.lastHoverSent=now;
    socket.emit("platformer:hover",platformer.hover);
  }
  drawPlatformer();
});
$("platformer-canvas").addEventListener("pointerleave", () => {
  if (platformer.phase === "build") {
    platformer.hover=null;socket.emit("platformer:hover",{col:null,row:null});drawPlatformer();
  }
});
$("platformer-lock").addEventListener("click", () => socket.emit("platformer:lock", { locked: !platformer.locked }));

function drawPlatformerTile(ctx,type,x,y,s,alpha=1) {
  ctx.save();ctx.globalAlpha*=alpha;
  if(type==="spike"){
    ctx.fillStyle="#ef4444";ctx.beginPath();
    ctx.moveTo(x,y+s);ctx.lineTo(x+s/2,y+3);ctx.lineTo(x+s,y+s);ctx.fill();
  }else if(type==="saw"){
    ctx.translate(x+s/2,y+s/2);ctx.rotate(performance.now()/260);
    ctx.fillStyle="#e2e8f0";ctx.strokeStyle="#475569";ctx.lineWidth=3;
    ctx.beginPath();
    for(let i=0;i<16;i++){const a=i*Math.PI/8,r=i%2?s*.31:s*.45;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}
    ctx.closePath();ctx.fill();ctx.stroke();
    ctx.fillStyle="#ef4444";ctx.beginPath();ctx.arc(0,0,s*.105,0,Math.PI*2);ctx.fill();
  }else if(type==="bombtrap"){
    ctx.fillStyle="#111827";ctx.strokeStyle="#f8fafc";ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(x+s/2,y+s*.58,s*.29,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.strokeStyle="#f97316";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x+s*.62,y+s*.34);ctx.quadraticCurveTo(x+s*.78,y+s*.12,x+s*.86,y+s*.24);ctx.stroke();
    ctx.fillStyle="#facc15";ctx.beginPath();ctx.arc(x+s*.87,y+s*.23,3,0,Math.PI*2);ctx.fill();
  }else{
    ctx.fillStyle=type==="bouncy"?"#4ade80":type==="ice"?"#67e8f9":type==="crumble"?"#f59e0b":type==="conveyor"?"#a855f7":"#64748b";
    ctx.fillRect(x,y,s,s);ctx.strokeStyle="rgba(255,255,255,.28)";ctx.strokeRect(x+.5,y+.5,s-1,s-1);
    if(type==="ice"){ctx.strokeStyle="rgba(255,255,255,.7)";ctx.beginPath();ctx.moveTo(x+6,y+s-8);ctx.lineTo(x+s-8,y+7);ctx.stroke();}
    if(type==="crumble"){ctx.strokeStyle="#92400e";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x+8,y+5);ctx.lineTo(x+19,y+18);ctx.lineTo(x+13,y+34);ctx.moveTo(x+19,y+18);ctx.lineTo(x+34,y+12);ctx.stroke();}
    if(type==="conveyor"){
      ctx.fillStyle="#fff";ctx.font=`bold ${Math.round(s*.45)}px sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("»",x+s/2,y+s/2);
    }
  }
  ctx.restore();
}

function drawPlatformerBackground(ctx,level,width,height) {
  const theme=level.theme||{},id=theme.id||"sky";
  const grad=ctx.createLinearGradient(0,0,0,height);
  grad.addColorStop(0,theme.skyTop||"#38bdf8");grad.addColorStop(1,theme.skyBottom||"#dbeafe");
  ctx.fillStyle=grad;ctx.fillRect(0,0,width,height);
  ctx.fillStyle=theme.void||"#312e81";ctx.fillRect(0,level.goal.y,width,height-level.goal.y);
  if(id==="sky"){
    ctx.fillStyle="rgba(255,255,255,.72)";
    [[110,100,85],[430,155,110],[760,85,92]].forEach(([x,y,w])=>{
      ctx.beginPath();ctx.ellipse(x,y,w*.34,18,0,0,Math.PI*2);ctx.ellipse(x+w*.25,y-10,w*.25,24,0,0,Math.PI*2);ctx.ellipse(x-w*.25,y-6,w*.22,20,0,0,Math.PI*2);ctx.fill();
    });
  }else if(id==="canyon"){
    ctx.fillStyle="rgba(124,45,18,.28)";
    [[0,360,150,90],[180,390,130,60],[690,365,180,85]].forEach(([x,y,w,h])=>{
      ctx.beginPath();ctx.moveTo(x,y+h);ctx.lineTo(x+w*.3,y);ctx.lineTo(x+w*.58,y+h*.28);ctx.lineTo(x+w,y+h);ctx.fill();
    });
    ctx.fillStyle="rgba(255,255,255,.35)";ctx.beginPath();ctx.arc(width-110,90,42,0,Math.PI*2);ctx.fill();
  }else{
    ctx.fillStyle="rgba(255,255,255,.65)";
    for(let i=0;i<38;i++)ctx.fillRect((i*137)%width,(i*71)%330,2+(i%3===0),2+(i%3===0));
    ctx.strokeStyle="rgba(34,211,238,.12)";ctx.lineWidth=1;
    for(let x=0;x<width;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke();}
  }
}

function drawPlatformer(player = platformer.player) {
  if (!platformer.view?.level) return;
  const canvas = $("platformer-canvas"), ctx = canvas.getContext("2d");
  const level = platformer.view.level, s = level.tile, tiles = { ...level.tiles };
  drawPlatformerBackground(ctx,level,canvas.width,canvas.height);
  (platformer.view.placements || []).forEach((p) => {
    if (Number.isFinite(p.col) && p.type!=="demolition") tiles[`${p.col},${p.row}`] = p.type;
  });
  for (const [key, type] of Object.entries(tiles)) {
    const [c, r] = key.split(",").map(Number), x = c*s, y = r*s;
    if(player?.brokenTiles?.has(key)) continue;
    drawPlatformerTile(ctx,type,x,y,s);
  }

  // A visible construction grid makes valid placement cells unambiguous.
  if (platformer.phase === "build") {
    ctx.save();
    ctx.strokeStyle="rgba(15,23,42,.34)";ctx.lineWidth=1;
    for(let c=0;c<=level.cols;c++){ctx.beginPath();ctx.moveTo(c*s+.5,0);ctx.lineTo(c*s+.5,level.rows*s);ctx.stroke();}
    for(let r=0;r<=level.rows;r++){ctx.beginPath();ctx.moveTo(0,r*s+.5);ctx.lineTo(level.cols*s,r*s+.5);ctx.stroke();}

    const h=platformer.hover;
    if (h && !platformer.locked && platformer.selected) {
      const key=`${h.col},${h.row}`,occupied=!!tiles[key], x=h.col*s, y=h.row*s;
      const removable=(platformer.view.removableTiles||[]).includes(key)||
        (platformer.view.placements||[]).some((p)=>p.type!=="demolition"&&p.col===h.col&&p.row===h.row);
      const demolition=platformer.selected==="bombtrap";
      ctx.globalAlpha=.72;
      if (demolition&&removable) {
        drawPlatformerTile(ctx,"bombtrap",x+1,y+1,s-2,.9);
      } else if (occupied || demolition) {
        ctx.fillStyle="#ef4444";ctx.fillRect(x+2,y+2,s-4,s-4);
        ctx.globalAlpha=.9;ctx.strokeStyle="#fecaca";ctx.lineWidth=4;
        ctx.beginPath();ctx.moveTo(x+10,y+10);ctx.lineTo(x+s-10,y+s-10);
        ctx.moveTo(x+s-10,y+10);ctx.lineTo(x+10,y+s-10);ctx.stroke();
      } else {
        drawPlatformerTile(ctx,platformer.selected,x+1,y+1,s-2,.82);
      }
      ctx.globalAlpha=.95;ctx.strokeStyle=(demolition&&!removable)||(!demolition&&occupied)?"#fecaca":demolition?"#4ade80":"#fff";ctx.lineWidth=3;
      ctx.strokeRect(x+1.5,y+1.5,s-3,s-3);
    }

    // Other players' selected pieces and cursor cells update live.
    (platformer.view.builders || []).forEach((builder)=>{
      if(builder.playerId===state.selfId||!builder.selected||!builder.cursor)return;
      const {col,row}=builder.cursor,x=col*s,y=row*s;
      drawPlatformerTile(ctx,builder.selected,x+2,y+2,s-4,.42);
      ctx.strokeStyle=builder.avatar?.color||"#facc15";ctx.lineWidth=3;ctx.strokeRect(x+2,y+2,s-4,s-4);
      ctx.fillStyle="rgba(15,23,42,.9)";ctx.font="bold 11px sans-serif";ctx.textAlign="center";
      ctx.fillText(builder.name,x+s/2,y-4);
    });
    (platformer.view.placements||[]).forEach((p)=>{
      if(p.type!=="demolition")return;
      ctx.font=`${Math.round(s*.7)}px sans-serif`;ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText("💥",p.col*s+s/2,p.row*s+s/2);
    });
    ctx.restore();
  }

  ctx.fillStyle = "#facc15"; ctx.fillRect(level.goal.x0, level.goal.y-70, 7, 70);
  ctx.fillStyle = "#fff"; ctx.fillRect(level.goal.x0+7, level.goal.y-70, 34, 22);

  // During construction everyone waits together on the starting platform, so
  // all players remain visible to all screens before the race begins.
  if (platformer.phase === "build") {
    const players=platformer.view.players || [];
    players.forEach((p,i)=>{
      const columns=Math.max(1,Math.min(4,players.length));
      const x=(.65+(i%columns)*.78)*s;
      const y=level.goal.y-24-(Math.floor(i/columns)*44);
      PaperCharacter.draw(ctx,{x,y,size:48,avatar:p.avatar,state:"idle",time:0});
      ctx.fillStyle="rgba(15,23,42,.85)";ctx.font="bold 12px sans-serif";ctx.textAlign="center";
      ctx.fillText(p.playerId===state.selfId?"You":p.name,x,y-30);
    });
  }

  if (platformer.phase === "race") for (const other of platformer.remotePlayers.values()) {
    if (!Number.isFinite(other.targetX) || !Number.isFinite(other.targetY)) continue;
    // Network updates arrive less often than canvas frames. Ease toward each
    // target so another racer never appears to shake between packet positions.
    other.renderX += (other.targetX-other.renderX)*.55;
    other.renderY += (other.targetY-other.renderY)*.55;
    const rx=other.renderX, ry=other.renderY;
    const remoteState = other.done ? "celebrate"
      : (Math.abs(other.vx||0)>25 ? "run" : ((other.vy||0)<-20 ? "jump" : ((other.vy||0)>30 ? "fall" : "idle")));
    ctx.save(); ctx.globalAlpha=.72;
    PaperCharacter.draw(ctx,{
      x:rx+16,y:ry+10,size:48,avatar:other.avatar,state:remoteState,
      direction:(other.vx||0)<-2?-1:1,time:remoteState === "idle" ? 0 : performance.now()
    });
    ctx.restore();
    ctx.fillStyle="rgba(15,23,42,.82)";ctx.font="bold 12px sans-serif";
    ctx.textAlign="center";ctx.fillText(other.name||"",rx+16,ry-17);
  }
  if (platformer.phase === "race" && player) {
    const me = state.room?.players?.find((p) => p.id === state.selfId);
    const anim = player.animState || (performance.now() < (player.landUntil||0)
      ? "land" : player.grounded
      ? (Math.abs(player.vx) > 25 ? "run" : "idle")
      : (player.vy < 0 ? "jump" : "fall"));
    PaperCharacter.draw(ctx,{
      // The character artwork extends below its origin; anchor its shoes to the
      // collision box so it does not appear to sink into or jitter on blocks.
      x:player.x+player.w/2,y:player.y+player.h-24,size:48,
      avatar:me?.avatar,state:anim,direction:player.vx < -2 ? -1 : 1,
      // A fixed idle frame keeps the feet visually planted on hard-edged tiles.
      time:anim === "idle" ? 0 : performance.now()
    });
    ctx.fillStyle="rgba(15,23,42,.9)";ctx.font="bold 12px sans-serif";
    ctx.textAlign="center";ctx.fillText("You",player.x+player.w/2,player.y-17);
  }
}

function applyPlatformerRace(payload) {
  state.mode = "platformer"; state.deadline = payload.deadline;
  $("platformer-map-vote").classList.add("hidden");
  document.querySelector(".platformer-wrap").classList.remove("hidden");
  platformer.phase = "race"; platformer.view = payload; platformer.done = !!payload.alreadyDone;
  platformer.remotePlayers = new Map();
  updatePlatformerPositions(payload.players || []);
  platformer.lastPositionSent = 0;
  const canvas=$("platformer-canvas");
  canvas.width=payload.level.cols*payload.level.tile;
  canvas.height=payload.level.rows*payload.level.tile;
  const spawn = payload.level.spawn;
  const racers=payload.players || [];
  const racerIndex=Math.max(0,racers.findIndex((p)=>p.playerId===state.selfId));
  // Give racers distinct starting lanes across the four-block start platform.
  const spawnCenter=racers.length>1
    ? 32+racerIndex*(96/Math.max(1,racers.length-1))
    : spawn.x;
  platformer.player = {
    x: spawnCenter-16, y: spawn.y-34, w: 32, h: 34, vx: 0, vy: 0,
    grounded: false, coyoteUntil: 0, jumpQueuedUntil: 0,
    surfaceType:null,surfaceKey:null,crumbleTimers:new Map(),brokenTiles:new Set()
  };
  platformer.startedAt = performance.now();
  $("platformer-round").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
  $("platformer-title").textContent = platformer.done ? "Run already recorded" : "Race to the flag!";
  $("platformer-hint").textContent = "Use A/D or ←/→ to move. Space or Jump to leap.";
  $("platformer-tools").classList.add("hidden"); $("platformer-lock").classList.add("hidden");
  $("platformer-controls").classList.toggle("hidden", platformer.done);
  $("platformer-status").textContent = platformer.done ? "Waiting for the other racers…" : "";
  startTimer(payload.deadline, "platformer-timer"); showScreen("platformer");
  let previous = performance.now();
  const frame = (now) => {
    const dt = Math.min(.033, (now-previous)/1000); previous = now;
    if (!platformer.done) stepPlatformer(dt);
    drawPlatformer();
    if (platformer.phase === "race") platformer.raf = requestAnimationFrame(frame);
  };
  cancelAnimationFrame(platformer.raf); platformer.raf = requestAnimationFrame(frame);
}

function platformerSolid(type) {
  return ["solid","bouncy","ice","crumble","conveyor"].includes(type);
}

function platformerTileAt(tiles,key,p) {
  return p?.brokenTiles?.has(key) ? null : tiles[key];
}

function platformerSpikeHit(p, tiles, s) {
  // A close-fitting body box tested against the visible triangular blade.
  const x0 = p.x + 2, x1 = p.x + p.w - 2;
  const y0 = p.y + 2, y1 = p.y + p.h;
  const c0 = Math.floor(x0/s), c1 = Math.floor((x1-.01)/s);
  const r0 = Math.floor(y0/s), r1 = Math.floor((y1-.01)/s);
  for (let r=r0;r<=r1;r++) for (let c=c0;c<=c1;c++) {
    if (platformerTileAt(tiles,`${c},${r}`,p) !== "spike") continue;
    const tileX=c*s, tileY=r*s, overlap0=Math.max(x0,tileX), overlap1=Math.min(x1,tileX+s);
    if (overlap1 <= overlap0 || y0 >= tileY+s || y1 <= tileY+4) continue;
    const centre=tileX+s/2;
    const nearest=Math.max(overlap0,Math.min(centre,overlap1));
    const spikeSurface=tileY+4+Math.abs(nearest-centre)*(s-4)/(s/2);
    if (y1 >= spikeSurface-.5) return true;
  }
  return false;
}

function platformerRoundTrapHit(p,tiles,s) {
  const x0=p.x+2,x1=p.x+p.w-2,y0=p.y+2,y1=p.y+p.h;
  const c0=Math.floor(x0/s),c1=Math.floor((x1-.01)/s),r0=Math.floor(y0/s),r1=Math.floor((y1-.01)/s);
  for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){
    const type=platformerTileAt(tiles,`${c},${r}`,p);
    if(type!=="saw")continue;
    const cx=c*s+s/2,cy=r*s+s/2,nearestX=Math.max(x0,Math.min(cx,x1)),nearestY=Math.max(y0,Math.min(cy,y1));
    if(Math.hypot(nearestX-cx,nearestY-cy)<=s*.43)return true;
  }
  return false;
}

function stepPlatformer(dt) {
  const p = platformer.player, l = platformer.view.level, tiles = l.tiles, s = l.tile;
  const now = performance.now();
  if(p.dying){
    p.vy+=1150*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;
    if(now-platformer.lastPositionSent>35){
      platformer.lastPositionSent=now;
      socket.emit("platformer:position",{x:p.x,y:p.y,vx:p.vx,vy:p.vy});
    }
    if(now-p.deathStarted>1100||p.y>l.rows*s+100)finishPlatformer("dead");
    return;
  }
  for(const [key,breakAt] of p.crumbleTimers){
    if(now>=breakAt){p.brokenTiles.add(key);p.crumbleTimers.delete(key);if(p.surfaceKey===key)p.grounded=false;}
  }
  if (p.grounded) p.coyoteUntil = now + 110;
  if(p.grounded&&p.surfaceType==="conveyor")p.vx+=95*dt;
  p.vx += ((platformer.keys.right ? 1 : 0)-(platformer.keys.left ? 1 : 0))*1050*dt;
  p.vx *= Math.pow(p.grounded&&p.surfaceType==="ice"?.2:.001, dt);
  p.vx = Math.max(-230, Math.min(230, p.vx));
  if (p.jumpQueuedUntil >= now && (p.grounded || p.coyoteUntil >= now)) {
    p.vy = -430; p.grounded = false; p.coyoteUntil = 0; p.jumpQueuedUntil = 0;
  }
  // A supported player stays mathematically planted. Previously gravity moved
  // them down every frame and collision snapped them back up, producing jitter.
  if (!p.grounded) p.vy += 1050*dt;

  // Resolve the horizontal axis independently. The old implementation had no
  // wall collision, allowing a jump into a block's side to enter the block.
  const oldX=p.x;
  p.x += p.vx*dt;
  p.x = Math.max(0, Math.min(l.cols*s-p.w, p.x));
  const bodyTop=Math.floor((p.y+4)/s), bodyBottom=Math.floor((p.y+p.h-4)/s);
  if (p.vx > 0) {
    const col=Math.floor((p.x+p.w-1)/s);
    for (let r=bodyTop;r<=bodyBottom;r++) if (platformerSolid(platformerTileAt(tiles,`${col},${r}`,p))) {
      const wall=col*s;
      if (oldX+p.w <= wall+1 || p.x+p.w > wall) { p.x=wall-p.w; p.vx=0; break; }
    }
  } else if (p.vx < 0) {
    const col=Math.floor(p.x/s);
    for (let r=bodyTop;r<=bodyBottom;r++) if (platformerSolid(platformerTileAt(tiles,`${col},${r}`,p))) {
      const wall=(col+1)*s;
      if (oldX >= wall-1 || p.x < wall) { p.x=wall; p.vx=0; break; }
    }
  }

  const oldY=p.y;
  p.y += p.vy*dt;
  p.grounded = false;
  const left = Math.floor((p.x+5)/s), right = Math.floor((p.x+p.w-5)/s);
  // Include the exact foot boundary. Using `-1` here made a player standing at
  // y=326 alternate between unsupported and snapped-to-326 every other frame.
  const top = Math.floor(p.y/s), bottom = Math.floor((p.y+p.h)/s);
  if (p.vy >= 0) {
    for (let c=left;c<=right;c++) {
      const key=`${c},${bottom}`,type=platformerTileAt(tiles,key,p);
      if (platformerSolid(type) && oldY+p.h <= bottom*s+2) {
        const impact = p.vy;
        p.y = bottom*s-p.h; p.vy = type === "bouncy" ? -620 : 0; p.grounded = type !== "bouncy";
        p.surfaceType=type;p.surfaceKey=key;
        if(type==="crumble"&&!p.crumbleTimers.has(key))p.crumbleTimers.set(key,now+520);
        if (type !== "bouncy" && impact > 180) p.landUntil = performance.now()+130;
        break;
      }
    }
  } else {
    for (let c=left;c<=right;c++) {
      const type = platformerTileAt(tiles,`${c},${top}`,p);
      if (platformerSolid(type) && oldY >= (top+1)*s-2) {
        p.y=(top+1)*s; p.vy=0; break;
      }
    }
  }
  if (platformerSpikeHit(p,tiles,s)||platformerRoundTrapHit(p,tiles,s)) return startPlatformerDeath();
  if (now-platformer.lastPositionSent > 35) {
    platformer.lastPositionSent=now;
    socket.emit("platformer:position",{x:p.x,y:p.y,vx:p.vx,vy:p.vy});
  }
  if (p.x+p.w >= l.goal.x0 && p.y+p.h <= l.goal.y+10) return finishPlatformer("goal");
  if (p.y > l.rows*s+50) finishPlatformer("dead");
}

function startPlatformerDeath() {
  const p=platformer.player;
  if(!p||p.dying||platformer.done)return;
  p.dying=true;p.deathStarted=performance.now();p.grounded=false;
  p.vy=-340;p.vx=(Math.abs(p.vx)>20?Math.sign(p.vx):1)*145;
  p.animState="eliminated";
  $("platformer-controls").classList.add("hidden");
  $("platformer-title").textContent="Ouch!";
  $("platformer-status").textContent="You hit a trap!";
}

function updatePlatformerPositions(players) {
  if (!Array.isArray(players)) return;
  const next=new Map();
  players.forEach((p)=>{
    if (p.playerId === state.selfId) return;
    const previous=platformer.remotePlayers.get(p.playerId);
    const hasPosition=Number.isFinite(p.x)&&Number.isFinite(p.y);
    next.set(p.playerId,{
      ...p,
      targetX:hasPosition?p.x:previous?.targetX,
      targetY:hasPosition?p.y:previous?.targetY,
      renderX:previous?.renderX ?? (hasPosition?p.x:0),
      renderY:previous?.renderY ?? (hasPosition?p.y:0)
    });
  });
  platformer.remotePlayers=next;
}

function finishPlatformer(outcome) {
  if (platformer.done) return;
  platformer.done = true;
  platformer.player.animState = outcome === "goal" ? "celebrate" : "eliminated";
  $("platformer-controls").classList.add("hidden");
  $("platformer-title").textContent = outcome === "goal" ? "You made it! 🎉" : "You fell!";
  $("platformer-status").textContent = "Waiting for the other racers…";
  socket.emit("platformer:outcome", { outcome, timeMs: performance.now()-platformer.startedAt });
}

function setPlatformerMove(key, down) {
  platformer.keys[key] = down;
  if (key === "jump" && down && platformer.player) {
    // Remember a slightly-early press through the next landing.
    platformer.player.jumpQueuedUntil = performance.now() + 150;
  }
}
window.addEventListener("keydown", (e) => {
  if (platformer.phase !== "race") return;
  if (["ArrowLeft","a","A"].includes(e.key)) setPlatformerMove("left", true);
  if (["ArrowRight","d","D"].includes(e.key)) setPlatformerMove("right", true);
  if ([" ","ArrowUp","w","W"].includes(e.key)) {
    if (!e.repeat) setPlatformerMove("jump", true);
    e.preventDefault();
  }
});
window.addEventListener("keyup", (e) => {
  if (["ArrowLeft","a","A"].includes(e.key)) setPlatformerMove("left", false);
  if (["ArrowRight","d","D"].includes(e.key)) setPlatformerMove("right", false);
});
document.querySelectorAll("[data-move]").forEach((b) => {
  const key = b.dataset.move;
  const down = (e) => { e.preventDefault(); setPlatformerMove(key, true); };
  const up = (e) => { e.preventDefault(); setPlatformerMove(key, false); };
  b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up);
});

// ===================== SHARED SURVIVAL ARENA =====================
const ARENA_COLORS = ["#ef4444","#3b82f6","#22c55e","#eab308"];
const ARENA_COLOR_NAMES = ["RED","BLUE","GREEN","YELLOW"];
const arena = {
  mode:null, raf:0, player:null, players:new Map(), keys:{}, tiles:new Map(),
  done:false, holderId:null, holderSince:0, safeColor:0, dangerAt:0, lastSent:0,
  renderer:null,bursts:[],lastJumpAt:0,camY:null,tileLayout:[],scrambleUntil:0,colorCycle:-1,
  bombs:[],blasts:[],crates:[],powerups:[],trackId:"square"
};
const RACE_TRACKS={
  square:{name:"Block Circuit",width:92,points:[[130,90],[590,90],[640,140],[640,320],[590,370],[130,370],[80,320],[80,140]],
    checkpoints:[[640,140],[590,370],[80,320],[130,90]]},
  swing:{name:"Wiggly Way",width:82,points:[[110,100],[310,70],[520,105],[630,190],[540,260],[630,350],[390,375],[250,310],[90,350],[120,220],[260,205]],
    checkpoints:[[630,190],[630,350],[250,310],[120,220],[110,100]]}
};
function pointSegmentDistance(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,len=dx*dx+dy*dy;
  const t=len?Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/len)):0;
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}
function raceTrackDistance(track,x,y){
  let best=Infinity;
  for(let i=0;i<track.points.length;i++){const a=track.points[i],b=track.points[(i+1)%track.points.length];best=Math.min(best,pointSegmentDistance(x,y,a[0],a[1],b[0],b[1]));}
  return best;
}
function fireSolid(col,row,mapId=arena.mapId||"classic"){
  if(col<=0||col>=13||row<=0||row>=9)return true;
  if(mapId==="fortress")return (col%3===0&&row%2===0)||(row===4&&col%4===0);
  if(mapId==="switchback")return (row%3===0&&col%2===0)||(col===6&&row%2===0);
  return col%2===0&&row%2===0;
}
function fireBlocked(x,y,radius=14){
  const minCol=Math.floor((x-radius-35)/50),maxCol=Math.floor((x+radius-35)/50);
  const minRow=Math.floor((y-radius-20)/45),maxRow=Math.floor((y+radius-20)/45);
  for(let row=minRow;row<=maxRow;row++)for(let col=minCol;col<=maxCol;col++){
    const key=`${col}:${row}`,solid=fireSolid(col,row);
    if(!solid&&!arena.crates.includes(key))continue;
    const left=35+col*50,right=left+48,top=20+row*45,bottom=top+43;
    if(x+radius>left&&x-radius<right&&y+radius>top&&y-radius<bottom)return true;
  }
  return false;
}

// Vanishing platform — MUST match the server (src/gameManager.js PLAT/VANISH_LAYERS).
// Grid dims come from the shared maps module (vanishMaps.js loads first).
const _VG = (window.VanishMaps && VanishMaps.G) || { cols:12, rows:8, x0:72, y0:68, w:576, h:304, layers:5, tw:48, th:38 };
const VANISH = { spacing:250, layers:_VG.layers, cols:_VG.cols, rows:_VG.rows, x0:_VG.x0, y0:_VG.y0, w:_VG.w, h:_VG.h };
VANISH.tw = VANISH.w/VANISH.cols; VANISH.th = VANISH.h/VANISH.rows;
function cellRect(col,row){ return { x: VANISH.x0+col*VANISH.tw, y: VANISH.y0+row*VANISH.th }; }
function applyArenaStart(payload) {
  state.mode = payload.mode; state.deadline = payload.deadline;
  arena.mode = payload.mode; arena.done = false; arena.safeColor = payload.safeColor || 0;
  arena.tileLayout=payload.tileLayout||[];arena.dangerAt=payload.dangerAt||0;
  arena.scrambleUntil=payload.scrambleUntil||0;arena.colorCycle=payload.cycle??-1;
  arena.holderId = payload.holderId; arena.holderSince = performance.now();
  arena.mapId=payload.mapId||null;
  arena.trackId=payload.trackId||"square";
  arena.startedAt=payload.startedAt||Date.now();arena.obstacles=payload.obstacles||[];
  arena.runnerCoins=payload.runnerCoins||[];arena.runnerPlatforms=payload.runnerPlatforms||[];
  arena.runnerTheme=payload.runnerTheme||"moonwood";arena.runnerSeed=payload.runnerSeed||0;
  arena.painterCols=payload.painterCols||18;arena.painterRows=payload.painterRows||11;
  arena.painterTerritory=payload.painterTerritory||{};arena.painterTrails=payload.painterTrails||{};arena.painterFlash=null;
  arena.painterBuckets=payload.painterBuckets||[];
  arena.balls=payload.balls||[];arena.pongSides=payload.pongSides||4;arena.playerSides=payload.playerSides||{};arena.lives=payload.lives||{};
  arena.pongLifeEffects=[];
  arena.bombs=payload.bombs||[];arena.blasts=payload.blasts||[];arena.crates=payload.crates||[];arena.powerups=payload.powerups||[];
  arena.tiles = new Map((payload.tiles || []).map((t) => [t.key,t]));
  arena.localTileTimes = new Map();
  arena.bursts=[];
  arena.runnerAnimTime=0;arena.runnerFlash=null;
  arena.players = new Map(); // fresh each round — drop stale eliminated/visual flags
  updateArenaPlayers(payload.players || []);
  const me = arena.players.get(state.selfId);
  arena.player = { x:me?.x ?? 360, y:me?.y ?? 220, vx:0, vy:me?.vy||0, layer:me?.layer||0,
    visualLayer:me?.layer||0,angle:me?.angle||0,speed:0,lap:me?.lap||0,checkpoint:me?.checkpoint||0,
    upgrades:me?.upgrades||{range:2,bombs:1,speed:0},paddleT:me?.paddleT??.5,
    distance:me?.distance||0,serverDistance:me?.distance||0,coins:me?.coins||0,perfects:me?.perfects||0,
    collectedCoins:me?.collectedCoins||[],boostUntil:me?.boostUntil||0,painterSpeedUntil:me?.painterSpeedUntil||0,painterStunnedUntil:me?.painterStunnedUntil||0 };
  arena.camY = (me?.layer||0) * VANISH.spacing; // camera starts on the player's floor
  arena.fallFlash = null;
  arena.vmap = (window.VanishMaps ? VanishMaps.mapById(payload.mapId) : null);
  arena.vanishTheme = VANISH_THEMES.find((t)=>t.id===(arena.vmap?arena.vmap.theme:"void")) || VANISH_THEMES[0];
  arena.done = !!me?.eliminated;
  $("arena-round").textContent = legPrefix() + `Round ${payload.roundNumber} of ${payload.totalRounds}`;
  const names = {colorfloor:"Color Twister",vanish:"Vanishing Grid — "+(arena.vmap?arena.vmap.name:arena.vanishTheme.name),
    bombpass:"Bomb Pass",fire:"Playing with Fire",racing:"Pocket Racers",flappy:"Dragon Rider",runner:"Wild Run",painter:"Territory Painter",pong:"Polygon Pong"};
  const hints = {
    colorfloor:"RUN TO THE COLOR ON THE BIG SIGN. Every other tile becomes lava!",
    vanish:"Keep moving. A tile disappears shortly after anyone steps on it.",
    bombpass:"Touch another player to pass the bomb. The fuse timer is hidden!",
    fire:"Move through the maze. Press BOMB to blast crates and rivals!",
    racing:"UP accelerates, DOWN brakes, LEFT/RIGHT steer. Complete 3 laps!",
    flappy:"Tap FLAP or press SPACE to guide your dragon between the pointy rocks. Furthest wins!",
    runner:"Your character runs automatically. Press JUMP or SPACE to clear the wilderness hazards!",
    painter:"RUN ACROSS TILES TO PAINT THEM. You can repaint rival territory—largest area wins!",
    pong:"Move LEFT and RIGHT to defend your side. Miss three balls and you’re out!"
  };
  $("arena-title").textContent = names[payload.mode];
  $("arena-hint").textContent = hints[payload.mode];
  $("arena-sign").classList.toggle("color-call",payload.mode==="colorfloor");
  $("arena-sign").textContent = payload.mode === "bombpass" ? "HIDDEN FUSE" :
    (payload.mode === "vanish" ? "DON’T STOP!" : payload.mode==="fire" ? "BOMB ARENA" :
      payload.mode==="racing" ? "3 LAPS" : payload.mode==="flappy" ? "FLY THE CANYON" : payload.mode==="runner" ? "RUN WILD!" : payload.mode==="painter" ? "PAINT EVERYTHING!" : payload.mode==="pong" ? "♥ ♥ ♥" : "WATCH THE SIGN");
  $("arena-jump").textContent=payload.mode==="fire"?"BOMB":payload.mode==="racing"?"HORN":payload.mode==="flappy"?"FLAP":"JUMP";
  document.querySelectorAll("[data-arena]").forEach((button)=>{
    const hide=payload.mode==="flappy"||(payload.mode==="runner"&&button.dataset.arena!=="down")||(payload.mode==="pong"&&!["left","right"].includes(button.dataset.arena));
    button.classList.toggle("hidden",hide);
    if(button.dataset.arena==="down")button.textContent=payload.mode==="runner"?"ROLL":"▼";
  });
  $("arena-jump").classList.toggle("hidden",["pong","painter"].includes(payload.mode));
  $("arena-painter-legend").classList.toggle("hidden",payload.mode!=="painter");
  if(payload.mode==="painter")updatePainterLegend();
  $("arena-status").textContent = arena.holderId === state.selfId ? "You have the bomb—tag someone!" : "";
  $("arena-timer").classList.toggle("hidden",["flappy","runner"].includes(payload.mode));
  startTimer(payload.deadline,"arena-timer"); showScreen("arena");
  let previous=performance.now();
  const frame=(now)=>{
    const dt=Math.min(.035,(now-previous)/1000);previous=now;
    stepArena(dt,now);drawArena(now);
    if(currentScreen==="arena") arena.raf=requestAnimationFrame(frame);
  };
  cancelAnimationFrame(arena.raf);arena.raf=requestAnimationFrame(frame);
}
function updateArenaPlayers(players) {
  for (const p of players || []) {
    if (p.playerId === state.selfId) {
      if (arena.player && p.eliminated) arena.done = true;
      if (arena.player && Number.isInteger(p.layer)) arena.player.layer=p.layer;
      if (arena.player && Number.isFinite(p.lap)) arena.player.lap=p.lap;
      if (arena.player && Number.isFinite(p.checkpoint)) arena.player.checkpoint=p.checkpoint;
      if (arena.player && p.upgrades) arena.player.upgrades=p.upgrades;
      if (arena.mode==="racing"&&arena.player&&!arena.player.crashVisual&&Number.isFinite(p.x)&&Math.hypot(p.x-arena.player.x,p.y-arena.player.y)>6){
        arena.player.x+=(p.x-arena.player.x)*.45;arena.player.y+=(p.y-arena.player.y)*.45;
      }
      if(["flappy","runner"].includes(arena.mode)&&arena.player&&Number.isFinite(p.y)){
        arena.player.y+=(p.y-arena.player.y)*.22;
        if(arena.mode==="flappy")arena.player.distance=p.distance||arena.player.distance||0;
        if(arena.mode==="runner"){
          arena.player.serverDistance=p.distance||0;arena.player.coins=p.coins||0;arena.player.perfects=p.perfects||0;
          arena.player.collectedCoins=p.collectedCoins||arena.player.collectedCoins||[];arena.player.boostUntil=p.boostUntil||0;
          // Snap only after a genuinely large discrepancy; ordinary packets are
          // blended in stepArena so scrolling never stutters at network cadence.
          if(Math.abs((arena.player.distance||0)-arena.player.serverDistance)>95)arena.player.distance=arena.player.serverDistance;
        }
      }
      if(arena.mode==="pong"&&arena.player&&Number.isFinite(p.paddleT))arena.player.serverPaddleT=p.paddleT;
      if(arena.mode==="painter"&&arena.player)arena.player.painterSpeedUntil=p.painterSpeedUntil||0;
      if(arena.mode==="painter"&&arena.player)arena.player.painterStunnedUntil=p.painterStunnedUntil||0;
    } else {
      const old=arena.players.get(p.playerId);
      arena.players.set(p.playerId,old?{...old,...p,tx:p.x,ty:p.y,x:old.x,y:old.y}:{...p,tx:p.x,ty:p.y});
    }
  }
  const own=(players||[]).find((p)=>p.playerId===state.selfId);
  if(own) arena.players.set(state.selfId,own);
}
function stepArena(dt,now) {
  for(const [id,p] of arena.players){
    if(id===state.selfId||!Number.isFinite(p.tx))continue;
    const blend=1-Math.pow(.001,dt);
    const beforeX=p.x,beforeY=p.y;
    p.x+=(p.tx-p.x)*blend;p.y+=(p.ty-p.y)*blend;
    p.renderVx=(p.x-beforeX)/Math.max(.001,dt);
    p.renderVy=(p.y-beforeY)/Math.max(.001,dt);
    checkVisualColorDanger(id,p,now);
  }
  if(!arena.player||arena.done) return;
  const p=arena.player;
  if(arena.mode==="painter"&&Date.now()<(p.painterStunnedUntil||0)){
    p.vx=0;p.vy=0;return;
  }
  if(arena.mode==="pong"){
    const direction=(arena.keys.right?1:0)-(arena.keys.left?1:0);
    p.paddleT=Math.max(0,Math.min(1,(p.paddleT??.5)+direction*dt*1.45));
    if(now-arena.lastSent>45){arena.lastSent=now;socket.emit("arena:position",{x:p.paddleT,y:0});}
    return;
  }
  if(arena.mode==="flappy"){
    p.vy=(p.vy||0)+620*dt;p.y+=p.vy*dt;
    p.y=Math.max(8,Math.min(432,p.y));
    return;
  }
  if(arena.mode==="runner"){
    p.rolling=!!arena.keys.down;
    const elapsed=Date.now()-(arena.startedAt||Date.now());
    const visualPace=Math.min(.29,.145+elapsed/420000+(p.coins||0)*.0025+(Date.now()<(p.boostUntil||0)?.025:0));
    p.distance=(p.distance||0)+visualPace*dt*1000;
    if(Number.isFinite(p.serverDistance))p.distance+=(p.serverDistance-p.distance)*Math.min(1,dt*2.8);
    p.visualPace=visualPace;
    arena.runnerAnimTime=(arena.runnerAnimTime||0)+dt*(visualPace/.145);
    p.vy=(p.vy||0)+980*dt;p.y+=p.vy*dt;
    let floor=326;
    for(const platform of arena.runnerPlatforms||[]){
      const sx=platform.x-(p.distance||0);
      if(sx>95-platform.w/2&&sx<175+platform.w/2&&p.vy>=0&&p.y<=platform.y+16)floor=Math.min(floor,platform.y);
    }
    p.groundY=floor;
    if(p.y>=floor){p.y=floor;p.vy=0;}
    if(now-arena.lastSent>70){arena.lastSent=now;socket.emit("arena:position",{x:0,y:0,roll:p.rolling});}
    return;
  }
  if(arena.mode==="racing"){
    const track=RACE_TRACKS[arena.trackId]||RACE_TRACKS.square;
    if(p.crashVisual){
      const age=now-p.crashVisual.started;
      if(age<700)return;
      p.x=p.crashVisual.respawn.x;p.y=p.crashVisual.respawn.y;p.angle=p.crashVisual.respawn.angle;p.speed=0;
      if(age<1550)return;
      p.crashVisual=null;$("arena-status").textContent="Back on track!";
    }
    const steer=((arena.keys.right?1:0)-(arena.keys.left?1:0));
    const throttle=(arena.keys.up?1:0)-(arena.keys.down?1:0);
    p.speed+=(throttle*250-p.speed*.9)*dt;
    p.speed=Math.max(-90,Math.min(255,p.speed));
    if(Math.abs(p.speed)>8)p.angle+=steer*2.5*dt*(p.speed>=0?1:-1);
    p.x+=Math.cos(p.angle)*p.speed*dt;p.y+=Math.sin(p.angle)*p.speed*dt;
    p.x+=(p.impactVx||0)*dt;p.y+=(p.impactVy||0)*dt;
    const impactDecay=Math.exp(-dt*5.2);
    p.impactVx=(p.impactVx||0)*impactDecay;p.impactVy=(p.impactVy||0)*impactDecay;
    // Resolve visible contact immediately instead of waiting for a round trip
    // to the server. The server still sends the authoritative shared impulse.
    for(const [id,other] of arena.players){
      if(id===state.selfId||other.eliminated||other.finished)continue;
      let dx=p.x-other.x,dy=p.y-other.y,dist=Math.hypot(dx,dy);
      if(dist>=42)continue;
      if(dist<.001){dx=Math.cos(p.angle);dy=Math.sin(p.angle);dist=1;}
      const nx=dx/dist,ny=dy/dist,overlap=42-dist;
      p.x+=nx*overlap*.58;p.y+=ny*overlap*.58;
      other.x-=nx*overlap*.42;other.y-=ny*overlap*.42;
      const rvx=Math.cos(p.angle)*p.speed-(other.renderVx||other.vx||0);
      const rvy=Math.sin(p.angle)*p.speed-(other.renderVy||other.vy||0);
      const closing=Math.max(0,-(rvx*nx+rvy*ny));
      if(now>(p.localRaceBumpUntil||0)){
        const kick=Math.min(150,35+closing*.55);
        p.impactVx=(p.impactVx||0)+nx*kick;p.impactVy=(p.impactVy||0)+ny*kick;
        p.speed*=.88;p.localRaceBumpUntil=now+180;
      }
    }
    const edgeDistance=raceTrackDistance(track,p.x,p.y);
    const roadLimit=track.width/2-3;
    if(edgeDistance>roadLimit){
      // Sharp inner corners and car impacts can put the centre just beyond the
      // road test for a frame while much of the car is still visibly on it.
      // Give steering a brief recovery window and scrub speed like a tyre skid.
      p.offTrackSince??=now;
      p.speed*=Math.exp(-dt*2.8);
      p.impactVx=(p.impactVx||0)*Math.exp(-dt*4);
      p.impactVy=(p.impactVy||0)*Math.exp(-dt*4);
      if(now-p.offTrackSince>260){
        p.crashVisual={started:now,from:{x:p.x,y:p.y},respawn:{x:p.x,y:p.y,angle:p.angle},pending:true};
        p.offTrackSince=null;p.speed=0;socket.emit("arena:crash");return;
      }
    }else{
      p.offTrackSince=null;
    }
    p.vx=Math.cos(p.angle)*p.speed;p.vy=Math.sin(p.angle)*p.speed;
    if(now-arena.lastSent>45){arena.lastSent=now;socket.emit("arena:position",{x:p.x,y:p.y,angle:p.angle});}
    return;
  }
  // Snappy, precise control: ease velocity toward the target and stop quickly.
  const max=arena.mode==="fire"?275+(p.upgrades?.speed||0)*28:
    (arena.mode==="painter"&&Date.now()<(p.painterSpeedUntil||0)?410:275);
  const tvx=((arena.keys.right?1:0)-(arena.keys.left?1:0))*max;
  const tvy=((arena.keys.down?1:0)-(arena.keys.up?1:0))*max;
  const k=Math.min(1,dt*16);
  p.vx+=(tvx-p.vx)*k;p.vy+=(tvy-p.vy)*k;
  const speed=Math.hypot(p.vx,p.vy);
  if(speed>max){p.vx*=max/speed;p.vy*=max/speed;}
  const oldPX=p.x,oldPY=p.y;
  p.x=Math.max(14,Math.min(706,p.x+p.vx*dt));
  p.y=Math.max(14,Math.min(426,p.y+p.vy*dt));
  if(arena.mode==="fire"){
    const nextX=p.x,nextY=p.y;
    p.x=fireBlocked(nextX,oldPY)?oldPX:nextX;
    p.y=fireBlocked(p.x,nextY)?oldPY:nextY;
    if(p.x===oldPX)p.vx*=.18;if(p.y===oldPY)p.vy*=.18;
  }
  checkVisualColorDanger(state.selfId,p,now);
  if(Date.now()>=(p.jumpingUntil||0)){
    for(const [id,other] of arena.players){
      if(id===state.selfId||other.eliminated||Date.now()<(other.jumpingUntil||0))continue;
      if(arena.mode==="vanish"&&(other.layer||0)!==(arena.player.layer||0))continue; // only bump on the same floor
      const dx=p.x-other.x,dy=p.y-other.y,dist=Math.hypot(dx,dy),minimum=36;
      if(dist>0&&dist<minimum){
        const ownSpeed=Math.hypot(p.vx,p.vy),otherSpeed=Math.hypot(other.renderVx||other.vx||0,other.renderVy||other.vy||0);
        const ownMomentum=(ownSpeed+45)/(ownSpeed+otherSpeed+90);
        const overlap=minimum-dist,nx=dx/dist,ny=dy/dist;
        p.x+=nx*overlap*(1-ownMomentum);p.y+=ny*overlap*(1-ownMomentum);
        p.vx+=nx*overlap*7*(1-ownMomentum);p.vy+=ny*overlap*7*(1-ownMomentum);
        if(arena.mode==="colorfloor"||arena.mode==="vanish"){
          other.x-=nx*overlap*ownMomentum;other.y-=ny*overlap*ownMomentum;
          if(ownSpeed>150&&now>=(other.bumpUntil||0))other.bumpUntil=now+260;
        }
      }
    }
  }
  // Smooth "visual layer" so a fall to the next floor reads as a slow descent.
  for(const q of [arena.player,...arena.players.values()]){
    if(!q)continue;
    if(q.visualLayer==null)q.visualLayer=q.layer||0;
    q.visualLayer+=((q.layer||0)-q.visualLayer)*Math.min(1,dt*5.5);
  }
  if(now-arena.lastSent>45){
    arena.lastSent=now;socket.emit("arena:position",{x:p.x,y:p.y});
  }
}
function checkVisualColorDanger(playerId,p,now){
  if(arena.mode!=="colorfloor"||!arena.dangerAt||Date.now()<arena.dangerAt||Date.now()<arena.scrambleUntil||
     Date.now()<(p.jumpingUntil||0)||p.visualEliminatedAt)return;
  const col=Math.max(0,Math.min(5,Math.floor(p.x/120)));
  const row=Math.max(0,Math.min(3,Math.floor(p.y/110)));
  if(arena.tileLayout[row*6+col]===arena.safeColor)return;
  p.visualEliminatedAt=now;
  p.eliminationDirection=p.x<360?-1:1;
  const listed=arena.players.get(playerId);if(listed)listed.visualEliminatedAt=now;
  if(listed)listed.eliminationDirection=p.eliminationDirection;
  arena.bursts.push({x:p.x,y:p.y,born:now,color:"#fff36b",count:20});
  const canvas=$("arena-canvas");canvas.classList.remove("shake");void canvas.offsetWidth;canvas.classList.add("shake");
}
// ---- Vanishing Grid "maps" — cosmetic themes; grid + rules stay identical -----
const VANISH_THEMES=[
  { id:"void", name:"Deep Void",
    bg:{top:"#0b1636",mid:"#0e2148",bot:"#050a1c",chevron:"120,170,235",streak:"150,200,255",wall:"3,7,20"},
    floors:["#5a86ad","#4a7599","#3d6382","#33556f"],
    side:"#22384f",sideR:"#193049",stroke:"rgba(186,230,253,.42)",thickness:16,gap:3,checker:.05,deco:"none" },
  { id:"lava", name:"Molten Core",
    bg:{top:"#2a0f12",mid:"#4a1712",bot:"#0a0405",chevron:"255,140,60",streak:"255,180,90",wall:"22,5,4"},
    floors:["#6a5346","#59463a","#4a3a30","#3c2f28"],
    side:"#2a1712",sideR:"#180c08",stroke:"rgba(255,150,80,.5)",thickness:19,gap:2,checker:.08,deco:"cracks",accent:"#ff6a2a" },
  { id:"ice", name:"Glacier",
    bg:{top:"#123049",mid:"#1e5074",bot:"#08131f",chevron:"180,225,255",streak:"225,242,255",wall:"8,18,30"},
    floors:["#9ccbe8","#83b6d6","#6c9fc0","#5788a6"],
    side:"#345a75",sideR:"#20384a",stroke:"rgba(240,252,255,.68)",thickness:12,gap:5,checker:.06,deco:"frost" },
  { id:"neon", name:"Neon Grid",
    bg:{top:"#0a0a20",mid:"#151140",bot:"#030310",chevron:"255,80,220",streak:"120,255,240",wall:"6,4,18"},
    floors:["#3d2c64","#352763","#2d2158","#251b4c"],
    side:"#1c1236",sideR:"#0f0824",stroke:"rgba(120,255,240,.72)",thickness:16,gap:3,checker:.09,deco:"grid",accent:"#ff4fdc" },
  { id:"jungle", name:"Lost Temple",
    bg:{top:"#132612",mid:"#1e3d1a",bot:"#070f06",chevron:"150,220,120",streak:"205,240,175",wall:"6,14,4"},
    floors:["#75904d","#647d40","#546b36","#45592d"],
    side:"#28371a",sideR:"#18240e",stroke:"rgba(215,242,175,.5)",thickness:15,gap:4,checker:.07,deco:"moss" }
];
function vTint(hex,d){ // d>0 lighten toward white, d<0 darken toward black
  const n=parseInt(hex.slice(1),16),R=n>>16&255,G=n>>8&255,B=n&255,t=d<0?0:255,a=Math.abs(d);
  return `rgb(${Math.round(R+(t-R)*a)},${Math.round(G+(t-G)*a)},${Math.round(B+(t-B)*a)})`;
}
function pickVanishTheme(seed){ return VANISH_THEMES[Math.abs(Math.floor((seed||0)/997))%VANISH_THEMES.length]; }
/** Small per-tile decoration to give each map its own texture (current floor only). */
function drawTileDeco(ctx,top,theme,now){
  const cx=(top[0].x+top[2].x)/2, cy=(top[0].y+top[2].y)/2, s=Math.max(3,Math.abs(top[1].x-top[0].x)*.2);
  ctx.save();
  if(theme.deco==="cracks"){ctx.strokeStyle="rgba(255,120,40,.35)";ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(cx-s,cy-s*.3);ctx.lineTo(cx,cy);ctx.lineTo(cx+s*.6,cy-s*.9);ctx.stroke();}
  else if(theme.deco==="frost"){ctx.strokeStyle="rgba(255,255,255,.45)";ctx.lineWidth=1.2;for(let a=0;a<3;a++){const g=a*Math.PI/3;ctx.beginPath();ctx.moveTo(cx-Math.cos(g)*s,cy-Math.sin(g)*s*.5);ctx.lineTo(cx+Math.cos(g)*s,cy+Math.sin(g)*s*.5);ctx.stroke();}}
  else if(theme.deco==="grid"){ctx.fillStyle=theme.accent||"#7ff";ctx.globalAlpha=.55;ctx.beginPath();ctx.arc(cx,cy,2.2,0,7);ctx.fill();}
  else if(theme.deco==="moss"){ctx.fillStyle="rgba(185,222,120,.4)";for(let i=0;i<3;i++){ctx.beginPath();ctx.arc(cx-s*.35+i*s*.35,cy+(i%2?-2:2),1.5,0,7);ctx.fill();}}
  ctx.restore();
}
/** Draw one extruded tile of a given shape (square|diamond|hex|circle) at world
 *  (cx,cy) with half-extents (hw,hh) and a lift. Returns the projected top poly. */
function drawShapeTile(r,cx,cy,hw,hh,shape,lift,o){
  const ctx=r.ctx; let pts;
  if(shape==="diamond") pts=[[0,-hh],[hw,0],[0,hh],[-hw,0]];
  else if(shape==="hex") pts=[[-hw,-hh*.55],[0,-hh],[hw,-hh*.55],[hw,hh*.55],[0,hh],[-hw,hh*.55]];
  else if(shape==="circle"){ pts=[]; const N=14; for(let i=0;i<N;i++){const a=i/N*Math.PI*2-Math.PI/2;pts.push([Math.cos(a)*hw,Math.sin(a)*hh]);} }
  else pts=[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
  const proj=pts.map(([dx,dy])=>r.project(cx+dx,cy+dy,lift));
  const cen=r.project(cx,cy,lift), th=o.thickness??14;
  ctx.fillStyle=o.side||"#1b273d";
  for(let i=0;i<proj.length;i++){
    const p1=proj[i], p2=proj[(i+1)%proj.length];
    if((p1.y+p2.y)/2>cen.y-0.5){
      ctx.beginPath();ctx.moveTo(p1.x,p1.y);ctx.lineTo(p2.x,p2.y);ctx.lineTo(p2.x,p2.y+th);ctx.lineTo(p1.x,p1.y+th);ctx.closePath();ctx.fill();
    }
  }
  ctx.fillStyle=o.fill||"#4b6b8b";
  ctx.beginPath();proj.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();
  if(o.stroke){ctx.strokeStyle=o.stroke;ctx.lineWidth=o.lineWidth||1.5;ctx.beginPath();proj.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.stroke();}
  return proj;
}
/** Scrolling "deep pit" background — scrolls with the camera so descending reads
 *  as genuinely falling. Coloured per map theme. */
function drawVanishBackdrop(ctx,camY,now,theme){
  const W=720,H=440,b=(theme||VANISH_THEMES[0]).bg;
  const g=ctx.createLinearGradient(0,0,0,H);
  g.addColorStop(0,b.top);g.addColorStop(.55,b.mid);g.addColorStop(1,b.bot);
  ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
  const period=64, off=((camY%period)+period)%period;
  ctx.lineWidth=2;
  for(let k=-1;k<Math.ceil(H/period)+2;k++){
    const y=k*period+(period-off);
    const a=.16*(1-Math.abs(y-H*.5)/(H*.62));
    if(a<=0)continue;
    ctx.strokeStyle=`rgba(${b.chevron},${a})`;
    ctx.beginPath();ctx.moveTo(60,y-7);ctx.lineTo(360,y+7);ctx.lineTo(660,y-7);ctx.stroke();
  }
  const lv=ctx.createLinearGradient(0,0,150,0);lv.addColorStop(0,`rgba(${b.wall},.7)`);lv.addColorStop(1,`rgba(${b.wall},0)`);
  ctx.fillStyle=lv;ctx.fillRect(0,0,150,H);
  const rv=ctx.createLinearGradient(W,0,W-150,0);rv.addColorStop(0,`rgba(${b.wall},.7)`);rv.addColorStop(1,`rgba(${b.wall},0)`);
  ctx.fillStyle=rv;ctx.fillRect(W-150,0,150,H);
  ctx.strokeStyle=`rgba(${b.streak},.12)`;ctx.lineWidth=2;
  for(let i=0;i<12;i++){
    const x=(i*61+29)%W, y=H-(((camY*1.6+i*120)%(H+50)));
    ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x,y+20);ctx.stroke();
  }
}
function drawFireArena(now){
  const c=$("arena-canvas"),ctx=c.getContext("2d");ctx.clearRect(0,0,720,440);
  const bg=ctx.createLinearGradient(0,0,0,440);bg.addColorStop(0,"#172554");bg.addColorStop(1,"#0f172a");
  ctx.fillStyle=bg;ctx.fillRect(0,0,720,440);
  for(let row=0;row<9;row++)for(let col=0;col<13;col++){
    const x=35+col*50,y=20+row*45,key=`${col}:${row}`;
    const solid=fireSolid(col,row);
    ctx.fillStyle=solid?"#263548":"#172235";
    ctx.fillRect(x,y,48,43);
    if(solid){
      ctx.strokeStyle="#64748b";ctx.lineWidth=2;ctx.strokeRect(x+2,y+2,44,39);
      ctx.fillStyle="rgba(148,163,184,.16)";ctx.fillRect(x+5,y+5,38,5);
    }
    if(arena.crates.includes(key)){
      const bx=x+7,by=y+6,bw=34,bh=31;
      ctx.fillStyle="#9a4d13";ctx.fillRect(bx,by,bw,bh);
      ctx.strokeStyle="#f59e0b";ctx.lineWidth=2;ctx.strokeRect(bx,by,bw,bh);
      ctx.strokeStyle="#71320d";ctx.lineWidth=4;
      ctx.beginPath();ctx.moveTo(bx+4,by+4);ctx.lineTo(bx+bw-4,by+bh-4);
      ctx.moveTo(bx+bw-4,by+4);ctx.lineTo(bx+4,by+bh-4);ctx.stroke();
      ctx.fillStyle="#fbbf24";ctx.fillRect(bx+14,by+13,6,5);
    }
  }
  const powerIcons={range:"🔥",bombs:"💣",speed:"⚡"};
  for(const item of arena.powerups){const [col,row]=item.key.split(":").map(Number),x=35+col*50+24,y=20+row*45+24;
    ctx.fillStyle="rgba(255,255,255,.9)";ctx.beginPath();ctx.arc(x,y,15+Math.sin(now/120)*2,0,Math.PI*2);ctx.fill();
    ctx.font="20px system-ui";ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(powerIcons[item.type]||"⭐",x,y);
  }
  for(const bomb of arena.bombs){const x=35+bomb.col*50+24,y=20+bomb.row*45+22,pulse=1+Math.sin(now/90)*.12;
    ctx.fillStyle="#050505";ctx.beginPath();ctx.arc(x,y,13*pulse,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fb923c";ctx.fillRect(x+8,y-17,4,9);}
  for(const blast of arena.blasts)for(const key of blast.cells){const [col,row]=key.split(":").map(Number),x=35+col*50,y=20+row*45;
    ctx.fillStyle=`rgba(255,${120+Math.floor(Math.random()*90)},20,.85)`;ctx.fillRect(x+2,y+2,44,39);}
  const entries=[...arena.players.entries()];
  for(const[id,remote]of entries){const p=id===state.selfId?arena.player:remote;if(!p)continue;const info=state.room?.players?.find(q=>q.id===id);
    if(remote.eliminated||p.visualEliminatedAt)continue;
    PaperCharacter.draw(ctx,{x:p.x,y:p.y,size:36,avatar:info?.avatar||remote.avatar,state:Math.hypot(p.vx||0,p.vy||0)>15?"run":"idle",direction:(p.vx||0)<0?-1:1,time:now});
    ctx.fillStyle="#fff";ctx.font="bold 11px sans-serif";ctx.textAlign="center";ctx.fillText(id===state.selfId?"You":remote.name,p.x,p.y-28);
  }
  const up=arena.player?.upgrades||{range:2,bombs:1,speed:0};
  ctx.textBaseline="alphabetic";ctx.fillStyle="rgba(8,15,30,.86)";ctx.fillRect(12,9,205,30);
  ctx.fillStyle="#fff";ctx.font="bold 13px sans-serif";ctx.textAlign="left";
  ctx.fillText(`🔥 ${up.range}   💣 ${up.bombs}   ⚡ ${up.speed}`,24,29);
}
function drawRaceArena(now){
  const c=$("arena-canvas"),ctx=c.getContext("2d");ctx.clearRect(0,0,720,440);
  const track=RACE_TRACKS[arena.trackId]||RACE_TRACKS.square;
  const voidBg=ctx.createRadialGradient(360,190,60,360,220,430);
  voidBg.addColorStop(0,"#172554");voidBg.addColorStop(1,"#020617");ctx.fillStyle=voidBg;ctx.fillRect(0,0,720,440);
  const trace=()=>{ctx.beginPath();ctx.moveTo(track.points[0][0],track.points[0][1]);for(let i=1;i<track.points.length;i++)ctx.lineTo(track.points[i][0],track.points[i][1]);ctx.closePath();};
  ctx.lineJoin="round";ctx.lineCap="round";
  ctx.save();ctx.translate(0,11);trace();ctx.strokeStyle="rgba(0,0,0,.72)";ctx.lineWidth=track.width+18;ctx.stroke();ctx.restore();
  trace();ctx.strokeStyle="#d1d5db";ctx.lineWidth=track.width+10;ctx.stroke();
  trace();ctx.strokeStyle="#374151";ctx.lineWidth=track.width;ctx.stroke();
  trace();ctx.setLineDash([16,14]);ctx.strokeStyle="rgba(255,255,255,.65)";ctx.lineWidth=3;ctx.stroke();ctx.setLineDash([]);
  const start=track.checkpoints.at(-1);for(let i=0;i<8;i++){ctx.fillStyle=i%2?"#fff":"#111";ctx.fillRect(start[0]-32+i*8,start[1]-18,8,36);}
  // Finish flags stay visible; the first finisher launches a brief celebration.
  for(const side of [-1,1]){
    const fx=start[0]+side*39,fy=start[1]-28;
    ctx.strokeStyle="#e2e8f0";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(fx,fy);ctx.lineTo(fx,fy+56);ctx.stroke();
    for(let row=0;row<3;row++)for(let col=0;col<3;col++){
      ctx.fillStyle=(row+col)%2?"#fff":"#111827";
      ctx.fillRect(fx+side*(col*6),fy+row*6,side*6,6);
    }
  }
  if(arena.raceCelebration){
    const age=now-arena.raceCelebration.started;
    if(age<2400){
      const colors=["#facc15","#fb7185","#60a5fa","#4ade80","#f8fafc"];
      for(let burst=0;burst<5;burst++){
        const born=burst*260,progress=(age-born)/1250;if(progress<0||progress>1)continue;
        const cx=85+burst*138,cy=78+(burst%2)*55;
        for(let i=0;i<18;i++){
          const angle=i*Math.PI*2/18+burst*.7,distance=progress*(42+burst%3*9);
          ctx.globalAlpha=1-progress;ctx.fillStyle=colors[(i+burst)%colors.length];
          ctx.beginPath();ctx.arc(cx+Math.cos(angle)*distance,cy+Math.sin(angle)*distance+progress*progress*26,2.6,0,Math.PI*2);ctx.fill();
        }
      }
      ctx.globalAlpha=Math.min(1,(2400-age)/350);ctx.fillStyle="rgba(15,23,42,.82)";ctx.fillRect(260,16,200,34);
      ctx.fillStyle="#fef08a";ctx.font="900 17px sans-serif";ctx.textAlign="center";ctx.fillText("🏁 FIRST CAR FINISHED! 🏁",360,39);
      ctx.globalAlpha=1;
    }else arena.raceCelebration=null;
  }
  ctx.fillStyle="rgba(0,0,0,.6)";ctx.fillRect(12,12,155,28);ctx.fillStyle="#fff";ctx.font="bold 15px sans-serif";ctx.textAlign="left";ctx.fillText(track.name,23,31);
  for(const[id,remote]of arena.players){const p=id===state.selfId?arena.player:remote;if(!p)continue;const info=state.room?.players?.find(q=>q.id===id),color=info?.avatar?.color||remote.avatar?.color||"#ef4444";
    let x=p.x,y=p.y,carAngle=p.angle||0,scale=1,alpha=1;
    if(p.crashVisual){
      const age=now-p.crashVisual.started;
      if(age<700){x=p.crashVisual.from.x;y=p.crashVisual.from.y;scale=Math.max(.03,1-age/700);carAngle+=age*.012;}
      else{x=p.crashVisual.respawn.x;y=p.crashVisual.respawn.y;carAngle=p.crashVisual.respawn.angle;alpha=Math.floor((age-700)/105)%2?.22:1;}
      if(age>=1550)p.crashVisual=null;
    }
    ctx.save();ctx.globalAlpha=alpha;ctx.translate(x,y);ctx.rotate(carAngle);ctx.scale(scale,scale);
    // Soft shadow and four visible tyres give the car a planted toy-racer look.
    ctx.fillStyle="rgba(0,0,0,.38)";ctx.beginPath();ctx.ellipse(-1,3,22,13,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#090f1d";
    for(const [wx,wy] of [[-10,-12],[10,-12],[-10,12],[10,12]]){ctx.beginPath();ctx.roundRect(wx-5,wy-3,10,6,2);ctx.fill();}
    // Rounded body, nose, cockpit and a subtle central racing stripe.
    ctx.fillStyle=color;ctx.strokeStyle="rgba(255,255,255,.6)";ctx.lineWidth=1.4;
    ctx.beginPath();ctx.roundRect(-20,-10,40,20,7);ctx.fill();ctx.stroke();
    ctx.fillStyle="rgba(255,255,255,.22)";ctx.beginPath();ctx.roundRect(9,-8,10,16,5);ctx.fill();
    ctx.fillStyle="#172033";ctx.beginPath();ctx.roundRect(-8,-8,14,16,4);ctx.fill();
    ctx.fillStyle="#9bdcf7";ctx.beginPath();ctx.roundRect(-5,-6,9,12,3);ctx.fill();
    ctx.fillStyle="rgba(255,255,255,.72)";ctx.fillRect(-19,-2,37,4);
    ctx.fillStyle="#fef3c7";ctx.beginPath();ctx.arc(16,-6,2.1,0,Math.PI*2);ctx.arc(16,6,2.1,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#ef4444";ctx.fillRect(-19,-7,3,4);ctx.fillRect(-19,3,3,4);
    ctx.restore();
    if(scale>.65){ctx.globalAlpha=alpha;ctx.fillStyle="#fff";ctx.font="bold 11px sans-serif";ctx.textAlign="center";ctx.fillText(`${id===state.selfId?"You":remote.name} · L${Math.min(3,(p.lap||0)+1)}`,x,y-18);ctx.globalAlpha=1;}
  }
}
function drawFlappyArena(now){
  const c=$("arena-canvas"),ctx=c.getContext("2d");ctx.clearRect(0,0,720,440);
  const playH=350,scaleY=playH/440;
  const sky=ctx.createLinearGradient(0,0,0,playH);sky.addColorStop(0,"#172554");sky.addColorStop(1,"#0e7490");
  ctx.fillStyle=sky;ctx.fillRect(0,0,720,playH);
  // A moonlit fantasy canyon with distant mist and drifting fireflies.
  const progress=(Date.now()-(arena.startedAt||Date.now()))*.12;
  for(let i=0;i<28;i++){const x=((i*97-progress*.08)%760+760)%760,y=18+(i*53)%315,pulse=.25+Math.sin(now/420+i)*.15;
    ctx.fillStyle=`rgba(224,242,254,${pulse})`;ctx.beginPath();ctx.arc(x,y,1+(i%3)*.45,0,Math.PI*2);ctx.fill();}
  for(let i=0;i<8;i++){const x=((i*137-progress*.22)%850+850)%850-60,y=45+(i*67)%300;
    ctx.fillStyle="rgba(186,230,253,.12)";ctx.beginPath();ctx.ellipse(x,y,48,17,0,0,Math.PI*2);ctx.fill();}
  const drawRockColumn=(x,y,h,lower)=>{
    if(h<=0)return;
    const tipY=lower?y:y+h,baseY=lower?y+h:y;
    const rock=ctx.createLinearGradient(x-32,0,x+32,0);rock.addColorStop(0,"#172033");rock.addColorStop(.48,"#475569");rock.addColorStop(1,"#111827");
    ctx.fillStyle=rock;ctx.strokeStyle="#64748b";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(x-32,baseY);ctx.lineTo(x+32,baseY);ctx.lineTo(x+30,lower?tipY+22:tipY-22);
    ctx.lineTo(x+18,lower?tipY+9:tipY-9);ctx.lineTo(x+10,tipY);
    ctx.lineTo(x,lower?tipY+15:tipY-15);ctx.lineTo(x-10,tipY);
    ctx.lineTo(x-20,lower?tipY+12:tipY-12);ctx.lineTo(x-31,lower?tipY+25:tipY-25);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.strokeStyle="rgba(148,163,184,.35)";ctx.lineWidth=2;
    for(let ridge=0;ridge<3;ridge++){const ry=baseY+(tipY-baseY)*(.25+ridge*.2);ctx.beginPath();ctx.moveTo(x-23,ry);ctx.lineTo(x-7,ry+(lower?-8:8));ctx.lineTo(x+14,ry+(lower?1:-1));ctx.stroke();}
    ctx.fillStyle="rgba(125,211,252,.35)";ctx.beginPath();ctx.moveTo(x-10,tipY);ctx.lineTo(x,lower?tipY+15:tipY-15);ctx.lineTo(x+10,tipY);ctx.closePath();ctx.fill();
  };
  for(const obstacle of arena.obstacles||[]){
    const x=obstacle.x-progress;if(x<-70||x>780)continue;
    const gapTop=(obstacle.gapY-obstacle.gap/2)*scaleY,gapBottom=(obstacle.gapY+obstacle.gap/2)*scaleY;
    drawRockColumn(x,0,gapTop,false);drawRockColumn(x,gapBottom,playH-gapBottom,true);
  }
  const drawDragonRider=(x,y,p,color,size=1,ghost=false,member=null)=>{
    const flap=Math.sin(now/70)*8,tilt=Math.max(-.42,Math.min(.58,(p.vy||0)/440));
    ctx.save();ctx.globalAlpha=ghost?.48:1;ctx.translate(x,y+(ghost?Math.sin(now/260)*5:0));ctx.rotate(ghost?-.08:tilt);ctx.scale(size,size);
    if(ghost){ctx.shadowColor="#bae6fd";ctx.shadowBlur=18;}
    ctx.fillStyle="rgba(0,0,0,.2)";ctx.beginPath();ctx.ellipse(-2,18,28,6,0,0,Math.PI*2);ctx.fill();
    // Tail, body and long dragon snout.
    ctx.fillStyle=ghost?"#e0f2fe":color;ctx.strokeStyle=ghost?"#fff":"#d1fae5";ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(-15,5);ctx.quadraticCurveTo(-35,2,-38,15);ctx.quadraticCurveTo(-29,10,-20,14);ctx.lineTo(-12,10);ctx.closePath();ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.ellipse(0,4,23,14,-.08,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(14,0);ctx.quadraticCurveTo(27,-10,34,-1);ctx.lineTo(31,8);ctx.quadraticCurveTo(23,11,13,7);ctx.closePath();ctx.fill();ctx.stroke();
    // Flapping bat-like wings.
    ctx.fillStyle=ghost?"rgba(255,255,255,.55)":"#312e81";ctx.beginPath();ctx.moveTo(-7,0);ctx.lineTo(-22,-17-flap*.28);ctx.lineTo(-5,-11-flap*.18);ctx.lineTo(5,-22-flap*.2);ctx.lineTo(8,-3);ctx.closePath();ctx.fill();ctx.stroke();
    // Horns, eye, nostril and tiny legs.
    ctx.fillStyle=ghost?"#fff":"#fef3c7";ctx.beginPath();ctx.moveTo(17,-5);ctx.lineTo(19,-15);ctx.lineTo(24,-6);ctx.fill();
    ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(26,-2,4,0,Math.PI*2);ctx.fill();ctx.fillStyle="#0f172a";ctx.beginPath();ctx.arc(28,-2,1.7,0,Math.PI*2);ctx.arc(32,4,1.2,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=ghost?"#fff":"#d1fae5";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-6,14);ctx.lineTo(-10,21);ctx.moveTo(8,14);ctx.lineTo(12,20);ctx.stroke();
    // The player's familiar character rides above the saddle.
    ctx.fillStyle="#7c2d12";ctx.beginPath();ctx.ellipse(-1,-8,10,4,0,0,Math.PI*2);ctx.fill();
    if(window.PaperCharacter&&member){ctx.save();ctx.translate(-2,-24);ctx.scale(.55,.55);window.PaperCharacter.draw(ctx,{x:0,y:0,size:27,direction:1,state:"idle",avatar:{emoji:member.avatar?.emoji||member.emoji,color:member.avatar?.color||member.color||color},time:now});ctx.restore();}
    else {ctx.fillStyle=ghost?"#fff":"#f8fafc";ctx.beginPath();ctx.arc(-2,-21,7,0,Math.PI*2);ctx.fill();}
    if(ghost){ctx.strokeStyle="rgba(255,255,255,.55)";for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-24-i*7,5+i*4);ctx.lineTo(-34-i*9,8+i*5);ctx.stroke();}}
    ctx.restore();
  };
  const me=arena.player,ownInfo=state.room?.players?.find(q=>q.id===state.selfId);
  const selfDead=!!arena.players.get(state.selfId)?.eliminated;
  if(me){
    drawDragonRider(150,me.y*scaleY,me,ownInfo?.avatar?.color||"#22c55e",1.2,selfDead,ownInfo);
    ctx.fillStyle=selfDead?"#bae6fd":"#fff";ctx.font="900 13px sans-serif";ctx.textAlign="center";
    ctx.fillText(selfDead?"YOUR GHOST":"YOU",150,me.y*scaleY-30);
  }
  // Friends live in a separate compact telemetry strip, so they never obscure
  // the player's tab or the next pop-up gap.
  ctx.fillStyle="#07111f";ctx.fillRect(0,playH,720,90);ctx.strokeStyle="#38bdf8";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,playH);ctx.lineTo(720,playH);ctx.stroke();
  ctx.fillStyle="#93c5fd";ctx.font="900 11px sans-serif";ctx.textAlign="left";ctx.fillText("FRIENDS",14,playH+17);
  const friends=[...arena.players.entries()].filter(([id])=>id!==state.selfId);
  const laneW=Math.min(205,690/Math.max(1,friends.length));
  friends.forEach(([id,remote],index)=>{
    const info=state.room?.players?.find(q=>q.id===id),x=15+laneW*index,alive=!remote.eliminated;
    ctx.fillStyle=alive?"rgba(30,64,175,.38)":"rgba(51,65,85,.42)";
    ctx.beginPath();ctx.roundRect(x,playH+25,laneW-8,52,10);ctx.fill();
    ctx.fillStyle=alive?(info?.avatar?.color||remote.avatar?.color||"#38bdf8"):"#94a3b8";
    ctx.beginPath();ctx.arc(x+18,playH+51,7,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=alive?"#f8fafc":"#94a3b8";ctx.font="bold 11px sans-serif";ctx.textAlign="left";
    ctx.fillText(`${alive?"":"👻 "}${remote.name||info?.name||""}`,x+31,playH+46);
    ctx.fillStyle=alive?"#7dd3fc":"#cbd5e1";ctx.font="900 12px sans-serif";
    ctx.fillText(`${Math.floor((remote.distance||0)/10)} m${alive?"":" · crashed"}`,x+31,playH+64);
  });
  const metres=Math.floor((arena.player?.distance||progress)/10);
  ctx.fillStyle="rgba(8,15,30,.78)";ctx.fillRect(15,14,170,34);ctx.fillStyle="#fff";ctx.font="900 17px sans-serif";ctx.textAlign="left";
  ctx.fillText(`DISTANCE  ${metres} m`,28,37);
}
function drawRunnerArena(now){
  const c=$("arena-canvas"),ctx=c.getContext("2d");ctx.clearRect(0,0,720,440);
  const playH=345,elapsed=Math.max(0,Date.now()-(arena.startedAt||Date.now()));
  const progress=arena.player?.distance||elapsed*.145;
  const themes={
    moonwood:{sky:["#312e81","#0f766e","#14532d"],moon:"#fef08a",hills:["rgba(30,64,175,.36)","rgba(21,94,117,.55)","#134e4a"],ground:"#172f25",grass:["#22c55e","#4ade80"]},
    sunset:{sky:["#7c2d12","#c2410c","#78350f"],moon:"#fde68a",hills:["rgba(88,28,135,.35)","rgba(124,45,18,.58)","#422006"],ground:"#291b12",grass:["#eab308","#f59e0b"]},
    crystal:{sky:["#172554","#155e75","#164e63"],moon:"#a5f3fc",hills:["rgba(67,56,202,.38)","rgba(8,145,178,.48)","#0e3b45"],ground:"#102a36",grass:["#22d3ee","#67e8f9"]},
    storm:{sky:["#0f172a","#334155","#1e293b"],moon:"#e2e8f0",hills:["rgba(15,23,42,.48)","rgba(30,41,59,.72)","#172033"],ground:"#111827",grass:["#64748b","#94a3b8"]}
  },theme=themes[arena.runnerTheme]||themes.moonwood;
  const sky=ctx.createLinearGradient(0,0,0,playH);sky.addColorStop(0,theme.sky[0]);sky.addColorStop(.58,theme.sky[1]);sky.addColorStop(1,theme.sky[2]);
  ctx.fillStyle=sky;ctx.fillRect(0,0,720,playH);
  // Layered scenery scrolls at different speeds to give the lightweight runner depth.
  ctx.fillStyle=theme.moon;ctx.globalAlpha=.85;ctx.beginPath();ctx.arc(600,62,28,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
  for(let layer=0;layer<3;layer++){
    ctx.fillStyle=theme.hills[layer];
    ctx.beginPath();ctx.moveTo(0,260+layer*24);
    for(let x=-80;x<=800;x+=80){const sx=x-((progress*(.08+layer*.06))%80);ctx.lineTo(sx,185+layer*32+((x/80+layer)%3)*19);ctx.lineTo(sx+80,260+layer*24);}
    ctx.lineTo(720,345);ctx.lineTo(0,345);ctx.fill();
  }
  // Fast foreground grass and stepping stones.
  ctx.fillStyle=theme.ground;ctx.fillRect(0,326,720,19);
  for(let i=0;i<20;i++){const x=((i*47-progress*.72)%780+780)%780-30;ctx.fillStyle=theme.grass[i%2];ctx.fillRect(x,318,3,10);}
  const drawHazard=(obstacle)=>{
    const x=obstacle.x-progress;if(x<-60||x>780)return;
    const ground=326,h=obstacle.h,w=obstacle.w;
    if(obstacle.type==="hanging"){
      ctx.fillStyle="#3f1d0b";ctx.fillRect(x-5,0,10,245);
      ctx.fillStyle="#7c2d12";ctx.beginPath();ctx.moveTo(x-w/2,245);ctx.lineTo(x,292);ctx.lineTo(x+w/2,245);ctx.closePath();ctx.fill();
      ctx.strokeStyle="#f97316";ctx.lineWidth=2;ctx.stroke();
    }else if(obstacle.type==="bramble"){
      ctx.strokeStyle="#422006";ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(x-w/2,ground);ctx.quadraticCurveTo(x,ground-h,x+w/2,ground);ctx.stroke();
      ctx.fillStyle="#a3e635";for(let i=0;i<4;i++){ctx.beginPath();ctx.moveTo(x-w/2+i*w/3,ground-i%2*9);ctx.lineTo(x-5+i*w/3,ground-18-i%2*8);ctx.lineTo(x+1+i*w/3,ground-i%2*9);ctx.fill();}
    }else if(obstacle.type==="crystal"){
      ctx.fillStyle="#67e8f9";ctx.strokeStyle="#cffafe";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x-w/2,ground);ctx.lineTo(x-w*.22,ground-h*.72);ctx.lineTo(x,ground-h);ctx.lineTo(x+w*.24,ground-h*.65);ctx.lineTo(x+w/2,ground);ctx.closePath();ctx.fill();ctx.stroke();
    }else{
      const bark=ctx.createLinearGradient(x-w/2,0,x+w/2,0);bark.addColorStop(0,"#451a03");bark.addColorStop(.5,"#92400e");bark.addColorStop(1,"#3f1d0b");
      ctx.fillStyle=bark;ctx.beginPath();ctx.roundRect(x-w/2,ground-h,w,h,5);ctx.fill();ctx.fillStyle="#78350f";ctx.beginPath();ctx.ellipse(x,ground-h,w/2,5,0,0,Math.PI*2);ctx.fill();
    }
  };
  for(const platform of arena.runnerPlatforms||[]){
    const x=platform.x-progress;if(x<-platform.w||x>780)continue;
    ctx.fillStyle="#334155";ctx.strokeStyle="#94a3b8";ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(x-platform.w/2,platform.y,platform.w,14,5);ctx.fill();ctx.stroke();
    ctx.fillStyle="#4ade80";ctx.fillRect(x-platform.w/2+4,platform.y-4,platform.w-8,5);
  }
  const collected=new Set(arena.player?.collectedCoins||[]);
  (arena.runnerCoins||[]).forEach((coin,index)=>{
    if(collected.has(index))return;const x=coin.x-progress;if(x<-20||x>740)return;
    ctx.save();ctx.translate(x,coin.y);ctx.scale(.45+Math.abs(Math.sin(now/170+index))*.55,1);
    ctx.fillStyle="#facc15";ctx.strokeStyle="#fef08a";ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,8,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle="#a16207";ctx.font="900 10px sans-serif";ctx.textAlign="center";ctx.fillText("★",0,4);ctx.restore();
  });
  for(const obstacle of arena.obstacles||[])drawHazard(obstacle);
  const me=arena.player,info=state.room?.players?.find(q=>q.id===state.selfId),dead=!!arena.players.get(state.selfId)?.eliminated;
  if(me){
    const airborne=me.y<((me.groundY||326)-2),rolling=!!me.rolling,runState=airborne?"jump":dead?"hurt":"run";
    ctx.save();ctx.globalAlpha=dead?.38:1;
    if(dead){ctx.translate(135,me.y);ctx.rotate(-.45);ctx.translate(-135,-me.y);}
    if(rolling){ctx.translate(135,me.y-12);ctx.rotate(now*.018);ctx.scale(.78,.78);ctx.translate(-135,-(me.y-12));}
    if(window.PaperCharacter)window.PaperCharacter.draw(ctx,{x:135,y:me.y-19,size:42,direction:1,state:runState,avatar:info?.avatar||{emoji:info?.emoji,color:info?.color},time:(arena.runnerAnimTime||0)*1000});
    else{ctx.fillStyle=info?.avatar?.color||"#f59e0b";ctx.beginPath();ctx.arc(135,me.y-20,16,0,Math.PI*2);ctx.fill();}
    ctx.restore();
    ctx.fillStyle=dead?"#cbd5e1":"#fff";ctx.font="900 12px sans-serif";ctx.textAlign="center";ctx.fillText(dead?"OUT":"YOU",135,me.y-50);
  }
  // Each competitor owns a distinct race lane; only the local lane fills the playfield.
  ctx.fillStyle="#07111f";ctx.fillRect(0,playH,720,95);ctx.fillStyle="#93c5fd";ctx.font="900 10px sans-serif";ctx.textAlign="left";ctx.fillText("RUNNERS — SEPARATE LANES",12,playH+15);
  const runners=[...arena.players.entries()],laneH=Math.min(18,68/Math.max(1,runners.length));
  runners.forEach(([id,p],i)=>{
    const y=playH+25+i*laneH,member=state.room?.players?.find(q=>q.id===id),distance=Math.floor((p.distance||0)/10);
    ctx.fillStyle="rgba(30,64,175,.28)";ctx.fillRect(12,y-8,696,laneH-2);
    const lead=Math.max(1,...runners.map(([,r])=>r.distance||0)),px=145+Math.min(535,(p.distance||0)/lead*535);
    ctx.fillStyle=member?.avatar?.color||p.avatar?.color||"#38bdf8";ctx.beginPath();ctx.arc(px,y,5,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=p.eliminated?"#94a3b8":"#f8fafc";ctx.font="bold 10px sans-serif";ctx.textAlign="left";ctx.fillText(`${id===state.selfId?"You":p.name}  ${distance} m${p.eliminated?" · out":""}`,18,y+3);
  });
  ctx.fillStyle="rgba(8,15,30,.78)";ctx.fillRect(15,14,170,34);ctx.fillStyle="#fff";ctx.font="900 17px sans-serif";ctx.textAlign="left";
  ctx.fillText(`DISTANCE  ${Math.floor((me?.distance||progress)/10)} m`,28,37);
  ctx.fillStyle="rgba(8,15,30,.78)";ctx.fillRect(198,14,180,34);ctx.fillStyle="#fde047";ctx.fillText(`★ ${me?.coins||0}  SPEED`,212,37);
  if(arena.runnerFlash&&now-arena.runnerFlash.at<1050){
    const age=now-arena.runnerFlash.at;ctx.save();ctx.globalAlpha=1-age/1050;ctx.fillStyle=arena.runnerFlash.color;ctx.font="900 24px sans-serif";ctx.textAlign="center";
    ctx.fillText(arena.runnerFlash.text,360,100-age*.035);ctx.restore();
  }
}
function drawPongArena(now){
  const c=$("arena-canvas"),ctx=c.getContext("2d");ctx.clearRect(0,0,720,440);
  const bg=ctx.createRadialGradient(360,220,40,360,220,390);bg.addColorStop(0,"#172554");bg.addColorStop(1,"#020617");
  ctx.fillStyle=bg;ctx.fillRect(0,0,720,440);
  const sides=arena.pongSides||4,apothem=174,radius=apothem/Math.cos(Math.PI/sides);
  const vertices=Array.from({length:sides},(_,i)=>{
    const angle=-Math.PI/2-Math.PI/sides+i*Math.PI*2/sides;
    return [360+Math.cos(angle)*radius,220+Math.sin(angle)*radius];
  });
  ctx.beginPath();ctx.moveTo(...vertices[0]);for(let i=1;i<sides;i++)ctx.lineTo(...vertices[i]);ctx.closePath();
  ctx.fillStyle="rgba(30,64,175,.18)";ctx.fill();ctx.strokeStyle="rgba(96,165,250,.35)";ctx.lineWidth=5;ctx.stroke();
  const owners={};for(const [id,side]of Object.entries(arena.playerSides||{}))owners[side]=id;
  for(let side=0;side<sides;side++){
    const angle=-Math.PI/2+side*Math.PI*2/sides,nx=Math.cos(angle),ny=Math.sin(angle),tx=-ny,ty=nx;
    const ownerId=owners[side],remote=arena.players.get(ownerId),p=ownerId===state.selfId?arena.player:remote;
    const info=state.room?.players?.find(q=>q.id===ownerId),alive=ownerId&&(arena.lives[ownerId]||0)>0;
    const sideLength=2*apothem*Math.tan(Math.PI/sides),offset=((p?.paddleT??.5)-.5)*Math.max(35,sideLength-105);
    const cx=360+nx*apothem+tx*offset,cy=220+ny*apothem+ty*offset;
    if(ownerId){
      ctx.save();ctx.translate(cx,cy);ctx.rotate(angle+Math.PI/2);
      ctx.shadowColor=alive?(info?.avatar?.color||"#38bdf8"):"#475569";ctx.shadowBlur=alive?16:0;
      ctx.fillStyle=alive?(info?.avatar?.color||"#38bdf8"):"#334155";
      ctx.beginPath();ctx.roundRect(-44,-8,88,16,8);ctx.fill();ctx.restore();
      const lx=360+nx*(apothem+28),ly=220+ny*(apothem+28);
      ctx.fillStyle="#fff";ctx.font="bold 11px sans-serif";ctx.textAlign="center";
      ctx.fillText(ownerId===state.selfId?"You":(remote?.name||info?.name||""),lx,ly-2);
      ctx.fillStyle="#fb7185";ctx.font="14px sans-serif";ctx.fillText("♥".repeat(arena.lives[ownerId]||0),lx,ly+14);
    }
  }
  arena.pongLifeEffects=(arena.pongLifeEffects||[]).filter((effect)=>{
    const age=now-effect.started;if(age>1050)return false;
    const side=Number.isInteger(effect.side)?effect.side:(arena.playerSides[effect.playerId]||0);
    const angle=-Math.PI/2+side*Math.PI*2/sides,nx=Math.cos(angle),ny=Math.sin(angle);
    const x=360+nx*(apothem-38),y=220+ny*(apothem-38),progress=age/1050;
    ctx.save();ctx.globalAlpha=1-progress;ctx.translate(x,y);ctx.scale(1+progress*.8,1+progress*.8);
    ctx.fillStyle="#fb7185";ctx.font="900 24px sans-serif";ctx.textAlign="center";ctx.fillText("−1 ♥",0,0);
    ctx.strokeStyle="#fecdd3";ctx.lineWidth=3;
    for(let i=0;i<8;i++){const a=i*Math.PI/4,d=18+progress*38;ctx.beginPath();ctx.moveTo(Math.cos(a)*d,Math.sin(a)*d);ctx.lineTo(Math.cos(a)*(d+10),Math.sin(a)*(d+10));ctx.stroke();}
    ctx.restore();return true;
  });
  const extrapolate=Math.min(.07,(now-(arena.ballReceivedAt||now))/1000);
  for(const ball of arena.balls||[]){
    let x=ball.x+ball.vx*extrapolate,y=ball.y+ball.vy*extrapolate;
    let maxProjection=-Infinity,edgeNx=0,edgeNy=0;
    for(let side=0;side<sides;side++){
      const angle=-Math.PI/2+side*Math.PI*2/sides,nx=Math.cos(angle),ny=Math.sin(angle);
      const projection=(x-360)*nx+(y-220)*ny;
      if(projection>maxProjection){maxProjection=projection;edgeNx=nx;edgeNy=ny;}
    }
    if(maxProjection>apothem+8){const excess=maxProjection-(apothem+8);x-=edgeNx*excess;y-=edgeNy*excess;}
    const glow=ctx.createRadialGradient(x,y,2,x,y,18);glow.addColorStop(0,"#fff");glow.addColorStop(.35,"#fde047");glow.addColorStop(1,"rgba(250,204,21,0)");
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(x,y,18,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(x,y,8,0,Math.PI*2);ctx.fill();
  }
  ctx.fillStyle="rgba(8,15,30,.78)";ctx.fillRect(14,12,176,32);ctx.fillStyle="#fff";ctx.font="900 15px sans-serif";ctx.textAlign="left";
  ctx.fillText(`${arena.balls?.length||1} BALL${arena.balls?.length===1?"":"S"} IN PLAY`,27,34);
}
function drawPainterArena(now){
  const c=$("arena-canvas"),ctx=c.getContext("2d"),cols=arena.painterCols||18,rows=arena.painterRows||11,cell=40;
  ctx.clearRect(0,0,720,440);
  const bg=ctx.createLinearGradient(0,0,0,440);bg.addColorStop(0,"#172554");bg.addColorStop(1,"#07111f");ctx.fillStyle=bg;ctx.fillRect(0,0,720,440);
  const member=(id)=>state.room?.players?.find((p)=>p.id===id),color=(id)=>member(id)?.avatar?.color||arena.players.get(id)?.avatar?.color||"#38bdf8";
  for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
    const key=`${col}:${row}`,owner=arena.painterTerritory?.[key];
    ctx.fillStyle=owner?color(owner)+"b8":((row+col)%2?"#15243a":"#192b43");ctx.fillRect(col*cell+1,row*cell+1,cell-2,cell-2);
    if(owner){ctx.fillStyle="rgba(255,255,255,.11)";ctx.fillRect(col*cell+4,row*cell+4,cell-8,5);}
  }
  ctx.strokeStyle="rgba(148,163,184,.13)";ctx.lineWidth=1;
  for(let x=0;x<=720;x+=cell){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,440);ctx.stroke();}
  for(let y=0;y<=440;y+=cell){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(720,y);ctx.stroke();}
  for(const [id,trail] of Object.entries(arena.painterTrails||{})){
    if(!trail?.length)continue;ctx.strokeStyle=color(id);ctx.lineWidth=12;ctx.lineCap="round";ctx.lineJoin="round";ctx.shadowColor=color(id);ctx.shadowBlur=10;
    ctx.beginPath();trail.forEach((key,i)=>{const [col,row]=key.split(":").map(Number),x=col*cell+20,y=row*cell+20;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.shadowBlur=0;
    ctx.strokeStyle="rgba(255,255,255,.7)";ctx.lineWidth=3;ctx.setLineDash([5,8]);ctx.stroke();ctx.setLineDash([]);
  }
  for(const bucket of arena.painterBuckets||[]){
    const x=bucket.col*cell+20,y=bucket.row*cell+20,pulse=1+Math.sin(now/110+bucket.id)*.08;
    ctx.save();ctx.translate(x,y);ctx.scale(pulse,pulse);ctx.shadowColor="#fde047";ctx.shadowBlur=14;
    ctx.fillStyle=bucket.type==="cross"?"#38bdf8":bucket.type==="splash"?"#f59e0b":bucket.type==="speed"?"#22c55e":bucket.type==="lightning"?"#fde047":bucket.type==="roller"?"#ec4899":"#a855f7";
    ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(-12,-11,24,23,5);ctx.fill();ctx.stroke();
    ctx.strokeStyle="#e2e8f0";ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,-8,9,Math.PI,Math.PI*2);ctx.stroke();
    ctx.fillStyle="#fff";ctx.font="900 10px sans-serif";ctx.textAlign="center";ctx.fillText(bucket.type==="cross"?"+":bucket.type==="splash"?"3":bucket.type==="speed"?"»":bucket.type==="lightning"?"⚡":bucket.type==="roller"?(bucket.orientation==="vertical"?"↕":"↔"):"★",0,5);ctx.restore();
  }
  for(const [id,remote] of arena.players){
    const p=id===state.selfId?arena.player:remote;if(!p)continue;const info=member(id);
    ctx.fillStyle="rgba(0,0,0,.35)";ctx.beginPath();ctx.ellipse(p.x,p.y+11,16,6,0,0,Math.PI*2);ctx.fill();
    if(window.PaperCharacter)PaperCharacter.draw(ctx,{x:p.x,y:p.y,size:34,direction:(p.vx||p.renderVx||0)<0?-1:1,state:Math.hypot(p.vx||p.renderVx||0,p.vy||p.renderVy||0)>20?"run":"idle",avatar:info?.avatar||remote.avatar,time:now});
    if(Date.now()<(p.painterStunnedUntil||0)){
      ctx.strokeStyle="#fde047";ctx.lineWidth=3;ctx.shadowColor="#facc15";ctx.shadowBlur=10;
      for(let bolt=0;bolt<3;bolt++){const angle=bolt*Math.PI*2/3+now*.008;ctx.beginPath();ctx.moveTo(p.x+Math.cos(angle)*12,p.y-8+Math.sin(angle)*12);ctx.lineTo(p.x+Math.cos(angle+.35)*23,p.y-8+Math.sin(angle+.35)*23);ctx.lineTo(p.x+Math.cos(angle)*30,p.y-8+Math.sin(angle)*30);ctx.stroke();}ctx.shadowBlur=0;
      ctx.fillStyle="#fde047";ctx.font="900 10px sans-serif";ctx.textAlign="center";ctx.fillText("STUNNED",p.x,p.y-36);
    }
    ctx.fillStyle="#fff";ctx.font="900 10px sans-serif";ctx.textAlign="center";ctx.fillText(id===state.selfId?"YOU":(remote.name||info?.name||""),p.x,p.y-25);
  }
  if(arena.painterFlash&&now-arena.painterFlash.at<1500){const age=now-arena.painterFlash.at;ctx.globalAlpha=1-age/1500;ctx.fillStyle="#fff";ctx.font="900 22px sans-serif";ctx.textAlign="center";ctx.fillText(arena.painterFlash.text,360,70);ctx.globalAlpha=1;}
}
function updatePainterLegend(){
  const el=$("arena-painter-legend");if(!el||arena.mode!=="painter")return;
  const total=(arena.painterCols||18)*(arena.painterRows||11),counts={};
  for(const id of Object.values(arena.painterTerritory||{}))counts[id]=(counts[id]||0)+1;
  const ids=[...arena.players.keys()].sort((a,b)=>(counts[b]||0)-(counts[a]||0));
  el.innerHTML=`<span class="painter-legend-title">TERRITORY</span>`+ids.map((id)=>{
    const info=state.room?.players?.find((p)=>p.id===id),remote=arena.players.get(id),color=info?.avatar?.color||remote?.avatar?.color||"#38bdf8";
    return `<span class="painter-legend-chip"><span class="painter-legend-dot" style="background:${color};color:${color}"></span>${esc(id===state.selfId?"You":(remote?.name||info?.name||""))} ${((counts[id]||0)/total*100).toFixed(1)}%</span>`;
  }).join("");
}
function drawArena(now) {
  if(arena.mode==="fire")return drawFireArena(now);
  if(arena.mode==="racing")return drawRaceArena(now);
  if(arena.mode==="flappy")return drawFlappyArena(now);
  if(arena.mode==="runner")return drawRunnerArena(now);
  if(arena.mode==="painter")return drawPainterArena(now);
  if(arena.mode==="pong")return drawPongArena(now);
  const c=$("arena-canvas");
  if(!arena.renderer||arena.renderer.canvas!==c)arena.renderer=new Arena25D(c);
  const r=arena.renderer,ctx=r.ctx;
  ctx.clearRect(0,0,720,440);
  if(arena.mode==="colorfloor"){
    r.backdrop("lava",now);r.lavaSparks(now,1);
    const scrambling=Date.now()<arena.scrambleUntil;
    const untilDanger=arena.dangerAt?arena.dangerAt-Date.now():9999;
    const dangerNow=untilDanger<=0;
    const warning=Math.max(0,Math.min(1,1-untilDanger/1700));
    for(let row=0;row<4;row++)for(let col=0;col<6;col++){
      const index=row*6+col;
      const lockedColor=arena.tileLayout[index]??((col+row*2)%4);
      const color=scrambling?(Math.floor(Date.now()/105)+index*3+arena.colorCycle)%4:lockedColor;
      const danger=!scrambling&&arena.dangerAt&&Date.now()>=arena.dangerAt&&color!==arena.safeColor;
      const pulse=(color===arena.safeColor) ? 0.5+Math.sin(now/120)*.18 : 0;
      const unsafe=!scrambling&&color!==arena.safeColor;
      const top=r.tile(col*120+2,row*110+2,116,106,{
        fill:danger?(Math.sin(now/65)>0?"#8b1018":"#3f080d"):
          (unsafe&&warning>.55?"#4b2630":ARENA_COLORS[color]),
        side:danger?"#26070d":"rgba(20,25,48,.92)",
        sideRight:danger?"#170408":"rgba(8,13,30,.95)",
        stroke:color===arena.safeColor?`rgba(255,255,255,${.65+pulse})`:"rgba(255,255,255,.2)",
        lineWidth:color===arena.safeColor?3:1.2,
        thickness:danger?2:10,lift:danger?-10-Math.sin(now/55)*3:0
      });
      const center={x:(top[0].x+top[2].x)/2,y:(top[0].y+top[2].y)/2};
      ctx.save();ctx.textAlign="center";ctx.textBaseline="middle";
      if(!scrambling&&color===arena.safeColor){
        ctx.globalAlpha=.72+Math.sin(now/130)*.2;ctx.fillStyle="#fff";
        ctx.font=`900 ${20+top[2].depth*9}px sans-serif`;ctx.fillText("✓",center.x,center.y);
      }else if(!scrambling&&warning>.12){
        ctx.globalAlpha=Math.min(.9,.2+warning*.75);ctx.strokeStyle=danger?"#ffdf48":"#fff";
        ctx.lineWidth=danger?6:3;
        const size=12+top[2].depth*10;
        ctx.beginPath();ctx.moveTo(center.x-size,center.y-size);ctx.lineTo(center.x+size,center.y+size);
        ctx.moveTo(center.x+size,center.y-size);ctx.lineTo(center.x-size,center.y+size);ctx.stroke();
      }
      ctx.restore();
    }
    if(dangerNow){
      const vignette=ctx.createRadialGradient(360,220,120,360,220,410);
      vignette.addColorStop(0,"rgba(255,20,20,0)");vignette.addColorStop(1,`rgba(255,0,0,${.3+Math.sin(now/70)*.12})`);
      ctx.fillStyle=vignette;ctx.fillRect(0,0,720,440);
    }
  }else if(arena.mode==="vanish"){
    const theme=arena.vanishTheme||VANISH_THEMES[0];
    drawVanishBackdrop(ctx,arena.camY||0,now,theme);
    // Camera eases to follow the local player's floor, so falling reads as
    // descending onto a clearly lower floor.
    const myLayer = arena.player ? (arena.player.layer||0) : 0;
    const camTarget = myLayer * VANISH.spacing;
    // Slow camera that LAGS the character's descent, so you clearly see yourself
    // drop to the floor below and then the camera settles onto it.
    arena.camY = (arena.camY==null) ? camTarget : arena.camY + (camTarget - arena.camY)*0.028;
    const baseColors=theme.floors;
    const gap=theme.gap;
    const mask=arena.vmap?arena.vmap.mask:"full";
    const shape=arena.vmap?arena.vmap.shape:"square";
    const present=(l,c,rr)=>!window.VanishMaps||VanishMaps.cellPresent(mask,l,c,rr);
    // Every cell the local player's footprint overlaps (matches the server), so
    // standing between two tiles lights up BOTH — and predicts them INSTANTLY,
    // even before the server's confirmation arrives (or if it lags).
    const localKeys=new Set();
    if(arena.player){
      const radius=Math.min(VANISH.tw,VANISH.th)*0.16, px=arena.player.x, py=arena.player.y;
      for(const [sx,sy] of [[px,py],[px-radius,py],[px+radius,py],[px,py-radius],[px,py+radius]]){
        const c=Math.floor((sx-VANISH.x0)/VANISH.tw), rr=Math.floor((sy-VANISH.y0)/VANISH.th);
        if(c>=0&&c<VANISH.cols&&rr>=0&&rr<VANISH.rows) localKeys.add(`${myLayer}:${c}:${rr}`);
      }
    }
    for(const key of localKeys){
      if(!arena.tiles.has(key)&&!arena.localTileTimes.has(key))arena.localTileTimes.set(key,now);
    }
    // Draw current floor + the ones below (deepest first, current last = on top).
    // Floors ABOVE the player are skipped so they can't cover it.
    for(let layer=VANISH.layers-1;layer>=0;layer--){
      const layerLift = arena.camY - layer*VANISH.spacing;
      for(let row=0;row<VANISH.rows;row++)for(let col=0;col<VANISH.cols;col++){
        if(!present(layer,col,row))continue;   // hole in this map's pattern
        const key=`${layer}:${col}:${row}`,tile=arena.tiles.get(key);
        const isMine=localKeys.has(key);
        const predictedAt=arena.localTileTimes.get(key);
        let stepped=false, remaining=1, falling=0;
        if(tile){
          falling=Math.max(0,Date.now()-tile.disappearsAt);
          if(falling>620)continue;            // fully gone -> a hole
          stepped=true; remaining=Math.max(0,(tile.disappearsAt-Date.now())/(tile.decayMs||1200));
        }else if(predictedAt!=null){            // moving away cannot reset this countdown
          falling=Math.max(0,now-predictedAt-1100);
          if(falling>420)continue;
          stepped=true; remaining=Math.max(0,1-(now-predictedAt)/1100);
        }
        const drop=falling?Math.pow(falling/420,1.8)*230:0;
        const sink=stepped&&!falling?(1-remaining)*7:0;
        const shake=(stepped&&!falling&&remaining<0.4)?(Math.random()-0.5)*3.5:0;
        const rc=cellRect(col,row);
        const ccx=rc.x+VANISH.tw/2+shake, ccy=rc.y+VANISH.th/2;
        const hw=(VANISH.tw-gap*2)/2, hh=(VANISH.th-gap*2)/2;
        const bcol=baseColors[layer%baseColors.length]||"#2b4860";
        const checkered=((col+row)&1)?vTint(bcol,theme.checker*0.55):vTint(bcol,-theme.checker);
        const top=drawShapeTile(r, ccx, ccy, hw, hh, shape, layerLift-drop-sink, {
          // untouched = the map's floor colour; the instant you step it goes amber -> red.
          fill: stepped ? (falling ? "#232f45" : `hsl(${remaining*48} 80% ${46+remaining*8}%)`) : checkered,
          side: stepped ? "#3a2410" : theme.side,
          stroke: isMine ? "rgba(255,255,255,.95)" : (stepped ? "rgba(255,120,60,.85)" : theme.stroke),
          lineWidth: isMine ? 3.5 : 1.4,
          thickness: Math.max(3, theme.thickness - sink)
        });
        if(!stepped&&layer===myLayer&&theme.deco!=="none"&&(shape==="square"||shape==="diamond"))drawTileDeco(ctx,top,theme,now);
      }
    }
  }else{
    r.backdrop("night",now);
    for(let row=0;row<8;row++)for(let col=0;col<10;col++)r.tile(col*72,row*55,72,55,{
      fill:(row+col)%2?"#314e70":"#294462",side:"#14243a",thickness:4,
      stroke:"rgba(148,205,255,.12)"
    });
  }
  arena.bursts=arena.bursts.filter((burst)=>{
    const age=now-burst.born;if(age>850)return false;
    // In vanish, dust rides its own floor (lift by that layer) so it doesn't
    // appear to float on the floor the player is standing on.
    const dustLift=(arena.mode==="vanish"&&burst.layer!=null)
      ? (arena.camY||0)-burst.layer*VANISH.spacing+8 : 8;
    const base=r.project(burst.x,burst.y,dustLift),progress=age/850;
    ctx.save();ctx.globalAlpha=1-progress;
    for(let i=0;i<burst.count;i++){
      const angle=(i/burst.count)*Math.PI*2+i*.7;
      const distance=progress*(18+(i%5)*7)*base.scale;
      ctx.fillStyle=burst.color;ctx.beginPath();
      ctx.arc(base.x+Math.cos(angle)*distance,base.y+Math.sin(angle)*distance-progress*24,
        Math.max(1,(3-progress*2)*base.scale),0,Math.PI*2);ctx.fill();
    }
    ctx.restore();return true;
  });
  const drawPlayers=[...arena.players.entries()].sort((a,b)=>(a[1].y||0)-(b[1].y||0));
  for(const [id,remote] of drawPlayers){
    const p=id===state.selfId?arena.player:remote;if(!p)continue;
    const deathAge=p.visualEliminatedAt?now-p.visualEliminatedAt:0;
    const twisterDeath=arena.mode==="colorfloor"&&deathAge>0;
    const deathLifetime=twisterDeath?950:360;
    if((remote.eliminated||p.visualEliminatedAt)&&deathAge>deathLifetime)continue;
    if(remote.eliminated&&!p.visualEliminatedAt)continue;
    const info=state.room?.players?.find((x)=>x.id===id);
    const jumpRemaining=Math.max(0,(p.jumpingUntil||0)-Date.now());
    const jumpProgress=jumpRemaining?1-jumpRemaining/620:0;
    const jumpLift=jumpRemaining?Math.sin(jumpProgress*Math.PI)*55:0;
    const vLayer=arena.mode==="vanish"?(p.visualLayer!=null?p.visualLayer:(p.layer||0)):0;
    const layerDrop=arena.mode==="vanish"?(vLayer*VANISH.spacing - (arena.camY||0)):0;
    const deathDrop=deathAge&&!twisterDeath?Math.min(85,deathAge*.24):0;
    const projected=r.project(p.x,p.y,10+jumpLift-layerDrop-deathDrop);
    if(twisterDeath){
      const bounceAge=Math.min(160,deathAge);
      const launchAge=Math.max(0,deathAge-160);
      const lift=Math.sin((bounceAge/160)*Math.PI/2)*72+launchAge*.82;
      projected.y-=lift;
      projected.x+=(p.eliminationDirection||1)*launchAge*.72;
    }
    // how high above the floor they belong to (mid-fall) — drives the fall pose,
    // speed-lines and a shrinking shadow.
    const airborne=arena.mode==="vanish"?(jumpLift+Math.max(0,((p.layer||0)-vLayer))*VANISH.spacing):0;
    if(arena.mode==="vanish"){
      const floorLift=(arena.camY||0)-(p.layer||0)*VANISH.spacing;
      const shp=r.project(p.x,p.y,floorLift);
      const srx=Math.max(7,22-airborne*.05)*shp.scale, sry=srx*.32;
      // a clear, dark contact shadow so you always know where you are
      ctx.save();
      ctx.fillStyle=`rgba(0,0,0,${.5*Math.max(.18,1-airborne/170)})`;
      ctx.beginPath();ctx.ellipse(shp.x,shp.y+3,srx,sry,0,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle=`rgba(180,215,255,${.5*Math.max(.15,1-airborne/170)})`;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.ellipse(shp.x,shp.y+3,srx,sry,0,0,Math.PI*2);ctx.stroke();
      // while airborne, a guide line + speed streaks show where you'll land
      if(airborne>24){
        ctx.setLineDash([4,5]);ctx.strokeStyle="rgba(180,215,255,.4)";ctx.lineWidth=1.5;
        ctx.beginPath();ctx.moveTo(projected.x,projected.y-6);ctx.lineTo(shp.x,shp.y+3);ctx.stroke();ctx.setLineDash([]);
        ctx.strokeStyle="rgba(200,225,255,.5)";ctx.lineWidth=2;ctx.lineCap="round";
        for(let i=0;i<4;i++){const sx=projected.x-18+i*12,ty=projected.y-46*projected.scale-12;ctx.beginPath();ctx.moveTo(sx,ty);ctx.lineTo(sx,ty-Math.min(30,airborne*.2));ctx.stroke();}
      }
      ctx.restore();
    }else{
      r.shadow(p.x,p.y,23,.38*(1-jumpLift/90));
    }
    if(id===arena.holderId){
      const pulse=1+Math.sin((now-arena.holderSince)/95)*.12;
      const aura=ctx.createRadialGradient(projected.x,projected.y,5,projected.x,projected.y,42*projected.scale);
      aura.addColorStop(0,"rgba(249,115,22,.45)");aura.addColorStop(1,"rgba(249,115,22,0)");
      ctx.fillStyle=aura;ctx.beginPath();ctx.arc(projected.x,projected.y,42*projected.scale,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#111827";ctx.beginPath();ctx.arc(projected.x+18*projected.scale,projected.y-27*projected.scale,15*pulse*projected.scale,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#f97316";ctx.beginPath();ctx.arc(projected.x+27*projected.scale,projected.y-39*projected.scale,4,0,Math.PI*2);ctx.fill();
    }
    const animVx=id===state.selfId?(p.vx||0):(p.renderVx||p.vx||0);
    const animVy=id===state.selfId?(p.vy||0):(p.renderVy||p.vy||0);
    const moving=Math.hypot(animVx,animVy)>14;
    const bumped=now<(p.bumpUntil||0);
    if(deathAge&&deathAge<190){
      ctx.save();ctx.strokeStyle="#fff36b";ctx.lineWidth=3;ctx.globalAlpha=1-deathAge/230;
      for(let bolt=0;bolt<4;bolt++){
        const angle=bolt*Math.PI/2+deathAge*.02;
        ctx.beginPath();ctx.moveTo(projected.x,projected.y-12);
        ctx.lineTo(projected.x+Math.cos(angle)*18,projected.y-12+Math.sin(angle)*18);
        ctx.lineTo(projected.x+Math.cos(angle)*30,projected.y-12+Math.sin(angle)*30);ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    if(twisterDeath){
      ctx.translate(projected.x,projected.y);
      ctx.rotate((p.eliminationDirection||1)*deathAge*.012);
      ctx.translate(-projected.x,-projected.y);
      ctx.filter="grayscale(1) brightness(0)";
    }
    PaperCharacter.draw(ctx,{x:projected.x,y:projected.y,size:58*projected.scale,avatar:info?.avatar||remote.avatar,
      state:deathAge?(deathAge<190?"stunned":"eliminated"):(airborne>30?"fall":(jumpRemaining?"jump":(bumped?"stunned":(moving?"run":"idle")))),
      direction:animVx<0?-1:1,time:now});
    ctx.restore();
    ctx.fillStyle="rgba(8,15,30,.85)";ctx.font="bold 12px sans-serif";ctx.textAlign="center";
    if(!twisterDeath||deathAge<260)
      ctx.fillText(id===state.selfId?"You":(remote.name||info?.name||""),projected.x,projected.y-38*projected.scale);
  }
  // "⬇ Floor N" flash when the local player drops a level.
  if(arena.mode==="vanish"&&arena.fallFlash){
    const age=now-arena.fallFlash.at, life=1600;
    if(age>life){arena.fallFlash=null;}
    else{
      const t=age/life, alpha=Math.sin(Math.min(1,t*1.5)*Math.PI);
      ctx.save();ctx.globalAlpha=Math.max(0,alpha);ctx.textAlign="center";
      ctx.fillStyle="#0b1324";ctx.font="bold 42px sans-serif";
      ctx.fillText("⬇ FLOOR "+arena.fallFlash.floor,362,120+t*50);
      ctx.fillStyle="#dbeafe";ctx.fillText("⬇ FLOOR "+arena.fallFlash.floor,360,118+t*50);
      ctx.restore();
    }
  }
}
function applyColorSignal({safeColor,dangerAt,scrambleUntil,cycle,tileLayout}) {
  arena.safeColor=safeColor;arena.dangerAt=dangerAt;arena.scrambleUntil=scrambleUntil||Date.now();
  arena.tileLayout=tileLayout||arena.tileLayout;arena.colorCycle=cycle;
  for(const p of arena.players.values())if(!p.eliminated)delete p.visualEliminatedAt;
  if(arena.player&&!arena.done)delete arena.player.visualEliminatedAt;
  const sign=$("arena-sign");
  sign.innerHTML=`<span class="sign-label">PHASE 1 — FLOOR CHANGING</span>SCRAMBLING…`;
  sign.style.background="#64748b";sign.classList.remove("danger","warning");
  $("arena-hint").textContent="Wait for the colors to lock—then run to the announced safe color!";
  const revealDelay=Math.max(0,arena.scrambleUntil-Date.now());
  setTimeout(()=>{
    if(arena.colorCycle!==cycle)return;
    sign.innerHTML=`<span class="sign-label">PHASE 2 — SAFE COLOR</span>${ARENA_COLOR_NAMES[safeColor]} ✓`;
    sign.style.background=ARENA_COLORS[safeColor];
    $("arena-hint").textContent=`RUN TO ${ARENA_COLOR_NAMES[safeColor]}! Tiles marked ✕ will ignite and stay lethal.`;
  },revealDelay);
  const warningDelay=Math.max(revealDelay,dangerAt-Date.now()-1400);
  setTimeout(()=>{if(arena.colorCycle===cycle)sign.classList.add("warning");},warningDelay);
  setTimeout(()=>{
    if(arena.colorCycle!==cycle)return;
    sign.classList.remove("warning");sign.classList.add("danger");
    sign.querySelector(".sign-label").textContent="DANGER — WRONG COLORS ARE LAVA";
  },Math.max(0,dangerAt-Date.now()));
}
function setArenaKey(key,down){arena.keys[key]=down;}
function jumpArena(){
  if(currentScreen!=="arena"||arena.done||!arena.player)return;
  if(arena.mode==="racing"){sound.beep(440,.08,"square",.025);return;}
  const now=Date.now();
  if(arena.mode==="flappy"){
    if(now-arena.lastJumpAt<95)return;
    arena.lastJumpAt=now;arena.player.vy=-285;socket.emit("arena:jump");
    sound.beep(520,.045,"sine",.018);return;
  }
  if(arena.mode==="runner"){
    if(now-arena.lastJumpAt<180||arena.player.y<324)return;
    arena.lastJumpAt=now;arena.player.vy=-420;socket.emit("arena:jump");
    sound.beep(360,.06,"square",.022);return;
  }
  if(now-arena.lastJumpAt<1000)return;
  arena.lastJumpAt=now;
  if(arena.mode==="fire"){socket.emit("arena:jump");sound.beep(120,.08,"square",.03);return;}
  arena.player.jumpingUntil=now+620;
  socket.emit("arena:jump");
}
window.addEventListener("keydown",(e)=>{
  if(currentScreen!=="arena")return;
  const map={ArrowLeft:"left",a:"left",A:"left",ArrowRight:"right",d:"right",D:"right",ArrowUp:"up",w:"up",W:"up",ArrowDown:"down",s:"down",S:"down"};
  if(map[e.key]){setArenaKey(map[e.key],true);e.preventDefault();}
  if(e.code==="Space"&&!e.repeat){jumpArena();e.preventDefault();}
});
window.addEventListener("keyup",(e)=>{
  const map={ArrowLeft:"left",a:"left",A:"left",ArrowRight:"right",d:"right",D:"right",ArrowUp:"up",w:"up",W:"up",ArrowDown:"down",s:"down",S:"down"};
  if(map[e.key])setArenaKey(map[e.key],false);
});
document.querySelectorAll("[data-arena]").forEach((b)=>{
  const key=b.dataset.arena,down=(e)=>{e.preventDefault();setArenaKey(key,true);},up=(e)=>{e.preventDefault();setArenaKey(key,false);};
  b.addEventListener("pointerdown",down);b.addEventListener("pointerup",up);
  b.addEventListener("pointercancel",up);b.addEventListener("pointerleave",up);
});
$("arena-jump").addEventListener("click",jumpArena);

// ===================== CHOOSE A DOOR =====================
const doors={
  state:null,selected:null,revealed:false,player:null,players:new Map(),keys:{},
  raf:0,lastSent:0,renderer:null,revealAt:0
};
const DOOR_EFFECTS={safe:["✅","SAFE!"],damage:["💔","OUCH!"],inconvenience:["🌀","NEXT PICK SCRAMBLED!"],eliminate:["💥","ELIMINATED!"]};
function applyDoorsChoose(payload){
  state.mode="doors";state.deadline=payload.deadline;
  doors.state=payload;doors.selected=null;doors.revealed=false;
  doors.players=new Map();
  updateDoorPlayers(payload.players||[]);
  const me=doors.players.get(state.selfId);
  doors.player={x:me?.x??360,y:me?.y??390,vx:0,vy:0};
  $("doors-round").textContent=legPrefix()+`Round ${payload.roundNumber} · Door ${payload.stage} of ${payload.maxStages}`;
  $("doors-title").textContent="Choose a door!";
  $("doors-hint").textContent="Choose quickly. Unchosen players get a random door.";
  $("doors-status").textContent="";
  startDoorLoop();startTimer(payload.deadline,"doors-timer");showScreen("doors");
}
function applyDoorsReveal(payload){
  doors.state=payload;doors.revealed=true;stopTimer();
  doors.revealAt=performance.now();updateDoorPlayers(payload.players||[]);
  const me=payload.players.find((p)=>p.playerId===state.selfId);
  const effect=payload.effects[me?.choice];
  $("doors-title").textContent=DOOR_EFFECTS[effect]?.[1]||"Doors revealed!";
  $("doors-hint").textContent=payload.stage<payload.maxStages?"Next choice coming up…":"That was the final door.";
  $("doors-status").textContent=me?.eliminated?"You’re out—watch the survivors.":`You have ${me?.hearts||0} heart${me?.hearts===1?"":"s"} left.`;
  renderDoors();
}
function updateDoorPlayers(players){
  for(const p of players||[]){
    if(p.playerId===state.selfId){
      if(doors.player&&Number.isFinite(p.x)){doors.player.serverX=p.x;doors.player.serverY=p.y;}
      doors.players.set(p.playerId,{...(doors.players.get(p.playerId)||{}),...p});
    }else{
      const old=doors.players.get(p.playerId);
      doors.players.set(p.playerId,old?{...old,...p,tx:p.x,ty:p.y,x:old.x,y:old.y}:{...p,tx:p.x,ty:p.y});
    }
  }
}
function startDoorLoop(){
  let previous=performance.now();
  const frame=(now)=>{
    const dt=Math.min(.035,(now-previous)/1000);previous=now;
    for(const [id,p]of doors.players){
      if(id===state.selfId||!Number.isFinite(p.tx))continue;
      const blend=1-Math.pow(.001,dt);p.x+=(p.tx-p.x)*blend;p.y+=(p.ty-p.y)*blend;
    }
    if(!doors.revealed&&doors.player&&!Number.isInteger(doors.selected)){
      const p=doors.player,ax=((doors.keys.right?1:0)-(doors.keys.left?1:0))*900;
      const ay=((doors.keys.down?1:0)-(doors.keys.up?1:0))*900;
      p.vx=(p.vx+ax*dt)*Math.pow(.025,dt);p.vy=(p.vy+ay*dt)*Math.pow(.025,dt);
      const speed=Math.hypot(p.vx,p.vy),max=230;if(speed>max){p.vx*=max/speed;p.vy*=max/speed;}
      p.x=Math.max(18,Math.min(702,p.x+p.vx*dt));p.y=Math.max(45,Math.min(410,p.y+p.vy*dt));
      if(now-doors.lastSent>45){doors.lastSent=now;socket.emit("doors:position",{x:p.x,y:p.y});}
    }
    renderDoors(now);
    if(currentScreen==="doors")doors.raf=requestAnimationFrame(frame);
  };
  cancelAnimationFrame(doors.raf);doors.raf=requestAnimationFrame(frame);
}
function renderDoors(){
  const now=arguments[0]||performance.now(),canvas=$("doors-canvas");
  if(!doors.renderer||doors.renderer.canvas!==canvas)doors.renderer=new Arena25D(canvas);
  const r=doors.renderer,ctx=r.ctx;r.backdrop("night",now);
  for(let row=0;row<8;row++)for(let col=0;col<8;col++)r.tile(col*90,row*55,90,55,{
    fill:(row+col)%2?"#405477":"#344865",side:"#172238",thickness:5,stroke:"rgba(255,255,255,.1)"
  });
  for(let i=0;i<4;i++){
    const center=r.project(i*180+90,40,-8),effect=doors.revealed?doors.state.effects[i]:null;
    const open=doors.revealed?Math.min(1,(now-doors.revealAt)/650):0;
    ctx.save();ctx.translate(center.x,center.y);
    ctx.fillStyle="#24150f";ctx.fillRect(-48,-100,96,104);
    ctx.fillStyle=effect==="eliminate"?"#7f1d1d":effect==="safe"?"#166534":effect==="damage"?"#7c2d12":effect==="inconvenience"?"#5b21b6":"#7a4527";
    ctx.translate(open*42,0);ctx.transform(1,-open*.18,0,1,0,0);ctx.fillRect(-42,-94,84,94);
    ctx.strokeStyle="#d6a467";ctx.lineWidth=4;ctx.strokeRect(-42,-94,84,94);
    ctx.fillStyle="#fff";ctx.font="900 30px sans-serif";ctx.textAlign="center";ctx.fillText(String(i+1),0,-46);
    if(effect){ctx.font="900 12px sans-serif";ctx.fillText(DOOR_EFFECTS[effect][0]+" "+DOOR_EFFECTS[effect][1],0,-15);}
    ctx.restore();
  }
  const ordered=[...doors.players.entries()].sort((a,b)=>(a[1].y||0)-(b[1].y||0));
  for(const[id,remote]of ordered){
    const p=id===state.selfId?doors.player:remote;if(!p)continue;
    const projected=r.project(p.x,p.y,10),info=state.room?.players?.find((x)=>x.id===id);
    r.shadow(p.x,p.y,22,.35);
    PaperCharacter.draw(ctx,{x:projected.x,y:projected.y,size:58*projected.scale,
      avatar:info?.avatar||remote.avatar,state:doors.revealed?"celebrate":(Math.hypot(p.vx||0,p.vy||0)>10?"run":"idle"),
      direction:(p.vx||0)<0?-1:1,time:now});
    ctx.fillStyle="#07101e";ctx.font="bold 12px sans-serif";ctx.textAlign="center";
    ctx.fillText(id===state.selfId?"You":remote.name,projected.x,projected.y-38*projected.scale);
  }
  const box=$("doors-players");box.innerHTML="";
  for(const p of doors.state?.players||[]){
    const tag=document.createElement("span");tag.className="doors-player"+(p.eliminated?" out":"");
    tag.innerHTML=`${avatarHtml(p)} ${esc(p.name)} ${"❤".repeat(Math.max(0,p.hearts||0))}`;
    if(doors.revealed&&Number.isInteger(p.choice))tag.innerHTML+=` → ${p.choice+1}`;
    box.appendChild(tag);
  }
}
function setDoorKey(key,down){doors.keys[key]=down;}
window.addEventListener("keydown",(e)=>{
  if(currentScreen!=="doors")return;
  const map={ArrowLeft:"left",a:"left",A:"left",ArrowRight:"right",d:"right",D:"right",ArrowUp:"up",w:"up",W:"up",ArrowDown:"down",s:"down",S:"down"};
  if(map[e.key]){setDoorKey(map[e.key],true);e.preventDefault();}
});
window.addEventListener("keyup",(e)=>{
  const map={ArrowLeft:"left",a:"left",A:"left",ArrowRight:"right",d:"right",D:"right",ArrowUp:"up",w:"up",W:"up",ArrowDown:"down",s:"down",S:"down"};
  if(map[e.key])setDoorKey(map[e.key],false);
});
document.querySelectorAll("[data-door]").forEach((b)=>{
  const key=b.dataset.door,down=(e)=>{e.preventDefault();setDoorKey(key,true);},up=(e)=>{e.preventDefault();setDoorKey(key,false);};
  b.addEventListener("pointerdown",down);b.addEventListener("pointerup",up);
  b.addEventListener("pointercancel",up);b.addEventListener("pointerleave",up);
});

// ===================== RESULTS =====================
function renderResults(payload) {
  $("results-map-wrap").classList.add("hidden");
  if (payload.mode === "map") return renderMapResults(payload);
  if (payload.mode === "bomb") return renderBombResults(payload);
  if (payload.mode === "platformer") return renderPlatformerResults(payload);
  if (payload.mode === "drawing") return renderDrawingResults(payload);
  if (payload.mode === "pushy") return renderPushyResults(payload);
  if (payload.mode === "redlight") return renderRedLightResults(payload);
  if (payload.mode === "hidebomb") return renderHideBombResults(payload);
  if (payload.mode === "curling") return renderCurlingResults(payload);
  if (payload.mode === "racing") return renderRacingResults(payload);
  if (payload.mode === "painter") return renderPainterResults(payload);
  if (["colorfloor","vanish","bombpass","fire","flappy","runner","pong","doors"].includes(payload.mode)) return renderSurvivalResults(payload);

  state.unit = payload.unit || state.unit;
  $("results-caption").textContent = payload.mode === "timeline" ? "The event was in" : "Correct answer";
  $("correct-answer").textContent = `${fmt(payload.correctAnswer)} ${esc(payload.unit || "")}`.trim();
  $("results-head").classList.remove("hidden");

  if (payload.mode === "timeline" && payload.placedEvents) {
    renderTimelineViz($("results-timeline"), payload.placedEvents);
  } else {
    $("results-timeline").classList.add("hidden");
  }

  const list = $("result-list");
  list.innerHTML = "";
  const rows = [...payload.ranking, ...(payload.noAnswer || [])];
  const answered = payload.ranking.filter((r) => Number.isFinite(r.distance));
  const maxDistance = answered.reduce((m, r) => Math.max(m, r.distance), 0);

  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (r.playerId === state.selfId) li.classList.add("self");
    const rank = r.distance === null ? "—" : (i + 1);
    const guessText = r.guess === null ? "no answer" : `${fmt(r.guess)} ${esc(payload.unit || "")}`.trim();
    let barPct = 0;
    if (Number.isFinite(r.distance)) barPct = maxDistance === 0 ? 100 : Math.max(6, 100 - (r.distance / maxDistance) * 92);
    const isWin = i === 0 && Number.isFinite(r.distance);
    li.innerHTML =
      `<span class="rank">${isWin ? "🏆" : rank}</span>` +
      `<div class="r-main"><div class="r-top">` +
        `<span class="r-name">${esc(r.name)}</span>` +
        `<span class="r-guess">${guessText}</span></div>` +
        `<div class="bar-track"><div class="bar-fill ${isWin ? "win" : ""}" style="width:${barPct}%"></div></div>` +
      `</div>` +
      `<span class="r-points ${r.pointsAwarded ? "" : "zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  reactToMyRow(payload.ranking);
  updateResultsHostControls(payload.isFinalRound);
}
function renderPainterResults(payload){
  $("results-caption").textContent="Territory Painter";$("correct-answer").textContent="Largest painted territory wins";
  $("results-head").classList.remove("hidden");$("results-timeline").classList.add("hidden");
  const list=$("result-list");list.innerHTML="";
  payload.ranking.forEach((r,i)=>{const li=document.createElement("li");if(r.playerId===state.selfId)li.classList.add("self");
    li.innerHTML=`<span class="rank">${i===0?"🎨":i+1}</span><div class="r-main"><div class="r-top"><span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span><span class="r-guess">${r.percent}% · ${r.cells} tiles</span></div></div><span class="r-points">+${r.pointsAwarded}</span>`;list.appendChild(li);});
  reactToMyRow(payload.ranking);updateResultsHostControls(payload.isFinalRound);
}

function renderPlatformerResults(payload) {
  platformer.phase = "results";
  cancelAnimationFrame(platformer.raf);
  $("results-caption").textContent = payload.soloBonus ? "Only one racer made it — bonus!" : "Race complete";
  $("correct-answer").textContent = "🏁 Build & Race";
  $("results-head").classList.remove("hidden");
  $("results-timeline").classList.add("hidden");
  const list = $("result-list");
  list.innerHTML = "";
  payload.ranking.forEach((r, i) => {
    const li = document.createElement("li");
    if (r.playerId === state.selfId) li.classList.add("self");
    li.innerHTML = `<span class="rank">${r.reached ? (i === 0 ? "🏆" : "🏁") : "💀"}</span>` +
      `<div class="r-main"><div class="r-top"><span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span>` +
      `<span class="r-guess">${r.reached ? `${(r.timeMs/1000).toFixed(1)}s` : "did not finish"}</span></div></div>` +
      `<span class="r-points ${r.pointsAwarded ? "" : "zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  reactToMyRow(payload.ranking);
  updateResultsHostControls(payload.isFinalRound);
}

function renderDrawingResults(payload) {
  drawing.active = false;
  $("results-caption").textContent = "The secret word was";
  $("correct-answer").textContent = payload.word;
  $("results-head").classList.remove("hidden"); $("results-timeline").classList.add("hidden");
  const list = $("result-list"); list.innerHTML = "";
  payload.ranking.forEach((r) => {
    const li = document.createElement("li");
    if (r.playerId === state.selfId) li.classList.add("self");
    li.innerHTML = `<span class="rank">${r.wasDrawer ? "🎨" : (r.guessed ? "✅" : "❌")}</span>` +
      `<div class="r-main"><div class="r-top"><span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span>` +
      `<span class="r-guess">${r.wasDrawer ? "artist" : (r.guessed ? "guessed it" : "missed")}</span></div></div>` +
      `<span class="r-points ${r.pointsAwarded ? "" : "zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  reactToMyRow(payload.ranking); updateResultsHostControls(payload.isFinalRound);
}

function renderPushyResults(payload) {
  pushy.phase = "results"; cancelAnimationFrame(pushy.raf);
  $("results-caption").textContent = "Platform survival";
  $("correct-answer").textContent = `${payload.survivors} survived`;
  $("results-head").classList.remove("hidden"); $("results-timeline").classList.add("hidden");
  const list = $("result-list"); list.innerHTML = "";
  payload.ranking.forEach((r) => {
    const li = document.createElement("li");
    if (r.playerId === state.selfId) li.classList.add("self");
    li.innerHTML = `<span class="rank">${r.survived ? "🏆" : "🌊"}</span>` +
      `<div class="r-main"><div class="r-top"><span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span>` +
      `<span class="r-guess">${r.survived ? "survived" : `${(r.timeMs/1000).toFixed(1)}s`}</span></div></div>` +
      `<span class="r-points ${r.pointsAwarded ? "" : "zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  reactToMyRow(payload.ranking); updateResultsHostControls(payload.isFinalRound);
}

function renderRedLightResults(payload) {
  stopRedLightMove();
  $("results-caption").textContent = "Red Light, Green Light";
  $("correct-answer").textContent = payload.ranking.some((r) => r.finished) ? "🏁 Race complete" : "🚦 Time’s up";
  $("results-head").classList.remove("hidden"); $("results-timeline").classList.add("hidden");
  const list = $("result-list"); list.innerHTML = "";
  payload.ranking.forEach((r, index) => {
    const li = document.createElement("li");
    if (r.playerId === state.selfId) li.classList.add("self");
    const result = r.isController ? `light controller · caught ${r.caught}` : r.finished ? `${(r.finishMs/1000).toFixed(1)}s` :
      (r.eliminated ? `caught at ${r.progress}%` : `${r.progress}%`);
    li.innerHTML = `<span class="rank">${r.isController ? "🚦" : (r.finished ? (index === 0 ? "🏆" : "🏁") : (r.eliminated ? "💥" : "⏱️"))}</span>` +
      `<div class="r-main"><div class="r-top"><span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span>` +
      `<span class="r-guess">${result}</span></div></div>` +
      `<span class="r-points ${r.pointsAwarded ? "" : "zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  reactToMyRow(payload.ranking); updateResultsHostControls(payload.isFinalRound);
}

function renderHideBombResults(payload) {
  $("results-caption").textContent = "Hide and Go BOOM!";
  const survivors = payload.ranking.filter((r) => r.survived).length;
  $("correct-answer").textContent = survivors ? `${survivors} escaped!` : "Bomber wins! 💥";
  $("results-head").classList.remove("hidden"); $("results-timeline").classList.add("hidden");
  const list = $("result-list"); list.innerHTML = "";
  payload.ranking.forEach((r) => {
    const li = document.createElement("li");
    if (r.playerId === state.selfId) li.classList.add("self");
    li.innerHTML = `<span class="rank">${r.wasBomber ? "💣" : (r.survived ? "🏆" : "💥")}</span>` +
      `<div class="r-main"><div class="r-top"><span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span>` +
      `<span class="r-guess">${r.wasBomber ? "bomber" : (r.survived ? "escaped" : "eliminated")}</span></div></div>` +
      `<span class="r-points ${r.pointsAwarded ? "" : "zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  reactToMyRow(payload.ranking); updateResultsHostControls(payload.isFinalRound);
}

function renderSurvivalResults(payload) {
  cancelAnimationFrame(arena.raf);
  const labels={colorfloor:"Color Twister",vanish:"Vanishing Grid",bombpass:"Bomb Pass",fire:"Playing with Fire",flappy:"Dragon Rider",runner:"Wild Run",pong:"Polygon Pong",doors:"Choose a Door"};
  $("results-caption").textContent=labels[payload.mode]||"Survival";
  const survivors=payload.ranking.filter((r)=>r.survived).length;
  $("correct-answer").textContent=survivors?`${survivors} survived!`:"Nobody survived!";
  $("results-head").classList.remove("hidden");$("results-timeline").classList.add("hidden");
  const list=$("result-list");list.innerHTML="";
  payload.ranking.forEach((r,i)=>{
    const li=document.createElement("li");if(r.playerId===state.selfId)li.classList.add("self");
    const detail=["flappy","runner"].includes(payload.mode)?`${r.distance||0} m`:(r.survived?(payload.mode==="doors"?`${r.hearts} hearts left`:payload.mode==="pong"?"last paddle standing":"survived"):
      (r.reason==="exploded"?"bomb exploded":r.reason==="blast"?"caught in a blast":r.reason==="lava"?"caught by lava":r.reason==="fell"?"fell through":"eliminated"));
    li.innerHTML=`<span class="rank">${r.survived?(i===0?"🏆":"✅"):"💥"}</span>`+
      `<div class="r-main"><div class="r-top"><span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span>`+
      `<span class="r-guess">${detail}</span></div></div>`+
      `<span class="r-points ${r.pointsAwarded?"":"zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  reactToMyRow(payload.ranking);updateResultsHostControls(payload.isFinalRound);
}

function renderRacingResults(payload){
  cancelAnimationFrame(arena.raf);
  $("results-caption").textContent="Pocket Racers";
  $("correct-answer").textContent="Race results";
  $("results-head").classList.remove("hidden");$("results-timeline").classList.add("hidden");
  const list=$("result-list");list.innerHTML="";
  payload.ranking.forEach((r,i)=>{
    const li=document.createElement("li");if(r.playerId===state.selfId)li.classList.add("self");
    const detail=r.finished?`${(r.timeMs/1000).toFixed(2)}s`:`${r.lap}/3 laps`;
    li.innerHTML=`<span class="rank">${i===0?"🏆":i+1}</span><div class="r-main"><div class="r-top">`+
      `<span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span><span class="r-guess">${detail}</span>`+
      `</div></div><span class="r-points">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  reactToMyRow(payload.ranking);updateResultsHostControls(payload.isFinalRound);
}

function renderCurlingResults(payload){
  cancelAnimationFrame(curlingVisual.raf);
  $("results-caption").textContent="Curling";
  $("correct-answer").textContent="Three stones each — highest zone total wins";
  $("results-head").classList.remove("hidden");$("results-timeline").classList.add("hidden");
  const list=$("result-list");list.innerHTML="";
  payload.ranking.forEach((r,i)=>{
    const li=document.createElement("li");if(r.playerId===state.selfId)li.classList.add("self");
    li.innerHTML=`<span class="rank">${i===0?"🥌":i+1}</span><div class="r-main"><div class="r-top">`+
      `<span class="r-name">${avatarHtml(r.avatar)} ${esc(r.name)}</span>`+
      `<span class="r-guess">${r.score||0} zone points</span></div></div>`+
      `<span class="r-points ${r.pointsAwarded?"":"zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  reactToMyRow(payload.ranking);updateResultsHostControls(payload.isFinalRound);
}

/** Play a character reaction based on how I did this round. */
function reactToMyRow(ranking) {
  const me = (ranking || []).find((r) => r.playerId === state.selfId);
  if (!me) return sound.neutral();
  if (me.pointsAwarded >= 100) sound.happy();
  else if (!me.pointsAwarded) sound.sad();
  else sound.neutral();
}

function renderBombResults(payload) {
  $("results-caption").textContent = "🎈 POP!";
  const ca = $("correct-answer");
  ca.textContent = `${esc(payload.popperName || "?")} popped it!`;
  ca.classList.remove("boom"); void ca.offsetWidth; ca.classList.add("boom");
  $("results-head").classList.remove("hidden");
  $("results-timeline").classList.add("hidden");

  const list = $("result-list");
  list.innerHTML = "";
  payload.ranking.forEach((r) => {
    const li = document.createElement("li");
    if (r.playerId === state.selfId) li.classList.add("self");
    li.innerHTML =
      `<span class="rank">${r.survived ? "🙂" : "💥"}</span>` +
      `<div class="r-main"><div class="r-top">` +
        `<span class="r-name">${esc(r.name)}</span>` +
        `<span class="r-guess">${r.survived ? "survived" : "popped it"}</span></div></div>` +
      `<span class="r-points ${r.pointsAwarded ? "" : "zero"}">+${r.pointsAwarded}</span>`;
    list.appendChild(li);
  });
  const meB = payload.ranking.find((r) => r.playerId === state.selfId);
  if (meB) { if (meB.survived) sound.happy(); else sound.sad(); }
  updateResultsHostControls(payload.isFinalRound);
}

function updateResultsHostControls(isFinalRound) {
  const arc = state.room && state.room.arcade;
  const moreLegs = arc && arc.legIndex < arc.totalLegs - 1;
  const label = isFinalRound
    ? (moreLegs ? "Next game →" : "See final results")
    : "Next round";
  if (state.isHost) {
    $("next-btn").textContent = label;
    $("next-btn").classList.remove("hidden");
    $("results-host-note").textContent = "";
  } else {
    $("next-btn").classList.add("hidden");
    $("results-host-note").textContent = "Waiting for the host to continue.";
  }
}

// ===================== FINAL (animated) =====================
function renderFinal(payload, { silent = false } = {}) {
  showScreen("final");
  const standings = payload.standings || [];
  const top = standings.slice(0, 3);

  $("final-kicker").textContent = "FINAL RESULTS";
  $("final-announce").textContent = "…";
  $("winner-score").textContent = "";
  $("podium").innerHTML = "";
  $("final-list").innerHTML = "";
  updateFinalHostControls();

  // Staged, announced reveal.
  const stages = [];
  if (top.length >= 3) stages.push({ place: 3, s: top[2] });
  if (top.length >= 2) stages.push({ place: 2, s: top[1] });
  stages.push({ place: 1, s: top[0] });

  // Build podium columns (order: 2, 1, 3 visually).
  const podium = $("podium");
  const order = [top[1], top[0], top[2]].filter(Boolean);
  const placeOf = new Map(top.map((s, i) => [s.playerId, i + 1]));
  order.forEach((s) => {
    const place = placeOf.get(s.playerId);
    const col = document.createElement("div");
    col.className = `pod pod-${place} hidden-pod`;
    col.innerHTML =
      `<div class="pod-medal">${["🥇","🥈","🥉"][place-1]}</div>` +
      `<div class="pod-ava">${avatarHtml(s.avatar)}</div>` +
      `<div class="pod-name">${esc(s.name)}</div>` +
      `<div class="pod-bar"><span class="pod-score" data-target="${s.score}">0</span></div>`;
    podium.appendChild(col);
  });

  let delay = silent ? 0 : 500;
  const step = silent ? 0 : 1100;
  stages.forEach((st, idx) => {
    setTimeout(() => {
      if (!st.s) return;
      const place = st.place;
      $("final-announce").textContent =
        place === 1 ? `🥇 ${st.s.name} wins!` : `${["","","🥈","🥉"][place]} ${place===2?"2nd":"3rd"}: ${st.s.name}`;
      const col = podium.querySelector(`.pod-${place}`);
      if (col) { col.classList.remove("hidden-pod"); countUp(col.querySelector(".pod-score"), st.s.score); }
      if (!silent) sound.beep(place === 1 ? 900 : 600, 0.15, "triangle");
      if (place === 1) {
        $("final-kicker").textContent = payload.winner ? "WINNER" : "WINNERS";
        $("winner-score").textContent = `${fmt(st.s.score)} points`;
        if (!silent) {
          launchConfetti(); sound.chord([523, 659, 784, 1047]);
          const myIdx = standings.findIndex((s) => s.playerId === state.selfId);
          setTimeout(() => {
            if (myIdx === 0) sound.happy();
            else if (myIdx === standings.length - 1) sound.sad();
            else sound.neutral();
          }, 500);
        }
        renderFinalList(standings);
      }
    }, delay + idx * step);
  });
  if (silent) renderFinalList(standings);
}

function renderFinalList(standings) {
  const list = $("final-list");
  list.innerHTML = "";
  standings.forEach((s, i) => {
    const li = document.createElement("li");
    if (s.playerId === state.selfId) li.classList.add("self");
    const medal = ["🥇","🥈","🥉"][i] || (i + 1);
    li.innerHTML =
      `<span class="rank">${medal}</span>` +
      `<div class="r-main"><div class="r-top"><span class="r-name">${avatarHtml(s.avatar)} ${esc(s.name)}</span></div></div>` +
      `<span class="r-points">${fmt(s.score)}</span>`;
    list.appendChild(li);
  });
}

function countUp(el, target) {
  if (!el) return;
  const dur = 800;
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur);
    el.textContent = fmt(Math.round(target * p));
    if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(target);
  };
  requestAnimationFrame(tick);
}

function updateFinalHostControls() {
  if (state.isHost) {
    $("playagain-btn").classList.remove("hidden");
    $("final-host-note").textContent = "";
  } else {
    $("playagain-btn").classList.add("hidden");
    $("final-host-note").textContent = "Waiting for the host to play again.";
  }
}

// ===================== BANNER / TIMER / CONFETTI =====================
let bannerTimer = null;
function showBanner(text, autoHideMs) {
  const b = $("banner");
  b.textContent = text; b.classList.remove("hidden");
  if (bannerTimer) clearTimeout(bannerTimer);
  if (autoHideMs) bannerTimer = setTimeout(hideBanner, autoHideMs);
}
function hideBanner() {
  if (bannerTimer) { clearTimeout(bannerTimer); bannerTimer = null; }
  $("banner").classList.add("hidden");
}

function startTimer(deadline, elId) {
  stopTimer();
  const el = $(elId);
  if (!deadline) { if (el) el.textContent = ""; return; }
  let lastBeep = null;
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (el) { el.textContent = `${remaining}s`; el.classList.toggle("urgent", remaining <= 5); }
    if (remaining <= 5 && remaining >= 1 && remaining !== lastBeep && !state.submitted) {
      sound.beep(300, 0.05, "square", 0.03); lastBeep = remaining;
    }
    if (remaining <= 0) stopTimer();
  };
  tick();
  timerInterval = setInterval(tick, 250);
}
function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

function launchConfetti() {
  const host = $("confetti");
  host.innerHTML = "";
  const colors = ["#ffcb3d", "#4ade80", "#ff6b6b", "#60a5fa", "#f472b6"];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("i");
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = (1.6 + Math.random() * 1.8) + "s";
    piece.style.animationDelay = (Math.random() * 0.8) + "s";
    host.appendChild(piece);
  }
  setTimeout(() => { host.innerHTML = ""; }, 4200);
}

// ===================== INIT =====================
buildCreator();
initMap();
(function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const code = (params.get("room") || "").trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(code)) {
    $("code-input").value = code;
    setTimeout(() => $("name-input").focus(), 50);
  }
})();
