"use strict";

const { GAME_STATES } = require("./roomManager");
const { calculateRoundScores, haversineKm } = require("./scoring");
const { pointInCountry } = require("./geoCountries");
const {
  toPublicQuestion,
  pickQuestions,
  availableQuestionCount
} = require("./questionManager");
const VanishMaps = require("../public/vanishMaps.js"); // shared vanish maps (server + client)

/** Fallback round duration if a room has no settings (Version 0.2 default). */
const ROUND_DURATION_MS = 45 * 1000;

/** Guess bounds (see spec §11). */
const GUESS_MIN = -1_000_000_000;
const GUESS_MAX = 1_000_000_000_000;

/** Bomb mode tuning. */
const BOMB_MIN_THRESHOLD = 6;
const BOMB_MAX_THRESHOLD = 22;
const BOMB_SURVIVOR_POINTS = 50;

const RACE_TRACKS = [
  {
    id:"square",
    width:92,
    points:[[130,90],[590,90],[640,140],[640,320],[590,370],[130,370],[80,320],[80,140]],
    checkpoints:[[640,230],[360,370],[80,230],[360,90]]
  },
  {
    id:"swing",
    width:82,
    points:[[110,100],[310,70],[520,105],[630,190],[540,260],[630,350],[390,375],[250,310],[90,350],[120,220],[260,205]],
    checkpoints:[[575,148],[585,305],[320,343],[105,285],[210,85]]
  }
];

function distanceToSegment(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((px-x1)*dx+(py-y1)*dy)/length)):0;
  return Math.hypot(px-(x1+t*dx),py-(y1+t*dy));
}
function raceGateNormal(track,gate){
  let best={distance:Infinity,nx:0,ny:1};
  for(let i=0;i<track.points.length;i++){
    const a=track.points[i],b=track.points[(i+1)%track.points.length],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy)||1;
    const distance=distanceToSegment(gate[0],gate[1],a[0],a[1],b[0],b[1]);
    if(distance<best.distance)best={distance,nx:-dy/length,ny:dx/length};
  }
  return best;
}
function segmentsIntersect(ax,ay,bx,by,cx,cy,dx,dy){
  const cross=(px,py,qx,qy,rx,ry)=>(qx-px)*(ry-py)-(qy-py)*(rx-px);
  const a=cross(ax,ay,bx,by,cx,cy),b=cross(ax,ay,bx,by,dx,dy);
  const c=cross(cx,cy,dx,dy,ax,ay),d=cross(cx,cy,dx,dy,bx,by);
  return ((a<=0&&b>=0)||(a>=0&&b<=0))&&((c<=0&&d>=0)||(c>=0&&d<=0));
}

/** Vanishing Grid (Fall-Guys style) — a finite square platform + stacked floors.
 *  The platform sits inside the 720x440 world with a void margin, so a player
 *  who walks off the edge falls into the void. */
const VANISH_LAYERS = VanishMaps.G.layers;   // grid dims come from the shared maps module
const PLAT = { ...VanishMaps.G };             // so server + client can never disagree
/** Which platform cell a world position is over, or null if off the edge. */
function tileCellAt(x, y) {
  const col = Math.floor((x - PLAT.x0) / PLAT.tw);
  const row = Math.floor((y - PLAT.y0) / PLAT.th);
  if (col < 0 || col >= PLAT.cols || row < 0 || row >= PLAT.rows) return null;
  return { col, row };
}
/** Every cell the player's footprint overlaps — so standing between two (or
 *  four) tiles activates all of them, like real Hex-A-Gone. */
const PLAT_FOOT = 0.16; // small circular contact patch beneath the character's feet
function tileCellsUnder(x, y) {
  const radius = Math.min(PLAT.tw, PLAT.th) * PLAT_FOOT;
  const seen = new Set(), out = [];
  const pts = [[x, y], [x - radius, y], [x + radius, y], [x, y - radius], [x, y + radius]];
  for (const [px, py] of pts) {
    const col = Math.floor((px - PLAT.x0) / PLAT.tw);
    const row = Math.floor((py - PLAT.y0) / PLAT.th);
    if (col < 0 || col >= PLAT.cols || row < 0 || row >= PLAT.rows) continue;
    const k = col * 100 + row;
    if (seen.has(k)) continue;
    seen.add(k); out.push({ col, row });
  }
  return out;
}
const VANISH_LAND_BONUS = 350; // brief, visible breathing room after landing
const HIDE_BOMB_HIDE_MS = 10000;
const HIDE_BOMB_PICK_MS = 10000;
const HIDE_BOMB_IGNITE_MS = 2200;
const HIDE_BOMB_REVEAL_MS = 3200;
const DRAWING_WORDS = [
  "airplane", "apple", "bicycle", "birthday cake", "castle", "cat", "coffee",
  "dinosaur", "dragon", "fire truck", "guitar", "ice cream", "lighthouse",
  "moon", "octopus", "penguin", "pizza", "rainbow", "robot", "snowman",
  "spaceship", "spider", "toothbrush", "train", "volcano"
];

const SIMULTANEOUS_MODES = new Set(["trivia", "map"]);
const TURN_MODES = new Set(["curling", "bomb"]);

/**
 * Drives the game loop for all rooms and every game mode. Server-authoritative:
 * it selects content, validates actions, computes scores and controls all state
 * transitions. Side effects (emitting, timers) are injected for testability.
 */
class GameManager {
  constructor(roomManager, deps = {}) {
    this.roomManager = roomManager;
    this.emitRoom = deps.emitRoom ?? (() => {});
    this.emitSocket = deps.emitSocket ?? (() => {});
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));
    this.minPlayersToStart = deps.minPlayersToStart ?? 2;
    this.defaultRoundMs = deps.roundDurationMs ?? ROUND_DURATION_MS;
    /** @type {Map<string, *>} room code -> active timer handle */
    this.timers = new Map();
  }

  // ---- helpers --------------------------------------------------------------

  roundDurationMs(room) {
    const secs = room.settings?.roundSeconds;
    return Number.isFinite(secs) ? secs * 1000 : this.defaultRoundMs;
  }

  /** Per-turn duration for turn-based modes (a bit shorter than a full round). */
  turnDurationMs(room) {
    return Math.min(this.roundDurationMs(room), 20 * 1000);
  }

  mode(room) {
    // In arcade play, the current leg's mode overrides the lobby's single mode.
    return room.currentMode ?? room.settings?.mode ?? "trivia";
  }

  /** Content-availability check for a mode; returns an error string or null. */
  contentError(room, mode, categories) {
    if (["bomb", "platformer", "drawing", "pushy", "redlight", "hidebomb", "colorfloor", "vanish", "bombpass", "fire", "racing", "flappy", "runner", "painter", "pong", "doors"].includes(mode)) return null;
    if (mode === "timeline") {
      const connected = this.roomManager.connectedPlayers(room).length;
      if (availableQuestionCount("timeline", categories) < connected + 4) {
        return "Not enough events for the Timeline categories.";
      }
      return null;
    }
    if (availableQuestionCount(mode, categories) < 1) {
      return "No questions available for these settings.";
    }
    return null;
  }

  // ---- start ----------------------------------------------------------------

  /**
   * Attempt to start the game. Only the host may start; the room must be in the
   * lobby with enough connected players and (for question modes) enough content.
   */
  startGame(room, socketId) {
    if (!room) return { ok: false, error: "Room not found." };
    if (socketId !== room.hostId) {
      return { ok: false, error: "Only the host can start the game." };
    }
    if (room.state !== GAME_STATES.LOBBY) {
      return { ok: false, error: "The game has already started." };
    }
    const connected = this.roomManager.connectedPlayers(room);
    if (connected.length < this.minPlayersToStart) {
      return {
        ok: false,
        error: `Need at least ${this.minPlayersToStart} players to start.`
      };
    }

    const settings = room.settings ?? {};
    room.totalRounds = settings.rounds ?? room.totalRounds ?? 5;

    // Determine the sequence of modes to play (a playlist in arcade, else one).
    const playlist = settings.arcade && Array.isArray(settings.playlist) && settings.playlist.length
      ? settings.playlist.slice()
      : [settings.mode ?? "trivia"];

    // Validate content for every mode we intend to play before committing.
    for (const m of playlist) {
      const err = this.contentError(room, m, settings.categories);
      if (err) return { ok: false, error: err };
    }

    room.arcade = settings.arcade && playlist.length > 1
      ? { playlist, legIndex: -1, battle: true, target: settings.battleTarget ?? 5,
          wins: {}, spinnerIndex: 0, spinnerId: connected[0].id, awaitingSpin: true,
          pendingMode: null, previousMode: null, modeHistory: [], scoresAtLegStart: {} }
      : null;
    room.currentMode = room.arcade ? null : playlist[0];
    // Curling is a compact best-of-two-set match. Each set still gives every
    // player the full three stones.
    if (!room.arcade && room.currentMode === "curling") room.totalRounds = Math.min(2, room.totalRounds);

    // Reset scores ONCE for the whole session (arcade scores carry across legs).
    for (const player of Object.values(room.players)) {
      player.score = 0;
      player.guess = null;
      player.cards = [];
    }
    room.lastActivity = Date.now();

    if (room.arcade?.battle) {
      for (const player of connected) room.arcade.wins[player.id] = 0;
      this.showBattleWheel(room, { first: true });
    } else {
      this.beginMode(room);
    }
    return { ok: true };
  }

  battleStandings(room) {
    const wins = room.arcade?.wins ?? {};
    return Object.values(room.players)
      .map((p) => ({ playerId: p.id, name: p.name, avatar: p.avatar,
        wins: wins[p.id] ?? 0, score: wins[p.id] ?? 0, points: p.score ?? 0 }))
      .sort((a, b) => b.wins - a.wins || b.points - a.points);
  }

  showBattleWheel(room, extra = {}) {
    this.disarmTimer(room);
    const battle = room.arcade;
    const connected = this.roomManager.connectedPlayers(room);
    if (!battle || !connected.length) return;
    battle.spinnerIndex %= connected.length;
    battle.spinnerId = connected[battle.spinnerIndex].id;
    battle.ceremonyPending = !extra.first && !!extra.lastWinners?.length;
    battle.awaitingSpin = !battle.ceremonyPending;
    battle.pendingMode = null;
    room.state = GAME_STATES.INTERMISSION;
    room.deadline = null;
    const payload = { battle: true, awaitingSpin: battle.awaitingSpin, ceremonyPending:battle.ceremonyPending, first: !!extra.first,
      spinnerId: battle.spinnerId, spinnerName: room.players[battle.spinnerId]?.name,
      options: battle.playlist, target: battle.target, wins: battle.wins,
      standings: this.battleStandings(room), lastWinners: extra.lastWinners ?? [] };
    room.lastIntermission = payload;
    this.emitRoom(room.code, "arcade:intermission", payload);
    if (battle.awaitingSpin && room.players[battle.spinnerId]?.isBot) {
      const botWheelTimer = this.setTimer(() => this.spinBattleWheel(room, battle.spinnerId), 1200);
      this.timers.set(room.code, botWheelTimer);
    }
  }

  proceedBattleCeremony(room,socketId){
    const battle=room?.arcade;
    if(!room||room.state!==GAME_STATES.INTERMISSION||!battle?.battle||!battle.ceremonyPending)
      return {ok:false,error:"There is no star ceremony to continue."};
    if(socketId!==room.hostId)return {ok:false,error:"Only the host can continue to the wheel."};
    battle.ceremonyPending=false;battle.awaitingSpin=true;
    if(room.lastIntermission){room.lastIntermission.ceremonyPending=false;room.lastIntermission.awaitingSpin=true;}
    this.emitRoom(room.code,"battle:ceremony-ended",{spinnerId:battle.spinnerId,spinnerName:room.players[battle.spinnerId]?.name});
    if(room.players[battle.spinnerId]?.isBot){
      const timer=this.setTimer(()=>this.spinBattleWheel(room,battle.spinnerId),1200);this.timers.set(room.code,timer);
    }
    return {ok:true};
  }

  spinBattleWheel(room, socketId) {
    const battle = room?.arcade;
    if (!room || room.state !== GAME_STATES.INTERMISSION || !battle?.battle || !battle.awaitingSpin) {
      return { ok: false, error: "The wheel is not ready to spin." };
    }
    if (socketId !== battle.spinnerId) return { ok: false, error: "It is another player's turn to spin." };
    const weighted=this.battleModeWeights(battle);
    const totalWeight=weighted.reduce((sum,item)=>sum+item.weight,0);
    let roll=Math.random()*totalWeight,selectedMode=weighted.at(-1)?.mode;
    for(const item of weighted){roll-=item.weight;if(roll<=0){selectedMode=item.mode;break;}}
    battle.awaitingSpin = false;
    battle.pendingMode = selectedMode;
    battle.modeHistory.push(selectedMode);
    if(battle.modeHistory.length>8)battle.modeHistory.shift();
    this.emitRoom(room.code, "battle:wheel-result", { selectedMode, options: battle.playlist, spinnerId: socketId });
    this.disarmTimer(room);
    const wheelTimer = this.setTimer(() => {
      if (room.state !== GAME_STATES.INTERMISSION || battle.pendingMode !== selectedMode) return;
      const startsAt=Date.now()+3000;
      this.emitRoom(room.code,"battle:countdown",{mode:selectedMode,startsAt,seconds:3});
      const countdownTimer=this.setTimer(()=>{
        if(room.state!==GAME_STATES.INTERMISSION||battle.pendingMode!==selectedMode)return;
        battle.legIndex += 1;
        battle.previousMode = selectedMode;
        battle.pendingMode = null;
        room.currentMode = selectedMode;
        battle.scoresAtLegStart = Object.fromEntries(Object.values(room.players).map((p) => [p.id, p.score ?? 0]));
        this.emitRoom(room.code, "battle:started", { legIndex: battle.legIndex, mode: selectedMode });
        this.beginMode(room);
      },3000);
      this.timers.set(room.code,countdownTimer);
    }, 3400);
    this.timers.set(room.code, wheelTimer);
    return { ok: true, selectedMode };
  }

  battleModeWeights(battle){
    const playlist=[...new Set(battle?.playlist||[])],history=battle?.modeHistory||[];
    if(playlist.length<=1)return playlist.map((mode)=>({mode,weight:1}));
    return playlist.map((mode)=>{
      const reverseAge=[...history].reverse().findIndex((played)=>played===mode);
      // No immediate repeat. Recent games then recover from 12% -> 35% ->
      // 65% before returning to their normal wheel probability.
      const weight=reverseAge < 0 ? 1 : reverseAge === 0 ? 0 :
        reverseAge === 1 ? .12 : reverseAge === 2 ? .35 : reverseAge === 3 ? .65 : 1;
      return {mode,weight};
    });
  }

  /**
   * Set up and begin the current mode (one arcade "leg", or the whole game in
   * single-mode play). Does NOT reset scores — only per-leg state.
   */
  beginMode(room) {
    const settings = room.settings ?? {};
    const mode = this.mode(room);
    room.roundIndex = 0;
    room.placedEvents = [];
    room.lastResults = null;
    for (const player of Object.values(room.players)) {
      player.guess = null;
      player.cards = [];
    }

    if (mode === "timeline") {
      this.startTimelineGame(room);
      return;
    }
    if (mode === "platformer") {
      this.setupPlatformer(room);
      this.beginRound(room);
      return;
    }
    if (mode === "drawing") {
      room.drawing = { drawerIndex: 0, usedWords: [] };
      this.beginRound(room);
      return;
    }
    if (mode === "pushy") {
      room.pushy = { outcomes: {} };
      this.beginRound(room);
      return;
    }
    if (mode === "redlight") {
      room.redlight = null;
      this.beginRound(room);
      return;
    }
    if (mode === "hidebomb") {
      room.hidebomb = null;
      this.beginRound(room);
      return;
    }
    if (["colorfloor", "vanish", "bombpass", "fire", "racing", "flappy", "runner", "painter", "pong"].includes(mode)) {
      room.arena = null;
      this.beginRound(room);
      return;
    }
    if (mode === "doors") {
      room.doors = null;
      this.beginRound(room);
      return;
    }
    if (mode !== "bomb") {
      const available = availableQuestionCount(mode, settings.categories);
      const picked = pickQuestions({
        mode,
        count: room.totalRounds,
        categories: settings.categories,
        excludeIds: room.usedQuestionIds
      });
      room.questions = picked;
      room.usedQuestionIds.push(...picked.map((q) => q.id));
      if (room.usedQuestionIds.length >= available) {
        room.usedQuestionIds = picked.map((q) => q.id);
      }
    } else {
      room.questions = [];
    }
    this.beginRound(room);
  }

  /**
   * End the current mode. In arcade play with legs remaining, pause on an
   * intermission for the host to advance; otherwise finish the whole game.
   */
  finishMode(room, extra = {}) {
    if (room.arcade?.battle) {
      const battle = room.arcade;
      const deltas = Object.values(room.players).map((p) => ({ id: p.id,
        delta: (p.score ?? 0) - (battle.scoresAtLegStart[p.id] ?? 0) }));
      const best = Math.max(0, ...deltas.map((d) => d.delta));
      const winners = deltas.filter((d) => d.delta === best).map((d) => d.id);
      winners.forEach((id) => { battle.wins[id] = (battle.wins[id] ?? 0) + 1; });
      if (winners.some((id) => battle.wins[id] >= battle.target)) {
        this.finishGame(room, { battle: true });
        return;
      }
      battle.spinnerIndex += 1;
      this.showBattleWheel(room, { lastWinners: winners });
      return;
    }
    if (room.arcade && room.arcade.legIndex < room.arcade.playlist.length - 1) {
      this.disarmTimer(room);
      room.state = GAME_STATES.INTERMISSION;
      room.deadline = null;
      room.lastActivity = Date.now();
      const payload = {
        legIndex: room.arcade.legIndex,          // 0-based leg just finished
        totalLegs: room.arcade.playlist.length,
        nextMode: room.arcade.playlist[room.arcade.legIndex + 1],
        standings: this.standings(room)
      };
      room.lastIntermission = payload;
      this.emitRoom(room.code, "arcade:intermission", payload);
      return;
    }
    this.finishGame(room, extra);
  }

  /** Host advances from an arcade intermission to the next mode. */
  startNextLeg(room, socketId) {
    if (!room) return { ok: false, error: "Room not found." };
    if (room?.arcade?.battle) return this.spinBattleWheel(room, socketId);
    if (socketId !== room.hostId) {
      return { ok: false, error: "Only the host can start the next game." };
    }
    if (room.state !== GAME_STATES.INTERMISSION || !room.arcade) {
      return { ok: false, error: "Not between games right now." };
    }
    room.arcade.legIndex += 1;
    room.currentMode = room.arcade.playlist[room.arcade.legIndex];
    this.beginMode(room);
    return { ok: true };
  }

  standings(room) {
    return Object.values(room.players)
      .map((p) => ({ playerId: p.id, name: p.name, avatar: p.avatar, score: p.score }))
      .sort((a, b) => b.score - a.score);
  }

  // ---- round dispatch -------------------------------------------------------

  beginRound(room) {
    room.lastResults = null;
    const mode = this.mode(room);
    for (const player of Object.values(room.players)) player.guess = null;

    if (mode === "bomb") return this.beginBombRound(room);
    if (mode === "curling") return this.beginCurlingRound(room);
    if (mode === "platformer") return this.beginPlatformerRound(room);
    if (mode === "drawing") return this.beginDrawingRound(room);
    if (mode === "pushy") return this.beginPushyRound(room);
    if (mode === "redlight") return this.beginRedLightRound(room);
    if (mode === "hidebomb") return this.beginHideBombRound(room);
    if (["colorfloor", "vanish", "bombpass", "fire", "racing", "flappy", "runner", "painter", "pong"].includes(mode)) return this.beginArenaRound(room, mode);
    if (mode === "doors") return this.beginDoorsRound(room);
    return this.beginSimultaneousRound(room); // trivia, map
  }

  // ---- simultaneous modes (trivia, timeline) --------------------------------

  beginSimultaneousRound(room) {
    const question = room.questions[room.roundIndex];
    room.currentQuestion = question;
    room.state = GAME_STATES.QUESTION;
    room.deadline = Date.now() + this.roundDurationMs(room);

    this.emitRoom(room.code, "round:question", {
      mode: this.mode(room),
      roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds,
      question: toPublicQuestion(question),
      deadline: room.deadline,
      placedEvents: this.mode(room) === "timeline" ? room.placedEvents.slice() : undefined
    });
    this.armRoundTimer(room);
  }

  armRoundTimer(room) {
    this.disarmTimer(room);
    const handle = this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current && current.state === GAME_STATES.QUESTION) {
        this.revealResults(current);
      }
    }, this.roundDurationMs(room));
    this.timers.set(room.code, handle);
  }

  disarmTimer(room) {
    const handle = this.timers.get(room.code);
    if (handle !== undefined) {
      this.clearTimer(handle);
      this.timers.delete(room.code);
    }
  }

  /** Validate and record a numeric guess (trivia, timeline, curling). */
  submitGuess(room, socketId, rawGuess) {
    if (!room) return { ok: false, error: "Room not found." };
    if (room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "Not accepting guesses right now." };
    }
    const mode = this.mode(room);
    if (mode === "bomb") return { ok: false, error: "Wrong action for this mode." };

    const player = room.players[socketId];
    if (!player || !player.connected) {
      return { ok: false, error: "You are not in this room." };
    }
    if (player.guess !== null && mode !== "curling") {
      return { ok: false, error: "You have already submitted a guess." };
    }
    if (TURN_MODES.has(mode) && room.turnOrder[room.turnIndex] !== socketId) {
      return { ok: false, error: "It is not your turn yet." };
    }

    if (mode === "map") {
      // Map guesses are a { lat, lng } point clicked on the world map.
      const g = rawGuess || {};
      const lat = Number(g.lat);
      const lng = Number(g.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
          lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return { ok: false, error: "Tap the map to place your pin." };
      }
      player.guess = { lat, lng };
    } else if(mode==="curling"){
      if(Date.now()<(room.curlingPlaybackUntil||0))return {ok:false,error:"Wait for the current stone to settle."};
      const shot=typeof rawGuess==="object"&&rawGuess?rawGuess:{direction:0,power:Number(rawGuess)/1000};
      const direction=Number(shot.direction),power=Number(shot.power);
      if(!Number.isFinite(direction)||!Number.isFinite(power)||direction < -1||direction > 1||power < 0||power > 1)
        return {ok:false,error:"Invalid curling shot."};
      const guess={direction,power},throwNumber=(room.curlingThrows?.[socketId]||0)+1;
      const stoneId=`${socketId}:${throwNumber}`;
      room.curlingTrajectory=this.simulateCurlingShot(room,socketId,stoneId,guess);
      room.curlingThrows[socketId]=throwNumber;
      room.curlingShotLog.push({stoneId,playerId:socketId,guess,throwNumber});
      room.curlingPlaybackUntil=Date.now()+room.curlingTrajectory.length*25+1200;
    } else {
      const guess = typeof rawGuess === "string" ? Number(rawGuess) : rawGuess;
      if (!Number.isFinite(guess)) {
        return { ok: false, error: "Guess must be a number." };
      }
      if (guess < GUESS_MIN || guess > GUESS_MAX) {
        return { ok: false, error: "That guess is out of range." };
      }
      player.guess = guess;
    }
    room.lastActivity = Date.now();

    if (mode === "curling") {
      // Reveal this shot to everyone, then move to the next player.
      this.emitRoom(room.code, "turn:update", this.curlingState(room, socketId, room.curlingShotLog.at(-1)?.guess));
      this.advanceCurling(room);
    } else {
      this.emitRoom(room.code, "round:progress", this.progress(room));
      if (this.allConnectedSubmitted(room)) this.revealResults(room);
    }
    return { ok: true };
  }

  allConnectedSubmitted(room) {
    const connected = this.roomManager.connectedPlayers(room);
    return connected.length > 0 && connected.every((p) => p.guess !== null);
  }

  progress(room) {
    const connected = this.roomManager.connectedPlayers(room);
    const answered = connected.filter((p) => p.guess !== null).length;
    return { answered, total: connected.length };
  }

  // ---- curling (sequential, leader shoots first) ----------------------------

  buildTurnOrder(room) {
    // Connected players ordered by current score DESC (leader first); ties keep
    // insertion order for stability.
    const connected = this.roomManager.connectedPlayers(room);
    return connected
      .map((p, i) => ({ id: p.id, score: p.score, i }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.id);
  }

  beginCurlingRound(room) {
    const question = {
      id:`curling-shot-${room.roundIndex}`,
      text:"Slide your stones into the scoring zones.",
      unit:"power",category:"Skill shot",answer:724
    };
    room.currentQuestion = question;
    room.state = GAME_STATES.QUESTION;
    const baseOrder=this.buildTurnOrder(room);
    room.turnOrder = [...baseOrder,...baseOrder,...baseOrder];
    room.turnIndex = 0;
    room.curlingStones=[];
    room.curlingThrows={};room.curlingShotLog=[];room.curlingPlaybackUntil=0;
    room.curlingTrajectory=null;
    this.startCurlingTurn(room);
  }

  startCurlingTurn(room) {
    // Skip any players who disconnected before their turn.
    while (
      room.turnIndex < room.turnOrder.length &&
      !room.players[room.turnOrder[room.turnIndex]]?.connected
    ) {
      room.turnIndex++;
    }
    if (room.turnIndex >= room.turnOrder.length) return this.finishCurlingRound(room);

    const playbackWait=Math.max(0,(room.curlingPlaybackUntil||0)-Date.now());
    room.deadline = Date.now() + this.turnDurationMs(room)+playbackWait;
    this.emitRoom(room.code, "turn:started", {
      mode: "curling",
      roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds,
      question: toPublicQuestion(room.currentQuestion),
      activePlayerId: room.turnOrder[room.turnIndex],
      order: this.curlingOrderView(room),
      shots: this.curlingShots(room),
      stones:room.curlingStones,
      deadline: room.deadline
    });

    this.disarmTimer(room);
    const handle = this.setTimer(() => {
      const cur = this.roomManager.getRoom(room.code);
      if (cur && cur.state === GAME_STATES.QUESTION && this.mode(cur) === "curling") {
        // Time out: this player forfeits their shot (null guess) and we advance.
        const active = cur.players[cur.turnOrder[cur.turnIndex]];
        if (active && active.guess === null) {
          this.emitRoom(cur.code, "turn:update", this.curlingState(cur, active.id, null));
        }
        this.advanceCurling(cur);
      }
    }, this.turnDurationMs(room)+playbackWait);
    this.timers.set(room.code, handle);
  }

  advanceCurling(room) {
    room.turnIndex++;
    if (room.turnIndex >= room.turnOrder.length) return this.finishCurlingRound(room);
    this.startCurlingTurn(room);
  }

  curlingOrderView(room) {
    const activeId=room.turnOrder[room.turnIndex];
    return this.buildTurnOrder(room).map((id) => ({
      playerId: id,
      name: room.players[id]?.name ?? "?",
      done: (room.curlingThrows?.[id]||0)>=3 || !room.players[id]?.connected,
      active: id === activeId,
      stonesThrown:room.curlingThrows?.[id]||0,stonesTotal:3
    }));
  }

  curlingShots(room) {
    // Guesses already made this round (revealed to all; answer stays hidden).
    return (room.curlingShotLog||[]).map((entry) => {
      const id=entry.playerId;
      return {
        stoneId:entry.stoneId,playerId:id,
        name: room.players[id]?.name||"?",
        avatar: room.players[id]?.avatar,
        guess:entry.guess,throwNumber:entry.throwNumber,
        stone:room.curlingStones.find((stone)=>stone.stoneId===entry.stoneId)
      };
    });
  }

  curlingState(room, lastPlayerId, lastGuess) {
    return {
      mode: "curling",
      lastPlayerId,
      lastGuess,
      lastName: room.players[lastPlayerId]?.name,
      order: this.curlingOrderView(room),
      shots: this.curlingShots(room),
      stones:room.curlingStones,
      trajectory:room.curlingTrajectory
    };
  }

  simulateCurlingShot(room,playerId,stoneId,shot){
    const bodies=(room.curlingStones||[]).map((s)=>({...s,vx:0,vy:0}));
    const angle=shot.direction*18*Math.PI/180,speed=340+shot.power*330;
    bodies.push({playerId,stoneId,x:0,y:720,vx:Math.sin(angle)*speed,vy:-Math.cos(angle)*speed,off:false});
    const frames=[],dt=1/120,radius=18;
    for(let step=0;step<1440;step++){
      let moving=false;
      for(const b of bodies){
        if(b.off)continue;
        b.x+=b.vx*dt;b.y+=b.vy*dt;
        const v=Math.hypot(b.vx,b.vy);
        if(v>0){
          const next=Math.max(0,v-240*dt),ratio=v?next/v:0;b.vx*=ratio;b.vy*=ratio;
          if(next>3)moving=true;
        }
        // A stone falls once its centre crosses the board boundary: at that
        // point more than half of its body is unsupported.
        if(Math.abs(b.x)>150||b.y<-13||b.y>808){b.off=true;b.vx=0;b.vy=0;}
      }
      for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
        const a=bodies[i],b=bodies[j];if(a.off||b.off)continue;
        let dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy);
        if(dist<=0||dist>=radius*2)continue;
        const nx=dx/dist,ny=dy/dist,overlap=radius*2-dist;
        a.x-=nx*overlap/2;a.y-=ny*overlap/2;b.x+=nx*overlap/2;b.y+=ny*overlap/2;
        const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
        if(relative<0){
          const impulse=-(1+.9)*relative/2;
          a.vx-=impulse*nx;a.vy-=impulse*ny;b.vx+=impulse*nx;b.vy+=impulse*ny;
          moving=true;
        }
      }
      if(step%3===0)frames.push(bodies.map(({playerId,stoneId,x,y,off})=>({playerId,stoneId,x,y,off})));
      if(!moving&&step>10)break;
    }
    room.curlingStones=bodies.map(({playerId,stoneId,x,y,off})=>({playerId,stoneId,x,y,off}));
    return frames;
  }

  finishCurlingRound(room){
    this.disarmTimer(room);
    const stonePoints=(stone)=>stone.off||Math.abs(stone.x)>150?0:stone.y<22?5:stone.y<108?3:stone.y<162?2:stone.y<220?1:0;
    const ranking=this.roomManager.connectedPlayers(room).map((p)=>{
      const stones=room.curlingStones.filter((s)=>s.playerId===p.id),score=stones.reduce((sum,s)=>sum+stonePoints(s),0);
      const bestDistance=Math.min(9999,...stones.filter(s=>!s.off).map(s=>Math.hypot(s.x,s.y-130)));
      return {playerId:p.id,name:p.name,avatar:p.avatar,stones,score,distance:bestDistance,off:stones.every(s=>s.off)};
    }).sort((a,b)=>b.score-a.score||a.distance-b.distance);
    ranking.forEach((entry,index)=>{
      entry.pointsAwarded=[100,60,30,10][index]||10;
      room.players[entry.playerId].score+=entry.pointsAwarded;
      entry.totalScore=room.players[entry.playerId].score;
    });
    room.state=GAME_STATES.RESULTS;room.deadline=null;
    const payload={mode:"curling",ranking,roundNumber:room.roundIndex+1,totalRounds:room.totalRounds,
      isFinalRound:room.roundIndex+1>=room.totalRounds};
    room.lastResults=payload;this.emitRoom(room.code,"round:results",payload);
  }

  // ---- bomb (Nim-style hot potato) ------------------------------------------

  beginBombRound(room) {
    room.currentQuestion = null;
    room.state = GAME_STATES.QUESTION;
    room.bomb = {
      threshold:
        BOMB_MIN_THRESHOLD +
        Math.floor(Math.random() * (BOMB_MAX_THRESHOLD - BOMB_MIN_THRESHOLD + 1)),
      total: 0,
      popped: false,
      history: []
    };
    room.turnOrder = this.buildTurnOrder(room);
    room.turnIndex = 0;
    this.startBombTurn(room);
  }

  startBombTurn(room) {
    const connected = this.roomManager.connectedPlayers(room);
    if (connected.length === 0) return;
    // Advance to the next connected player (cycling).
    let guard = 0;
    while (
      guard++ < room.turnOrder.length * 2 &&
      !room.players[room.turnOrder[room.turnIndex % room.turnOrder.length]]?.connected
    ) {
      room.turnIndex++;
    }
    const activeId = room.turnOrder[room.turnIndex % room.turnOrder.length];
    room.deadline = Date.now() + this.turnDurationMs(room);

    this.emitRoom(room.code, "turn:started", {
      mode: "bomb",
      roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds,
      activePlayerId: activeId,
      total: room.bomb.total,
      order: this.bombOrderView(room, activeId),
      deadline: room.deadline
    });

    this.disarmTimer(room);
    const handle = this.setTimer(() => {
      const cur = this.roomManager.getRoom(room.code);
      if (cur && cur.state === GAME_STATES.QUESTION && this.mode(cur) === "bomb" && !cur.bomb.popped) {
        // Auto-press 1 on timeout.
        this.applyBombPress(cur, activeId, 1, true);
      }
    }, this.turnDurationMs(room));
    this.timers.set(room.code, handle);
  }

  bombOrderView(room, activeId) {
    return room.turnOrder.map((id) => ({
      playerId: id,
      name: room.players[id]?.name ?? "?",
      active: id === activeId,
      connected: !!room.players[id]?.connected
    }));
  }

  /** A player presses the bomb 1-3 times on their turn. */
  bombPress(room, socketId, rawTimes) {
    if (!room) return { ok: false, error: "Room not found." };
    if (this.mode(room) !== "bomb" || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "Not accepting presses right now." };
    }
    const activeId = room.turnOrder[room.turnIndex % room.turnOrder.length];
    if (socketId !== activeId) return { ok: false, error: "It is not your turn." };
    let times = Math.floor(Number(rawTimes));
    if (!Number.isFinite(times)) times = 1;
    times = Math.max(1, Math.min(3, times));
    this.applyBombPress(room, socketId, times, false);
    return { ok: true };
  }

  applyBombPress(room, playerId, times, auto) {
    const bomb = room.bomb;
    if (bomb.popped) return;
    bomb.total += times;
    bomb.history.push({ playerId, name: room.players[playerId]?.name, times, auto });
    room.lastActivity = Date.now();

    if (bomb.total >= bomb.threshold) {
      bomb.popped = true;
      bomb.popperId = playerId;
      this.disarmTimer(room);
      this.revealResults(room);
      return;
    }
    this.emitRoom(room.code, "turn:update", {
      mode: "bomb",
      total: bomb.total,
      lastPlayerId: playerId,
      lastName: room.players[playerId]?.name,
      lastPress: times
    });
    room.turnIndex++;
    this.startBombTurn(room);
  }

  // ---- timeline / Hitster (card placement, first to target wins) ------------

  startTimelineGame(room) {
    const settings = room.settings ?? {};
    const connected = this.roomManager.connectedPlayers(room);
    room.state = GAME_STATES.QUESTION;
    // 3+ players -> collaborative team-voting; otherwise solo Hitster turns.
    room.hitster = { target: settings.target ?? 11, teamVote: connected.length > 2 };
    // Shuffled draw pile of events (respecting the category filter).
    room.drawPile = pickQuestions({ mode: "timeline", count: 9999, categories: settings.categories })
      .map((q) => ({ id: q.id, label: q.text, year: q.answer, category: q.category }));
    room.drawPointer = 0;
    room.turnOrder = connected.map((p) => p.id);
    room.turnIndex = 0;
    room.lastPlacement = null;
    room.drawing = null;
    room.pushy = null;
    room.redlight = null;

    if (room.hitster.teamVote) {
      // One shared timeline; seed it with a face-up card so slots exist.
      const seed = room.drawPile[room.drawPointer++];
      room.sharedTimeline = seed ? [{ id: seed.id, label: seed.label, year: seed.year }] : [];
      for (const p of connected) { p.score = 0; p.cards = []; }
      this.startTeamVoteRound(room);
      return;
    }

    // Solo Hitster: seed each player with one face-up card (worth no points).
    for (const p of connected) {
      const card = room.drawPile[room.drawPointer++];
      p.cards = card ? [{ id: card.id, label: card.label, year: card.year }] : [];
      p.score = 0;
    }
    this.startTimelineTurn(room);
  }

  // ---- timeline team voting -------------------------------------------------

  publicVotes(room) {
    return Object.entries(room.votes || {}).map(([id, v]) => ({
      playerId: id,
      name: room.players[id]?.name ?? "?",
      avatar: room.players[id]?.avatar,
      slot: v.slot,
      locked: v.locked
    }));
  }

  teamRoundPayload(room) {
    return {
      mode: "timeline",
      teamVote: true,
      card: { id: room.currentCard.id, label: room.currentCard.label, category: room.currentCard.category },
      sharedTimeline: room.sharedTimeline.slice().sort((a, b) => a.year - b.year),
      target: room.hitster.target,
      votes: this.publicVotes(room),
      standings: this.standings(room),
      deadline: room.deadline
    };
  }

  startTeamVoteRound(room) {
    if (room.drawPointer >= room.drawPile.length) return this.finishMode(room);
    room.currentCard = room.drawPile[room.drawPointer++];
    room.votes = {};
    room.deadline = Date.now() + this.roundDurationMs(room);
    this.emitRoom(room.code, "turn:started", this.teamRoundPayload(room));

    this.disarmTimer(room);
    const handle = this.setTimer(() => {
      const cur = this.roomManager.getRoom(room.code);
      if (cur && cur.state === GAME_STATES.QUESTION && this.mode(cur) === "timeline" && cur.hitster?.teamVote) {
        this.resolveTeamVote(cur);
      }
    }, this.roundDurationMs(room));
    this.timers.set(room.code, handle);
  }

  timelineVote(room, socketId, rawSlot) {
    if (!room || this.mode(room) !== "timeline" || !room.hitster?.teamVote) {
      return { ok: false, error: "Not a voting round." };
    }
    if (room.state !== GAME_STATES.QUESTION) return { ok: false, error: "Voting is closed." };
    const player = room.players[socketId];
    if (!player || !player.connected) return { ok: false, error: "You are not in this room." };
    let slot = Math.floor(Number(rawSlot));
    if (!Number.isFinite(slot)) return { ok: false, error: "Pick a slot." };
    slot = Math.max(0, Math.min(room.sharedTimeline.length, slot));
    // Changing your pick unlocks it.
    room.votes[socketId] = { slot, locked: false };
    room.lastActivity = Date.now();
    this.emitRoom(room.code, "timeline:votes", { votes: this.publicVotes(room) });
    return { ok: true };
  }

  timelineLock(room, socketId, locked) {
    if (!room || this.mode(room) !== "timeline" || !room.hitster?.teamVote) {
      return { ok: false, error: "Not a voting round." };
    }
    if (room.state !== GAME_STATES.QUESTION) return { ok: false, error: "Voting is closed." };
    const vote = room.votes[socketId];
    if (!vote) return { ok: false, error: "Pick a spot on the timeline first." };
    vote.locked = !!locked;
    room.lastActivity = Date.now();
    this.emitRoom(room.code, "timeline:votes", { votes: this.publicVotes(room) });

    // Resolve once every connected player has locked a vote.
    const connected = this.roomManager.connectedPlayers(room);
    const allLocked = connected.length > 0 &&
      connected.every((p) => room.votes[p.id] && room.votes[p.id].locked);
    if (allLocked) this.resolveTeamVote(room);
    return { ok: true };
  }

  resolveTeamVote(room) {
    this.disarmTimer(room);
    const card = room.currentCard;
    const sorted = room.sharedTimeline.slice().sort((a, b) => a.year - b.year);

    // Tally locked votes; plurality slot (lowest index breaks ties).
    const counts = {};
    for (const [id, v] of Object.entries(room.votes)) {
      if (v.locked && room.players[id]?.connected) counts[v.slot] = (counts[v.slot] || 0) + 1;
    }
    let majoritySlot = null, best = -1;
    for (const s of Object.keys(counts).map(Number).sort((a, b) => a - b)) {
      if (counts[s] > best) { best = counts[s]; majoritySlot = s; }
    }
    const majorityCorrect =
      majoritySlot !== null && this.isPlacementCorrect(sorted, majoritySlot, card.year);

    // Score each locked voter whose own slot was correct.
    const perPlayer = Object.entries(room.votes)
      .filter(([id]) => room.players[id])
      .map(([id, v]) => {
        const correct = v.locked && this.isPlacementCorrect(sorted, v.slot, card.year);
        if (correct) room.players[id].score = (room.players[id].score ?? 0) + 1;
        return {
          playerId: id,
          name: room.players[id].name,
          avatar: room.players[id].avatar,
          slot: v.slot,
          locked: v.locked,
          correct: !!correct,
          awarded: correct ? 1 : 0,
          score: room.players[id].score
        };
      });

    if (majorityCorrect) {
      room.sharedTimeline.push({ id: card.id, label: card.label, year: card.year });
    }
    room.lastActivity = Date.now();

    const payload = {
      teamVote: true,
      card: { label: card.label, year: card.year, category: card.category },
      majoritySlot,
      majorityCorrect,
      perPlayer,
      sharedTimeline: room.sharedTimeline.slice().sort((a, b) => a.year - b.year),
      standings: this.standings(room),
      target: room.hitster.target
    };
    room.lastPlacement = payload;
    this.emitRoom(room.code, "timeline:result", payload);

    const winner = Object.values(room.players).find((p) => (p.score ?? 0) >= room.hitster.target);
    if (winner) return this.finishMode(room, { lastPlacement: payload });
    this.startTeamVoteRound(room);
  }

  buildTimelines(room) {
    return room.turnOrder.map((id) => {
      const p = room.players[id];
      return {
        playerId: id,
        name: p?.name ?? "?",
        avatar: p?.avatar,
        connected: !!p?.connected,
        score: p?.score ?? 0,
        cards: (p?.cards ?? []).slice().sort((a, b) => a.year - b.year)
      };
    });
  }

  startTimelineTurn(room) {
    if (room.drawPointer >= room.drawPile.length) return this.finishMode(room);
    // Advance to the next connected player (cycling).
    let guard = 0;
    while (
      guard++ < room.turnOrder.length * 2 &&
      !room.players[room.turnOrder[room.turnIndex % room.turnOrder.length]]?.connected
    ) {
      room.turnIndex++;
    }
    if (this.roomManager.connectedPlayers(room).length === 0) return;

    const activeId = room.turnOrder[room.turnIndex % room.turnOrder.length];
    room.currentCard = room.drawPile[room.drawPointer++];
    room.deadline = Date.now() + this.turnDurationMs(room);

    this.emitRoom(room.code, "turn:started", {
      mode: "timeline",
      activePlayerId: activeId,
      card: { id: room.currentCard.id, label: room.currentCard.label, category: room.currentCard.category },
      target: room.hitster.target,
      timelines: this.buildTimelines(room),
      deadline: room.deadline
    });

    this.disarmTimer(room);
    const handle = this.setTimer(() => {
      const cur = this.roomManager.getRoom(room.code);
      if (cur && cur.state === GAME_STATES.QUESTION && this.mode(cur) === "timeline") {
        const active = cur.players[cur.turnOrder[cur.turnIndex % cur.turnOrder.length]];
        if (active) {
          const n = active.cards.length;
          this.resolveTimelinePlacement(cur, active.id, Math.floor(Math.random() * (n + 1)), true);
        }
      }
    }, this.turnDurationMs(room));
    this.timers.set(room.code, handle);
  }

  isPlacementCorrect(sortedCards, slotIndex, year) {
    const years = sortedCards.map((c) => c.year);
    const n = years.length;
    if (n === 0) return true;
    if (slotIndex <= 0) return year <= years[0];
    if (slotIndex >= n) return year >= years[n - 1];
    return year >= years[slotIndex - 1] && year <= years[slotIndex];
  }

  /** Active player places the current card into a slot on their own timeline. */
  timelinePlace(room, socketId, rawSlot) {
    if (!room) return { ok: false, error: "Room not found." };
    if (this.mode(room) !== "timeline" || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "Not placing cards right now." };
    }
    const activeId = room.turnOrder[room.turnIndex % room.turnOrder.length];
    if (socketId !== activeId) return { ok: false, error: "It is not your turn." };
    const player = room.players[socketId];
    let slot = Math.floor(Number(rawSlot));
    if (!Number.isFinite(slot)) return { ok: false, error: "Pick a slot." };
    slot = Math.max(0, Math.min(player.cards.length, slot));
    this.resolveTimelinePlacement(room, socketId, slot, false);
    return { ok: true };
  }

  resolveTimelinePlacement(room, playerId, slotIndex, auto) {
    this.disarmTimer(room);
    const player = room.players[playerId];
    const card = room.currentCard;
    const sorted = player.cards.slice().sort((a, b) => a.year - b.year);
    slotIndex = Math.max(0, Math.min(sorted.length, slotIndex));
    const correct = this.isPlacementCorrect(sorted, slotIndex, card.year);
    if (correct) {
      player.cards.push({ id: card.id, label: card.label, year: card.year });
      player.score = (player.score ?? 0) + 1;
    }
    room.lastActivity = Date.now();

    const lastResult = {
      playerId,
      name: player.name,
      avatar: player.avatar,
      card: { label: card.label, year: card.year, category: card.category },
      slotChosen: slotIndex,
      correct,
      auto: !!auto,
      score: player.score,
      target: room.hitster.target
    };
    room.lastPlacement = lastResult;
    this.emitRoom(room.code, "timeline:result", { ...lastResult, timelines: this.buildTimelines(room) });

    if (correct && player.score >= room.hitster.target) {
      return this.finishMode(room, { lastPlacement: lastResult });
    }
    room.turnIndex++;
    this.startTimelineTurn(room);
  }

  // ---- hide & blow up -------------------------------------------------------

  beginHideBombRound(room) {
    const connected = this.roomManager.connectedPlayers(room);
    const bomber = connected[room.roundIndex % connected.length];
    room.hidebomb = {
      bomberId: bomber.id,
      alive: Object.fromEntries(connected.filter((p) => p.id !== bomber.id).map((p) => [p.id, true])),
      turn: 1,
      stage: "hide",
      choices: {},
      attacked: [],
      points: Object.fromEntries(connected.map((p) => [p.id, 0]))
    };
    room.state = GAME_STATES.QUESTION;
    this.startHideBombHide(room);
  }

  hideBombPublic(room) {
    const hb = room.hidebomb;
    return {
      mode: "hidebomb", roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      bomberId: hb.bomberId, bomberName: room.players[hb.bomberId]?.name,
      turn: hb.turn, maxTurns: 3, stage: hb.stage, attacked: hb.attacked.slice(),
      pendingTarget: hb.stage === "ignite" ? hb.pendingTarget : undefined,
      alive: Object.entries(hb.alive).map(([id, alive]) => ({
        playerId: id, name: room.players[id]?.name, avatar: room.players[id]?.avatar, alive
      })),
      deadline: room.deadline
    };
  }

  startHideBombHide(room) {
    const hb = room.hidebomb;
    hb.stage = "hide";
    hb.choices = {};
    room.deadline = Date.now() + HIDE_BOMB_HIDE_MS;
    this.emitRoom(room.code, "hidebomb:start", this.hideBombPublic(room));
    this.disarmTimer(room);
    this.timers.set(room.code, this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current && this.mode(current) === "hidebomb" && current.hidebomb?.stage === "hide") {
        // Anyone who did not hide is eliminated before the bomber acts.
        for (const [id, alive] of Object.entries(current.hidebomb.alive)) {
          if (alive && !Number.isInteger(current.hidebomb.choices[id])) current.hidebomb.alive[id] = false;
        }
        this.startHideBombAttack(current);
      }
    }, HIDE_BOMB_HIDE_MS));
  }

  hideBombChoose(room, socketId, objectIndex) {
    if (!room || this.mode(room) !== "hidebomb" || room.hidebomb?.stage !== "hide") {
      return { ok: false, error: "It is not time to hide." };
    }
    const hb = room.hidebomb;
    if (socketId === hb.bomberId || !hb.alive[socketId]) return { ok: false, error: "You cannot hide." };
    const choice = Math.floor(Number(objectIndex));
    if (!Number.isFinite(choice) || choice < 0 || choice > 3 || hb.attacked.includes(choice)) {
      return { ok: false, error: "Choose an intact hiding place." };
    }
    hb.choices[socketId] = choice;
    this.emitSocket(socketId, "hidebomb:chosen", { objectIndex: choice });
    const active = Object.entries(hb.alive).filter(([, alive]) => alive).map(([id]) => id);
    this.emitRoom(room.code, "hidebomb:progress", { hidden: active.filter((id) => Number.isInteger(hb.choices[id])).length, total: active.length });
    return { ok: true };
  }

  startHideBombAttack(room) {
    this.disarmTimer(room);
    const hb = room.hidebomb;
    hb.stage = "attack";
    room.deadline = Date.now() + HIDE_BOMB_PICK_MS;
    this.emitRoom(room.code, "hidebomb:attack", this.hideBombPublic(room));
    this.timers.set(room.code, this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current && this.mode(current) === "hidebomb" && current.hidebomb?.stage === "attack") {
        const available = [0, 1, 2, 3].filter((i) => !current.hidebomb.attacked.includes(i));
        this.hideBombAttack(current, current.hidebomb.bomberId, available[Math.floor(Math.random() * available.length)]);
      }
    }, HIDE_BOMB_PICK_MS));
  }

  hideBombAttack(room, socketId, objectIndex) {
    if (!room || this.mode(room) !== "hidebomb" || room.hidebomb?.stage !== "attack") {
      return { ok: false, error: "It is not time to attack." };
    }
    const hb = room.hidebomb;
    if (socketId !== hb.bomberId) return { ok: false, error: "Only the bomber can attack." };
    const target = Math.floor(Number(objectIndex));
    if (!Number.isFinite(target) || target < 0 || target > 3 || hb.attacked.includes(target)) {
      return { ok: false, error: "Choose an intact hiding place." };
    }
    this.disarmTimer(room);
    hb.stage = "ignite";
    hb.pendingTarget = target;
    room.deadline = Date.now() + HIDE_BOMB_IGNITE_MS;
    this.emitRoom(room.code, "hidebomb:ignite", {
      ...this.hideBombPublic(room), target, igniteMs: HIDE_BOMB_IGNITE_MS
    });
    this.timers.set(room.code, this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current && this.mode(current) === "hidebomb" &&
          current.hidebomb?.stage === "ignite" && current.hidebomb.pendingTarget === target) {
        this.resolveHideBombAttack(current);
      }
    }, HIDE_BOMB_IGNITE_MS));
    return { ok: true };
  }

  resolveHideBombAttack(room) {
    this.disarmTimer(room);
    const hb = room.hidebomb;
    if (!hb || hb.stage !== "ignite") return { ok: false, error: "No fuse is burning." };
    const target = hb.pendingTarget;
    hb.pendingTarget = null;
    hb.attacked.push(target);
    hb.lastTarget = target;
    const eliminated = [];
    for (const [id, choice] of Object.entries(hb.choices)) {
      if (hb.alive[id] && choice === target) {
        hb.alive[id] = false;
        eliminated.push(id);
        hb.points[hb.bomberId] += 40;
      }
    }
    hb.stage = "reveal";
    room.deadline = Date.now() + HIDE_BOMB_REVEAL_MS;
    this.emitRoom(room.code, "hidebomb:reveal", {
      ...this.hideBombPublic(room), target,
      // Only occupants of the fired cannon are revealed. Everyone else stays
      // secret for the solo player's remaining guesses.
      choices: Object.entries(hb.choices).filter(([, choice]) => choice === target).map(([id, choice]) => ({
        playerId: id, name: room.players[id]?.name, avatar: room.players[id]?.avatar, objectIndex: choice
      })),
      eliminated
    });
    const survivors = Object.values(hb.alive).filter(Boolean).length;
    if (survivors === 0 || hb.turn >= 3) {
      hb.willFinish = true;
      this.timers.set(room.code, this.setTimer(() => {
        const current = this.roomManager.getRoom(room.code);
        if (current && this.mode(current) === "hidebomb" &&
            current.hidebomb?.stage === "reveal" && current.hidebomb.willFinish) {
          this.finishHideBombRound(current);
        }
      }, HIDE_BOMB_REVEAL_MS));
      return { ok: true };
    }
    hb.turn++;
    // The team hides once. After a miss/hit, the solo player chooses another
    // cannon without learning where the remaining teammates are.
    this.timers.set(room.code, this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current && this.mode(current) === "hidebomb" && current.hidebomb?.stage === "reveal") {
        this.startHideBombAttack(current);
      }
    }, HIDE_BOMB_REVEAL_MS));
    return { ok: true };
  }

  finishHideBombRound(room) {
    this.disarmTimer(room);
    const hb = room.hidebomb;
    const teamWon = Object.values(hb.alive).some(Boolean);
    hb.points[hb.bomberId] = teamWon ? 0 : 100;
    for (const [id, alive] of Object.entries(hb.alive)) hb.points[id] = teamWon && alive ? 100 : 0;
    const ranking = Object.values(room.players).map((p) => {
      const pointsAwarded = hb.points[p.id] || 0;
      p.score += pointsAwarded;
      return {
        playerId: p.id, name: p.name, avatar: p.avatar,
        wasBomber: p.id === hb.bomberId, survived: !!hb.alive[p.id], teamWon,
        pointsAwarded, totalScore: p.score
      };
    }).sort((a, b) => b.pointsAwarded - a.pointsAwarded);
    room.state = GAME_STATES.RESULTS;
    room.deadline = null;
    const payload = {
      mode: "hidebomb", ranking, bomberId: hb.bomberId,
      roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      isFinalRound: room.roundIndex + 1 >= room.totalRounds
    };
    room.lastResults = payload;
    this.emitRoom(room.code, "round:results", payload);
  }

  // ---- red light, green light -----------------------------------------------

  beginRedLightRound(room) {
    const connected = this.roomManager.connectedPlayers(room);
    const controller = connected[room.roundIndex % connected.length];
    const players = {};
    for (const p of connected) {
      players[p.id] = { progress: 0, eliminated: false, finished: false, finishMs: null, lastPress: 0 };
    }
    room.redlight = {
      light: "green", players, controllerId: controller.id, startedAt: Date.now(),
      battery: 100, batteryUpdatedAt: Date.now(), batteryTimer: null
    };
    room.state = GAME_STATES.QUESTION;
    room.deadline = Date.now() + 30000;
    this.emitRoom(room.code, "redlight:start", {
      mode: "redlight", roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      light: "green", controllerId: controller.id, controllerName: controller.name,
      players: this.redLightPlayers(room), battery: 100, deadline: room.deadline
    });
    this.tickRedLightBattery(room);
    this.disarmTimer(room);
    this.timers.set(room.code, this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current && this.mode(current) === "redlight" && current.state === GAME_STATES.QUESTION) {
        this.finishRedLightRound(current);
      }
    }, 30000));
  }

  redLightPlayers(room) {
    return Object.entries(room.redlight.players).map(([id, s]) => ({
      playerId: id, name: room.players[id]?.name, avatar: room.players[id]?.avatar,
      progress: s.progress, eliminated: s.eliminated, finished: s.finished
    }));
  }

  redLightPress(room, socketId) {
    if (!room || this.mode(room) !== "redlight" || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "The race is not active." };
    }
    const rl = room.redlight, runner = rl.players[socketId];
    if (socketId === rl.controllerId) return { ok: false, error: "You control the light this round." };
    if (!runner || runner.eliminated || runner.finished) return { ok: true };
    const now = Date.now();
    if (now - runner.lastPress < 55) return { ok: true };
    runner.lastPress = now;
    if (rl.light === "red") {
      runner.eliminated = true;
      this.emitRoom(room.code, "redlight:caught", {
        playerId: socketId, name: room.players[socketId]?.name,
        players: this.redLightPlayers(room)
      });
    } else {
      runner.progress = Math.min(100, runner.progress + 2);
      if (runner.progress >= 100) {
        runner.finished = true;
        runner.finishMs = now - rl.startedAt;
      }
      this.emitRoom(room.code, "redlight:progress", { players: this.redLightPlayers(room) });
    }
    const active = Object.entries(rl.players)
      .filter(([id, p]) => id !== rl.controllerId && !p.eliminated && !p.finished);
    if (active.length === 0) this.finishRedLightRound(room);
    return { ok: true };
  }

  redLightControl(room, socketId, action) {
    if (!room || this.mode(room) !== "redlight" || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "The race is not active." };
    }
    const rl = room.redlight;
    if (socketId !== rl.controllerId) return { ok: false, error: "You do not control the light." };
    this.syncRedLightBattery(rl);
    if (action === "feint") {
      if (rl.light !== "green") return { ok: false, error: "Feints only work during green." };
      if (rl.battery < 12) return { ok: false, error: "Battery is recharging." };
      rl.battery -= 12;
      this.emitRoom(room.code, "redlight:feint", { durationMs: 450 });
      this.emitRoom(room.code, "redlight:battery", { battery: rl.battery });
      return { ok: true };
    }
    if (rl.light === "green" && rl.battery < 20) {
      return { ok: false, error: "Battery is too low. Let it recharge." };
    }
    rl.light = rl.light === "green" ? "red" : "green";
    rl.batteryUpdatedAt = Date.now();
    this.emitRoom(room.code, "redlight:light", { light: rl.light, players: this.redLightPlayers(room) });
    return { ok: true };
  }

  syncRedLightBattery(rl) {
    const now = Date.now();
    const elapsed = Math.max(0, now - rl.batteryUpdatedAt) / 1000;
    rl.battery = Math.max(0, Math.min(100,
      rl.battery + elapsed * (rl.light === "red" ? -28 : 16)));
    rl.batteryUpdatedAt = now;
  }

  tickRedLightBattery(room) {
    const rl = room.redlight;
    rl.batteryTimer = this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (!current || current.state !== GAME_STATES.QUESTION ||
          this.mode(current) !== "redlight" || current.redlight !== rl) return;
      this.syncRedLightBattery(rl);
      if (rl.light === "red" && rl.battery <= 0) {
        rl.light = "green";
        rl.batteryUpdatedAt = Date.now();
        this.emitRoom(room.code, "redlight:light", {
          light: "green", players: this.redLightPlayers(room), forced: true
        });
      }
      this.emitRoom(room.code, "redlight:battery", { battery: rl.battery });
      this.tickRedLightBattery(room);
    }, 250);
  }

  finishRedLightRound(room) {
    this.disarmTimer(room);
    if (room.redlight?.batteryTimer !== null) this.clearTimer(room.redlight.batteryTimer);
    const controllerId = room.redlight.controllerId;
    const entries = Object.entries(room.redlight.players)
      .filter(([id]) => id !== controllerId).sort(([, a], [, b]) =>
      Number(b.finished) - Number(a.finished) ||
      (a.finished ? a.finishMs - b.finishMs : b.progress - a.progress));
    const awards = [100, 60, 30];
    const ranking = entries.map(([id, runner], index) => {
      const pointsAwarded = runner.finished ? (awards[index] ?? 10) : Math.round(runner.progress / 4);
      const player = room.players[id];
      if (player) player.score += pointsAwarded;
      return {
        playerId: id, name: player?.name, avatar: player?.avatar,
        progress: runner.progress, eliminated: runner.eliminated, finished: runner.finished,
        finishMs: runner.finishMs, pointsAwarded, totalScore: player?.score ?? 0
      };
    });
    const controller = room.players[controllerId];
    const caught = entries.filter(([, runner]) => runner.eliminated).length;
    const controllerPoints = caught * 25;
    if (controller) controller.score += controllerPoints;
    ranking.push({
      playerId: controllerId, name: controller?.name, avatar: controller?.avatar,
      isController: true, caught, pointsAwarded: controllerPoints, totalScore: controller?.score ?? 0
    });
    room.state = GAME_STATES.RESULTS;
    room.deadline = null;
    const payload = {
      mode: "redlight", ranking, roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds, isFinalRound: room.roundIndex + 1 >= room.totalRounds
    };
    room.lastResults = payload;
    this.emitRoom(room.code, "round:results", payload);
  }

  // ---- drawing (one player draws, everyone else guesses) --------------------

  beginDrawingRound(room) {
    const connected = this.roomManager.connectedPlayers(room);
    const drawing = room.drawing;
    const drawer = connected[drawing.drawerIndex % connected.length];
    const available = DRAWING_WORDS.filter((w) => !drawing.usedWords.includes(w));
    const pool = available.length ? available : DRAWING_WORDS;
    const word = pool[Math.floor(Math.random() * pool.length)];
    if (!available.length) drawing.usedWords = [];
    drawing.usedWords.push(word);
    drawing.drawerId = drawer.id;
    drawing.word = word;
    drawing.guessed = {};
    drawing.strokes = [];
    room.state = GAME_STATES.QUESTION;
    room.deadline = Date.now() + Math.max(this.roundDurationMs(room), 60000);

    const common = {
      mode: "drawing", roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      drawerId: drawer.id, drawerName: drawer.name, wordLength: word.length,
      deadline: room.deadline
    };
    this.emitRoom(room.code, "drawing:start", common);
    this.emitSocket(drawer.id, "drawing:secret", { word });
    this.disarmTimer(room);
    this.timers.set(room.code, this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current?.drawing && this.mode(current) === "drawing" && current.state === GAME_STATES.QUESTION) {
        this.finishDrawingRound(current);
      }
    }, Math.max(this.roundDurationMs(room), 60000)));
  }

  drawingStroke(room, socketId, stroke) {
    if (!room || this.mode(room) !== "drawing" || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "Not drawing right now." };
    }
    if (socketId !== room.drawing.drawerId) return { ok: false, error: "Only the artist can draw." };
    const clean = {
      x0: Number(stroke?.x0), y0: Number(stroke?.y0),
      x1: Number(stroke?.x1), y1: Number(stroke?.y1),
      color: /^#[0-9a-f]{6}$/i.test(stroke?.color) ? stroke.color : "#111111",
      width: Math.max(2, Math.min(24, Number(stroke?.width) || 5))
    };
    if (![clean.x0, clean.y0, clean.x1, clean.y1].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
      return { ok: false, error: "Invalid stroke." };
    }
    if (room.drawing.strokes.length < 5000) room.drawing.strokes.push(clean);
    this.emitRoom(room.code, "drawing:stroke", clean);
    return { ok: true };
  }

  drawingClear(room, socketId) {
    if (!room || this.mode(room) !== "drawing" || socketId !== room.drawing?.drawerId) {
      return { ok: false, error: "Only the artist can clear the canvas." };
    }
    room.drawing.strokes = [];
    this.emitRoom(room.code, "drawing:cleared", {});
    return { ok: true };
  }

  drawingGuess(room, socketId, rawGuess) {
    if (!room || this.mode(room) !== "drawing" || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "Not guessing right now." };
    }
    if (socketId === room.drawing.drawerId) return { ok: false, error: "The artist cannot guess." };
    if (room.drawing.guessed[socketId]) return { ok: false, error: "You already got it." };
    const guess = String(rawGuess ?? "").trim().slice(0, 40);
    if (!guess) return { ok: false, error: "Enter a guess." };
    const correct = guess.toLocaleLowerCase() === room.drawing.word.toLocaleLowerCase();
    if (correct) {
      room.drawing.guessed[socketId] = true;
      room.players[socketId].score += 100;
      room.players[room.drawing.drawerId].score += 50;
    }
    this.emitRoom(room.code, "drawing:guess", {
      playerId: socketId, name: room.players[socketId]?.name, guess: correct ? null : guess, correct
    });
    const remaining = this.roomManager.connectedPlayers(room)
      .filter((p) => p.id !== room.drawing.drawerId && !room.drawing.guessed[p.id]);
    if (remaining.length === 0) this.finishDrawingRound(room);
    return { ok: true, correct };
  }

  finishDrawingRound(room) {
    this.disarmTimer(room);
    const d = room.drawing;
    room.state = GAME_STATES.RESULTS;
    room.deadline = null;
    const ranking = this.standings(room).map((p) => ({
      ...p, guessed: !!d.guessed[p.playerId], wasDrawer: p.playerId === d.drawerId,
      pointsAwarded: d.guessed[p.playerId] ? 100 : (p.playerId === d.drawerId ? Object.keys(d.guessed).length * 50 : 0)
    }));
    const payload = {
      mode: "drawing", word: d.word, drawerId: d.drawerId,
      roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      isFinalRound: room.roundIndex + 1 >= room.totalRounds, ranking
    };
    room.lastResults = payload;
    d.drawerIndex++;
    this.emitRoom(room.code, "round:results", payload);
  }

  // ---- pushy platform survival ----------------------------------------------

  beginPushyRound(room) {
    room.pushy.outcomes = {};
    room.pushy.positions = {};
    this.roomManager.connectedPlayers(room).forEach((p, index) => {
      room.pushy.positions[p.id] = {
        x: 270 + (index % 3) * 90,
        y: 175 + Math.floor(index / 3) * 85,
        vx: 0, vy: 0, updatedAt: 0
      };
    });
    room.state = GAME_STATES.QUESTION;
    room.deadline = Date.now() + 22000;
    const payload = {
      mode: "pushy", roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      seed: Math.floor(Math.random() * 1_000_000), deadline: room.deadline,
      players: this.pushyPositions(room)
    };
    room.pushy.round = payload;
    this.emitRoom(room.code, "pushy:start", payload);
    this.disarmTimer(room);
    this.timers.set(room.code, this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current && this.mode(current) === "pushy" && current.state === GAME_STATES.QUESTION) {
        this.finishPushyRound(current);
      }
    }, 22000));
  }

  pushyPositions(room) {
    return Object.entries(room.pushy.positions || {}).map(([id, pos]) => ({
      playerId: id, name: room.players[id]?.name, avatar: room.players[id]?.avatar,
      x: pos.x, y: pos.y, vx: pos.vx, vy: pos.vy,
      done: !!room.pushy.outcomes[id]
    }));
  }

  pushyPosition(room, socketId, raw = {}) {
    if (!room || this.mode(room) !== "pushy" || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "Not on the ice right now." };
    }
    const pos = room.pushy.positions?.[socketId];
    if (!pos || room.pushy.outcomes[socketId]) return { ok: true };
    const now = Date.now();
    if (now - pos.updatedAt < 45) return { ok: true };
    const x = Number(raw.x), y = Number(raw.y), vx = Number(raw.vx), vy = Number(raw.vy);
    if (![x, y, vx, vy].every(Number.isFinite)) return { ok: false, error: "Invalid position." };
    pos.x = Math.max(10, Math.min(660, x));
    pos.y = Math.max(25, Math.min(415, y));
    pos.vx = Math.max(-500, Math.min(500, vx));
    pos.vy = Math.max(-500, Math.min(500, vy));
    pos.updatedAt = now;
    this.emitRoom(room.code, "pushy:positions", { players: this.pushyPositions(room) });
    return { ok: true };
  }

  pushyOutcome(room, socketId, outcome, timeMs) {
    if (!room || this.mode(room) !== "pushy" || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "Not surviving right now." };
    }
    if (!room.players[socketId] || room.pushy.outcomes[socketId]) return { ok: true };
    room.pushy.outcomes[socketId] = {
      survived: outcome === "survived",
      timeMs: Math.max(0, Math.min(22000, Number(timeMs) || 0))
    };
    this.emitRoom(room.code, "pushy:progress", {
      done: Object.keys(room.pushy.outcomes).length,
      total: this.roomManager.connectedPlayers(room).length
    });
    const connected = this.roomManager.connectedPlayers(room);
    if (connected.every((p) => room.pushy.outcomes[p.id])) this.finishPushyRound(room);
    return { ok: true };
  }

  finishPushyRound(room) {
    this.disarmTimer(room);
    const connected = this.roomManager.connectedPlayers(room);
    for (const p of connected) {
      if (!room.pushy.outcomes[p.id]) room.pushy.outcomes[p.id] = { survived: true, timeMs: 22000 };
    }
    const survivors = connected.filter((p) => room.pushy.outcomes[p.id].survived);
    const ranking = connected.map((p) => {
      const o = room.pushy.outcomes[p.id];
      const pointsAwarded = o.survived ? 100 : Math.round(50 * o.timeMs / 22000);
      p.score += pointsAwarded;
      return {
        playerId: p.id, name: p.name, avatar: p.avatar, survived: o.survived,
        timeMs: o.timeMs, pointsAwarded, totalScore: p.score
      };
    }).sort((a, b) => Number(b.survived)-Number(a.survived) || b.timeMs-a.timeMs);
    room.state = GAME_STATES.RESULTS;
    room.deadline = null;
    const payload = {
      mode: "pushy", survivors: survivors.length, ranking,
      roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      isFinalRound: room.roundIndex + 1 >= room.totalRounds
    };
    room.lastResults = payload;
    this.emitRoom(room.code, "round:results", payload);
  }

  // ---- shared survival arena (color floor, vanishing grid, bomb pass) -------

  makeRunnerCourse(seed) {
    // Small seeded generator: courses differ each round but every player in the
    // room receives the identical obstacle and reward layout.
    let value=(seed>>>0)||1;
    const random=()=>((value=Math.imul(value,1664525)+1013904223>>>0)/4294967296);
    const obstacles=[],coins=[],platforms=[];
    let x=650;
    for(let section=0;section<48;section++){
      x+=205+Math.floor(random()*145);
      const roll=random();
      const type=roll<.14?"hanging":roll<.38?"bramble":roll<.62?"crystal":"stump";
      obstacles.push({x,w:18+Math.floor(random()*15),h:26+Math.floor(random()*28),type});
      // Some sections offer a rewarding upper route, reachable with one normal jump.
      if(section>1&&section%5===Math.floor(random()*5)){
        const y=205+Math.floor(random()*48),w=135+Math.floor(random()*70),px=x+130;
        platforms.push({x:px,y,w});
        for(let c=-1;c<=1;c++)coins.push({x:px+c*38,y:y-28});
      }else{
        const count=2+Math.floor(random()*4),arc=random()<.45;
        for(let c=0;c<count;c++)coins.push({x:x+72+c*32,y:arc?286-Math.sin(c/(Math.max(1,count-1))*Math.PI)*58:284});
      }
    }
    return {obstacles,coins,platforms,theme:["moonwood","sunset","crystal","storm"][seed%4],seed};
  }

  beginArenaRound(room, mode) {
    const players = this.roomManager.connectedPlayers(room);
    const now = Date.now();
    const runnerCourse=mode==="runner"?this.makeRunnerCourse((now^room.roundIndex*2654435761^room.code.split("").reduce((n,c)=>n+c.charCodeAt(0),0))>>>0):null;
    const duration = mode === "bombpass" ? 30000 : mode === "fire" ? 60000 : mode === "racing" ? 75000 : ["flappy","runner"].includes(mode) ? 600000 : mode === "painter" ? 42000 : mode === "pong" ? 60000 : mode === "vanish" ? 45000 : mode === "colorfloor" ? 42000 : 26000;
    // Vanishing Grid: pick a "map" (grid pattern + shape) for this round.
    const vmap = mode === "vanish" ? VanishMaps.pickVMap(now) : null;
    room.arena = {
      mode, instanceId:`${now}-${room.roundIndex}-${mode}`, startedAt: now, deadline: now + duration, positions: {}, eliminated: {},
      tiles: {}, cycle: -1, safeColor: 0, holderId: null, explodeAt: null,
      previousHolderId: null, passLockedUntil: 0, tileLayout: [],
      colorDangerAt: 0, colorScrambleUntil: 0, bumpCooldowns: {},
      mapId: vmap ? vmap.id : mode === "fire" ? ["classic","fortress","switchback"][room.roundIndex % 3] : null,
      bombs: [], blasts: [], crates: [], powerups: [], upgrades: {}, finished: {}, finishOrder: [],
      obstacles: mode==="flappy"?Array.from({length:40},(_,i)=>({
        x:560+i*185,gapY:115+((i*83+room.roundIndex*47)%210),gap:Math.max(92,126-i)
      })):runnerCourse?.obstacles||[],
      runnerCoins:runnerCourse?.coins||[],runnerPlatforms:runnerCourse?.platforms||[],
      runnerTheme:runnerCourse?.theme||null,runnerSeed:runnerCourse?.seed||0,
      painterCols:18,painterRows:11,painterTerritory:{},painterTrails:{},painterSpawns:{},
      painterBuckets:[],painterNextBucketAt:mode==="painter"?now+3500:0,painterBucketId:0,
      balls:mode==="pong"?[{id:1,x:360,y:220,vx:175,vy:115}]:[],
      lives:{},playerSides:{},pongSides:mode==="pong"?(players.length===2?4:Math.max(3,players.length)):0,
      nextBallAt:mode==="pong"?now+9000:0,
      trackId: mode==="racing"?RACE_TRACKS[room.roundIndex%RACE_TRACKS.length].id:null,
      fireShrinkLevel:0,fireNextShrinkAt:mode==="fire"?now+38000:0
    };
    if (mode === "fire") {
      const safe = new Set(["1:1","1:2","2:1","11:7","11:6","10:7","11:1","11:2","10:1","1:7","1:6","2:7"]);
      for (let row=1;row<8;row++) for(let col=1;col<12;col++) {
        if (this.fireSolid(col,row,room.arena.mapId)||safe.has(`${col}:${row}`)) continue;
        if (((col*17+row*31+room.roundIndex*7)%10)<6) room.arena.crates.push(`${col}:${row}`);
      }
    }
    players.forEach((p, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, players.length);
      let x = 360 + Math.cos(angle) * 105, y = 220 + Math.sin(angle) * 80;
      let spawnAngle = null;
      if (mode === "fire") {
        const starts=[[110,88],[610,352],[610,88],[110,352]];
        [x,y]=starts[index%starts.length];
      }
      if(mode==="flappy"){x=150;y=205+(index%4)*12;}
      if(mode==="runner"){x=135;y=326;}
      if(mode==="painter"){
        const starts=[[100,80],[620,360],[620,80],[100,360],[360,80],[360,360]];
        [x,y]=starts[index%starts.length];
      }
      if(mode==="pong"){
        room.arena.lives[p.id]=3;
        const rotated=(index+room.roundIndex)%players.length;
        room.arena.playerSides[p.id]=Math.floor(rotated*room.arena.pongSides/players.length);
      }
      if (mode === "racing") {
        const track=RACE_TRACKS.find((item)=>item.id===room.arena.trackId)||RACE_TRACKS[0];
        const p0=track.points[0],p1=track.points[1],dx=p1[0]-p0[0],dy=p1[1]-p0[1],length=Math.hypot(dx,dy);
        const tx=dx/length,ty=dy/length,nx=-ty,ny=tx;
        // Two cars abreast per row. Rotate slots each round so the same player
        // does not repeatedly receive the front-row advantage.
        const slot=(index+room.roundIndex)%players.length,row=Math.floor(slot/2);
        const lane=slot%2===0?-1:1,lateral=lane*25;
        const baseX=p0[0]+dx*.42,baseY=p0[1]+dy*.42,behind=row*52;
        x=baseX-tx*behind+nx*lateral;y=baseY-ty*behind+ny*lateral;
        spawnAngle=Math.atan2(dy,dx);
      }
      if (vmap) { const s = VanishMaps.snapPresent(vmap.mask, x, y); x = s[0]; y = s[1]; } // spawn on a solid tile
      room.arena.positions[p.id] = {
        x, y, vx: 0, vy: 0, updatedAt: 0, jumpUntil: 0, jumpCooldownUntil: 0, layer: 0,
        angle: mode==="racing"?spawnAngle:null, lap:0, checkpoint:0,paddleT:.5,
        spawnX:mode==="racing"?x:null,spawnY:mode==="racing"?y:null,spawnAngle:mode==="racing"?spawnAngle:null,
        distance:0,coins:0,collectedCoins:{},rolling:false,perfects:0,boostUntil:0,groundY:326
      };
      room.arena.upgrades[p.id]={range:2,bombs:1,speed:0};
      if(mode==="painter"){
        const col=Math.max(1,Math.min(16,Math.floor(x/40))),row=Math.max(1,Math.min(9,Math.floor(y/40)));
        room.arena.painterSpawns[p.id]={x:col*40+20,y:row*40+20};room.arena.painterTrails[p.id]=[];
        room.arena.positions[p.id].x=col*40+20;room.arena.positions[p.id].y=row*40+20;
        for(let rr=row-1;rr<=row+1;rr++)for(let cc=col-1;cc<=col+1;cc++)room.arena.painterTerritory[`${cc}:${rr}`]=p.id;
      }
    });
    if (mode === "bombpass" && players.length) {
      room.arena.holderId = players[Math.floor(Math.random() * players.length)].id;
      room.arena.explodeAt = now + 5500 + Math.floor(Math.random() * 3500);
    }
    room.state = GAME_STATES.QUESTION;
    room.deadline = room.arena.deadline;
    this.emitRoom(room.code, "arena:start", this.arenaPublic(room));
    this.armArenaTick(room);
  }

  arenaPublic(room) {
    const a = room.arena;
    return {
      mode: a.mode, instanceId:a.instanceId, roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      deadline: a.deadline, startedAt: a.startedAt, serverNow:Date.now(), safeColor: a.safeColor, mapId: a.mapId,
      cycle: a.cycle, holderId: a.holderId, tileLayout: a.tileLayout,
      dangerAt: a.colorDangerAt, scrambleUntil: a.colorScrambleUntil,
      bombs: a.bombs, blasts: a.blasts, crates: a.crates, powerups:a.powerups,fireShrinkLevel:a.fireShrinkLevel||0,
      trackId:a.trackId,obstacles:a.obstacles,runnerCoins:a.runnerCoins,runnerPlatforms:a.runnerPlatforms,
      runnerTheme:a.runnerTheme,runnerSeed:a.runnerSeed,
      painterCols:a.painterCols,painterRows:a.painterRows,painterTerritory:a.painterTerritory,painterTrails:a.painterTrails,
      painterBuckets:a.painterBuckets,
      balls:a.balls,pongSides:a.pongSides,playerSides:a.playerSides,lives:a.lives,
      players: Object.entries(a.positions).map(([id, pos]) => ({
        playerId: id, name: room.players[id]?.name, avatar: room.players[id]?.avatar,
        x: pos.x, y: pos.y, vx: pos.vx || 0, vy: pos.vy || 0, eliminated: !!a.eliminated[id],
        jumpingUntil: pos.jumpUntil || 0, layer: pos.layer || 0,
        angle: pos.angle, lap: pos.lap || 0, checkpoint: pos.checkpoint || 0, distance:pos.distance||0,
        finished: !!a.finished[id], upgrades:a.upgrades[id],paddleT:pos.paddleT??.5,lives:a.lives[id],
        coins:pos.coins||0,perfects:pos.perfects||0,rolling:!!pos.rolling,collectedCoins:Object.keys(pos.collectedCoins||{}).map(Number)
        ,boostUntil:pos.boostUntil||0,painterSpeedUntil:pos.painterSpeedUntil||0,painterStunnedUntil:pos.painterStunnedUntil||0
      })),
      tiles: Object.entries(a.tiles).map(([key, value]) => ({ key, ...value }))
    };
  }

  armArenaTick(room) {
    this.disarmTimer(room);
    const tickMs = ["colorfloor","vanish","fire","racing","flappy","runner","painter","pong"].includes(room.arena?.mode) ? 55 : 120;
    this.timers.set(room.code, this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (!current || current.state !== GAME_STATES.QUESTION || !current.arena) return;
      this.tickArena(current);
    }, tickMs));
  }

  tickArena(room) {
    const a = room.arena;
    const now = Date.now();
    const alive = () => this.roomManager.connectedPlayers(room).filter((p) => !a.eliminated[p.id]);
    if (a.mode === "colorfloor") {
      const timing = this.colorFloorTiming(now - a.startedAt);
      const cycle = timing.cycle, phase = timing.phase;
      if (cycle !== a.cycle) {
        a.cycle = cycle;
        a.safeColor = Math.floor(Math.random() * 4);
        a.tileLayout = this.colorFloorLayout();
        a.colorDangerAt = now + Math.max(0, timing.dangerDelay - phase);
        a.colorScrambleUntil = now + Math.max(0, timing.scrambleDuration - phase);
        this.emitRoom(room.code, "colorfloor:signal", {
          cycle, safeColor: a.safeColor, dangerAt: a.colorDangerAt,
          scrambleUntil: a.colorScrambleUntil,
          cycleDuration: timing.duration, tileLayout: a.tileLayout
        });
      }
      // Once ignited, unsafe tiles stay lethal until the next scramble begins.
      // Checking on every arena tick catches even a brief step off safe ground.
      if (phase >= timing.dangerDelay) {
        for (const p of alive()) {
          const pos = a.positions[p.id];
          if (now < (pos.jumpUntil || 0)) continue;
          const col = Math.max(0, Math.min(5, Math.floor(pos.x / 120)));
          const row = Math.max(0, Math.min(3, Math.floor(pos.y / 110)));
          const tileColor = a.tileLayout[row * 6 + col];
          if (tileColor !== a.safeColor) this.eliminateArena(room, p.id, "lava");
        }
      }
    } else if (a.mode === "vanish") {
      for (const p of alive()) {
        const pos = a.positions[p.id];
        const layer = pos.layer || 0;
        if (now < (pos.jumpUntil || 0)) continue; // airborne — safe for a moment
        // All cells the footprint overlaps, and which of those are solid tiles.
        const cells = tileCellsUnder(pos.x, pos.y);
        const solid = cells.filter((c) => VanishMaps.cellPresent(a.vmask, layer, c.col, c.row));
        const dropThrough = () => {
          if (layer < VANISH_LAYERS - 1) {
            pos.layer = layer + 1;
            pos.jumpUntil = now + 650;
            pos.landFloor = pos.layer;               // the tile you land on gets extra grace
            this.emitRoom(room.code, "arena:layer", { playerId: p.id, layer: pos.layer, fromLayer: layer });
          } else {
            this.eliminateArena(room, p.id, "fell");
          }
        };
        // Off the grid OR over holes in every overlapped cell → you fall through.
        if (solid.length === 0) { dropThrough(); continue; }
        // Activate decay on EVERY solid tile underfoot; you only fall once they're ALL gone.
        const landing = pos.landFloor === layer;
        let allGone = true;
        for (const c of solid) {
          const key = `${layer}:${c.col}:${c.row}`;
          if (!a.tiles[key]) {
            let decayMs = Math.max(850, 1500 - (now - a.startedAt) * .03);
            if (landing) decayMs += VANISH_LAND_BONUS;  // breathing room on the tile you dropped onto
            a.tiles[key] = { steppedAt: now, disappearsAt: now + decayMs, decayMs };
            this.emitRoom(room.code, "vanish:tile", { key, ...a.tiles[key] });
            allGone = false;
          } else if (now < a.tiles[key].disappearsAt) {
            allGone = false;
          }
        }
        if (landing) pos.landFloor = -1;              // bonus consumed once you've touched down
        if (allGone) dropThrough();
      }
    } else if(a.mode==="painter"){
      a.painterBuckets=a.painterBuckets.filter((bucket)=>now<bucket.expiresAt);
      if(now>=a.painterNextBucketAt&&a.painterBuckets.length<3){
        const types=["cross","splash","burst","speed","roller","lightning"],type=types[Math.floor(Math.random()*types.length)];
        a.painterBuckets.push({id:++a.painterBucketId,col:1+Math.floor(Math.random()*(a.painterCols-2)),row:1+Math.floor(Math.random()*(a.painterRows-2)),type,
          orientation:type==="roller"?(Math.random()<.5?"horizontal":"vertical"):null,expiresAt:now+8500});
        a.painterNextBucketAt=now+4500+Math.floor(Math.random()*2500);
        this.emitRoom(room.code,"arena:painter-buckets",{buckets:a.painterBuckets});
      }
      if(now>=a.deadline)return this.finishArenaRound(room);
    } else if(a.mode==="pong"){
      const dt=Math.min(.06,(now-(a.physicsAt||now))/1000);a.physicsAt=now;
      if(now>=a.nextBallAt&&a.balls.length<4){
        const id=a.balls.length+1,angle=.55+id*1.71;
        a.balls.push({id,x:360,y:220,vx:Math.cos(angle)*(175+id*16),vy:Math.sin(angle)*(175+id*16)});
        a.nextBallAt=now+(a.balls.length===2?9000:7500);
        this.emitRoom(room.code,"arena:pong-ball",{count:a.balls.length});
      }
      const sides=a.pongSides,apothem=174,sideLength=2*apothem*Math.tan(Math.PI/sides);
      const sideOwners={};for(const [id,side]of Object.entries(a.playerSides))sideOwners[side]=id;
      for(const ball of a.balls){
        ball.x+=ball.vx*dt;ball.y+=ball.vy*dt;
        for(let pass=0;pass<2;pass++){
          const crossed=[];
          for(let side=0;side<sides;side++){
            const angle=-Math.PI/2+side*Math.PI*2/sides,nx=Math.cos(angle),ny=Math.sin(angle);
            const projection=(ball.x-360)*nx+(ball.y-220)*ny,outward=ball.vx*nx+ball.vy*ny;
            if(projection>=apothem-9&&outward>0)crossed.push({side,nx,ny,projection,outward,
              score:(projection-apothem)+outward*.025});
          }
          if(!crossed.length)break;
          const hit=crossed.sort((x,y)=>y.score-x.score)[0],ownerId=sideOwners[hit.side];
          const active=ownerId&&!a.eliminated[ownerId],tx=-hit.ny,ty=hit.nx;
          const along=(ball.x-360)*tx+(ball.y-220)*ty;
          const paddleOffset=ownerId?((a.positions[ownerId].paddleT??.5)-.5)*Math.max(35,sideLength-105):0;
          const paddleHit=active&&Math.abs(along-paddleOffset)<52;
          if(active&&!paddleHit){
            if(hit.projection<=apothem+10)break;
            a.lives[ownerId]=Math.max(0,a.lives[ownerId]-1);
            this.emitRoom(room.code,"arena:pong-life",{playerId:ownerId,lives:a.lives[ownerId],side:hit.side});
            if(a.lives[ownerId]===0)this.eliminateArena(room,ownerId,"miss");
            const angle=.8+ball.id*1.37+now%1000/1000;
            ball.x=360;ball.y=220;ball.vx=Math.cos(angle)*185;ball.vy=Math.sin(angle)*185;
            break;
          }
          ball.vx-=2*hit.outward*hit.nx;ball.vy-=2*hit.outward*hit.ny;
          if(paddleHit){
            const english=(along-paddleOffset)/52;
            ball.vx+=tx*english*75;ball.vy+=ty*english*75;
          }
          const speed=Math.min(330,Math.hypot(ball.vx,ball.vy)*1.035);
          const length=Math.max(1,Math.hypot(ball.vx,ball.vy));ball.vx=ball.vx/length*speed;ball.vy=ball.vy/length*speed;
          ball.x-=hit.nx*Math.max(0,hit.projection-(apothem-10));
          ball.y-=hit.ny*Math.max(0,hit.projection-(apothem-10));
        }
      }
      this.emitRoom(room.code,"arena:pong",{balls:a.balls,lives:a.lives,players:this.arenaPublic(room).players});
    } else if(a.mode==="flappy"){
      const dt=Math.min(.08,(now-(a.physicsAt||now))/1000);a.physicsAt=now;
      const progress=(now-a.startedAt)*.12;
      if(a.obstacles.at(-1).x-progress<1000){
        const additions=Array.from({length:12},(_,offset)=>{
          const i=a.obstacles.length+offset;
          return {x:560+i*185,gapY:115+((i*83+room.roundIndex*47)%210),gap:Math.max(92,126-i)};
        });
        a.obstacles.push(...additions);
        this.emitRoom(room.code,"arena:flappy-obstacles",{obstacles:additions});
      }
      for(const p of alive()){
        const pos=a.positions[p.id];pos.vy=(pos.vy||0)+620*dt;pos.y+=pos.vy*dt;pos.distance=progress;
        let hit=pos.y<18||pos.y>422;
        if(!hit)for(const obstacle of a.obstacles){
          const screenX=obstacle.x-progress;
          if(Math.abs(screenX-150)<29&&(pos.y-10<obstacle.gapY-obstacle.gap/2||pos.y+10>obstacle.gapY+obstacle.gap/2)){hit=true;break;}
        }
        if(hit)this.eliminateArena(room,p.id,"popup");
      }
      this.emitRoom(room.code,"arena:positions",{players:this.arenaPublic(room).players,serverNow:now});
    } else if(a.mode==="runner"){
      const dt=Math.min(.08,(now-(a.physicsAt||now))/1000);a.physicsAt=now;
      for(const p of alive()){
        const pos=a.positions[p.id],oldY=pos.y;
        const pace=Math.min(.29,.145+(now-a.startedAt)/420000+(pos.coins||0)*.0025+(now<(pos.boostUntil||0)?.025:0));
        pos.distance=(pos.distance||0)+pace*dt*1000;
        pos.vy=(pos.vy||0)+980*dt;pos.y+=pos.vy*dt;pos.groundY=326;
        // Land on a floating route only while descending through its top.
        for(const platform of a.runnerPlatforms){
          const sx=platform.x-pos.distance;
          if(sx>95-platform.w/2&&sx<175+platform.w/2&&pos.vy>=0&&oldY<=platform.y&&pos.y>=platform.y){
            pos.y=platform.y;pos.vy=0;pos.groundY=platform.y;break;
          }
        }
        if(pos.y>=326){pos.y=326;pos.vy=0;pos.grounded=true;pos.groundY=326;}else pos.grounded=pos.vy===0;
        for(const obstacle of a.obstacles){
          const sx=obstacle.x-pos.distance,halfW=obstacle.w/2;
          const runnerLeft=126,runnerRight=144,runnerTop=pos.rolling?pos.y-20:pos.y-38,runnerBottom=pos.y-2;
          const hazardTop=obstacle.type==="hanging"?245:326-obstacle.h;
          const hazardBottom=obstacle.type==="hanging"?292:326;
          if(runnerRight>sx-halfW&&runnerLeft<sx+halfW&&runnerBottom>hazardTop&&runnerTop<hazardBottom){
            this.eliminateArena(room,p.id,"obstacle");break;
          }
          if(!pos.lastCleared||obstacle.x>pos.lastCleared){
            if(sx+halfW<122&&sx+halfW>95&&!a.eliminated[p.id]){
              pos.lastCleared=obstacle.x;
              const ideal=obstacle.type==="hanging"?pos.rolling:Math.abs(pos.y-(326-obstacle.h-15))<24;
              if(ideal){pos.perfects=(pos.perfects||0)+1;pos.boostUntil=now+1300;this.emitRoom(room.code,"arena:runner-perfect",{playerId:p.id,type:obstacle.type==="hanging"?"roll":"jump"});}
            }
          }
        }
        for(let i=0;i<a.runnerCoins.length;i++){
          if(pos.collectedCoins[i])continue;
          const coin=a.runnerCoins[i],sx=coin.x-pos.distance;
          if(Math.abs(sx-135)<24&&Math.abs(coin.y-(pos.y-20))<30){
            pos.collectedCoins[i]=true;pos.coins++;this.emitRoom(room.code,"arena:runner-coin",{playerId:p.id,index:i,coins:pos.coins});
          }
        }
      }
      this.emitRoom(room.code,"arena:positions",{players:this.arenaPublic(room).players});
    } else if (a.mode === "fire") {
      const exploding=a.bombs.filter((bomb)=>now>=bomb.explodeAt);
      for(const bomb of exploding)this.explodeFireBomb(room,bomb,now);
      a.blasts=a.blasts.filter((blast)=>now<blast.until);
      for(const p of alive()){
        const cell=this.fireCell(a.positions[p.id].x,a.positions[p.id].y),key=`${cell.col}:${cell.row}`;
        if(a.blasts.some((blast)=>blast.cells.includes(key)))this.eliminateArena(room,p.id,"blast");
      }
      if(now>=a.fireNextShrinkAt&&a.fireShrinkLevel<4){
        a.fireShrinkLevel++;a.fireNextShrinkAt=now+5500;
        for(const p of alive()){
          const {col,row}=this.fireCell(a.positions[p.id].x,a.positions[p.id].y);
          if(this.fireShrunk(a,col,row))this.eliminateArena(room,p.id,"closing-fire");
        }
        this.emitRoom(room.code,"arena:fire",{bombs:a.bombs,blasts:a.blasts,crates:a.crates,powerups:a.powerups,fireShrinkLevel:a.fireShrinkLevel});
      }
    } else if (a.mode === "bombpass" && now >= a.explodeAt) {
      this.eliminateArena(room, a.holderId, "exploded");
      const remaining = alive();
      if (remaining.length > 1) {
        a.previousHolderId = a.holderId;
        a.holderId = remaining[Math.floor(Math.random() * remaining.length)].id;
        a.explodeAt = now + 5000 + Math.floor(Math.random() * 3500);
        a.passLockedUntil = now + 900;
        this.emitRoom(room.code, "bombpass:holder", { holderId: a.holderId });
      }
    }
    if (a.mode==="racing") {
      if (now>=a.deadline || Object.keys(a.finished).length>=this.roomManager.connectedPlayers(room).length)
        return this.finishArenaRound(room);
    } else if(["flappy","runner"].includes(a.mode)){
      // Everyone who started gets a complete attempt. A sleeping phone must
      // not disappear from the survivor count and prematurely finish the run.
      if(Object.keys(a.positions).every((id)=>!!a.eliminated[id]))return this.finishArenaRound(room);
    } else if(a.mode==="painter"){
      if(now>=a.deadline)return this.finishArenaRound(room);
    } else if(a.mode==="pong"){
      const count=this.roomManager.connectedPlayers(room).length;
      if(now>=a.deadline||alive().length===0||(count>1&&alive().length<=1))return this.finishArenaRound(room);
    } else if (now >= a.deadline || alive().length <= 1) return this.finishArenaRound(room);
    this.armArenaTick(room);
  }

  fireCell(x,y){return {col:Math.max(0,Math.min(13,Math.floor((x-35)/50))),row:Math.max(0,Math.min(9,Math.floor((y-20)/45)))};}
  fireSolid(col,row,mapId="classic"){
    if(col<=0||col>=12||row<=0||row>=8)return true;
    if(mapId==="fortress")return (col%3===0&&row%2===0)||(row===4&&col%4===0);
    if(mapId==="switchback")return (row%3===0&&col%2===0)||(col===6&&row%2===0);
    return col%2===0&&row%2===0;
  }
  fireShrunk(a,col,row){const n=a.fireShrinkLevel||0;return n>0&&(col<=n||col>=12-n||row<=n||row>=8-n);}
  fireBlocked(a,x,y,radius=14,playerId=null){
    const minCol=Math.floor((x-radius-35)/50),maxCol=Math.floor((x+radius-35)/50);
    const minRow=Math.floor((y-radius-20)/45),maxRow=Math.floor((y+radius-20)/45);
    for(let row=minRow;row<=maxRow;row++)for(let col=minCol;col<=maxCol;col++){
      const key=`${col}:${row}`;
      const bomb=a.bombs.some((b)=>b.col===col&&b.row===row&&!(b.ownerId===playerId&&!b.ownerExited));
      if(!this.fireSolid(col,row,a.mapId)&&!this.fireShrunk(a,col,row)&&!a.crates.includes(key)&&!bomb)continue;
      const left=35+col*50,right=left+48,top=20+row*45,bottom=top+43;
      if(x+radius>left&&x-radius<right&&y+radius>top&&y-radius<bottom)return true;
    }
    return false;
  }
  explodeFireBomb(room,bomb,now){
    const a=room.arena;if(!a.bombs.includes(bomb))return;
    a.bombs=a.bombs.filter((b)=>b!==bomb);
    const cells=[`${bomb.col}:${bomb.row}`];
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])for(let n=1;n<=(bomb.range||2);n++){
      const col=bomb.col+dx*n,row=bomb.row+dy*n,key=`${col}:${row}`;
      if(this.fireSolid(col,row,a.mapId)||this.fireShrunk(a,col,row))break;
      cells.push(key);
      const crate=a.crates.indexOf(key);
      if(crate>=0){
        a.crates.splice(crate,1);
        if(Math.random()<.48&&!a.powerups.some((item)=>item.key===key)){
          const types=["range","bombs","speed"];
          a.powerups.push({key,type:types[Math.floor(Math.random()*types.length)]});
        }
        break;
      }
    }
    a.blasts.push({cells,until:now+850});
    for(const [id,pos] of Object.entries(a.positions)){
      const cell=this.fireCell(pos.x,pos.y);
      if(cells.includes(`${cell.col}:${cell.row}`))this.eliminateArena(room,id,"blast");
    }
    for(const chained of [...a.bombs]){
      if(cells.includes(`${chained.col}:${chained.row}`))this.explodeFireBomb(room,chained,now);
    }
    this.emitRoom(room.code,"arena:fire",{bombs:a.bombs,blasts:a.blasts,crates:a.crates,powerups:a.powerups});
  }

  arenaAction(room,socketId){
    if(!room?.arena||room.state!==GAME_STATES.QUESTION)return {ok:false,error:"No arena action is available."};
    const a=room.arena;if(a.mode!=="fire")return this.arenaJump(room,socketId);
    if(a.eliminated[socketId])return {ok:true};
    const upgrades=a.upgrades[socketId]||{range:2,bombs:1,speed:0};
    if(a.bombs.filter((b)=>b.ownerId===socketId).length>=upgrades.bombs)return {ok:true};
    const pos=a.positions[socketId],cell=this.fireCell(pos.x,pos.y),key=`${cell.col}:${cell.row}`;
    if(this.fireSolid(cell.col,cell.row,a.mapId)||a.crates.includes(key)||a.bombs.some((b)=>b.col===cell.col&&b.row===cell.row))return {ok:true};
    a.bombs.push({ownerId:socketId,col:cell.col,row:cell.row,range:upgrades.range,explodeAt:Date.now()+2200,ownerExited:false});
    this.emitRoom(room.code,"arena:fire",{bombs:a.bombs,blasts:a.blasts,crates:a.crates,powerups:a.powerups});
    return {ok:true};
  }

  arenaCrash(room,socketId){
    if(!room?.arena||room.state!==GAME_STATES.QUESTION||room.arena.mode!=="racing")
      return {ok:false,error:"Not racing."};
    const a=room.arena,pos=a.positions[socketId],now=Date.now();
    if(!pos||a.finished[socketId]||now<(pos.crashCooldownUntil||0))return {ok:true};
    const track=RACE_TRACKS.find((item)=>item.id===a.trackId)||RACE_TRACKS[0];
    let best={distance:Infinity,x:track.points[0][0],y:track.points[0][1],angle:0};
    for(let i=0;i<track.points.length;i++){
      const p1=track.points[i],p2=track.points[(i+1)%track.points.length];
      const dx=p2[0]-p1[0],dy=p2[1]-p1[1],length=dx*dx+dy*dy;
      const t=length?Math.max(0,Math.min(1,((pos.x-p1[0])*dx+(pos.y-p1[1])*dy)/length)):0;
      const x=p1[0]+t*dx,y=p1[1]+t*dy,distance=Math.hypot(pos.x-x,pos.y-y);
      if(distance<best.distance)best={distance,x,y,angle:Math.atan2(dy,dx)};
    }
    const from={x:pos.x,y:pos.y};
    Object.assign(pos,{x:best.x,y:best.y,angle:best.angle,vx:0,vy:0,
      updatedAt:now,crashCooldownUntil:now+1600});
    this.emitRoom(room.code,"arena:racer-crashed",{playerId:socketId,from,
      respawn:{x:best.x,y:best.y,angle:best.angle},recoverAt:now+700});
    return {ok:true};
  }

  colorFloorTiming(elapsed) {
    let remaining = Math.max(0, elapsed), cycle = 0;
    while (true) {
      const duration = Math.max(2600, 6800 - cycle * 650);
      if (remaining < duration) {
        const scrambleDuration = Math.min(1400, duration * .24);
        return { cycle, phase: remaining, duration, scrambleDuration, dangerDelay: duration * .72 };
      }
      remaining -= duration;
      cycle++;
    }
  }

  colorFloorLayout() {
    const layout = Array.from({ length: 24 }, (_, index) => index % 4);
    for (let i = layout.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [layout[i], layout[j]] = [layout[j], layout[i]];
    }
    return layout;
  }

  eliminateArena(room, playerId, reason) {
    const a = room.arena;
    if (!playerId || a.eliminated[playerId]) return;
    if(a.mode==="fire")this.dropFirePowerups(a,playerId);
    a.eliminated[playerId] = { reason, timeMs: Date.now() - a.startedAt };
    this.emitRoom(room.code, "arena:eliminated", { playerId, reason });
    if(a.mode==="fire")this.emitRoom(room.code,"arena:fire",{bombs:a.bombs,blasts:a.blasts,crates:a.crates,powerups:a.powerups,fireShrinkLevel:a.fireShrinkLevel||0});
  }

  dropFirePowerups(a,playerId){
    const u=a.upgrades[playerId]||{range:2,bombs:1,speed:0},drops=[];
    for(let i=2;i<u.range;i++)drops.push("range");for(let i=1;i<u.bombs;i++)drops.push("bombs");for(let i=0;i<u.speed;i++)drops.push("speed");
    const c=this.fireCell(a.positions[playerId].x,a.positions[playerId].y),spots=[[0,0],[1,0],[-1,0],[0,1],[0,-1]];
    drops.slice(0,spots.length).forEach((type,i)=>{const col=c.col+spots[i][0],row=c.row+spots[i][1],key=`${col}:${row}`;
      if(!this.fireSolid(col,row,a.mapId)&&!this.fireShrunk(a,col,row)&&!a.crates.includes(key)&&!a.powerups.some((p)=>p.key===key))a.powerups.push({key,type});});
    a.upgrades[playerId]={range:2,bombs:1,speed:0};
  }

  arenaPosition(room, socketId, raw = {}) {
    if (!room || !room.arena || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "Not in a survival arena right now." };
    }
    const a = room.arena, pos = a.positions[socketId];
    if (!pos || a.eliminated[socketId]) return { ok: true };
    const now = Date.now();
    if(a.mode==="painter"&&now<(pos.painterStunnedUntil||0))return {ok:true};
    if (now - pos.updatedAt < (a.mode==="racing"?25:35)) return { ok: true };
    if(a.mode==="pong"){
      const paddleT=Number(raw.x);if(!Number.isFinite(paddleT))return {ok:false,error:"Invalid paddle position."};
      pos.paddleT=Math.max(0,Math.min(1,paddleT));pos.updatedAt=now;
      return {ok:true};
    }
    if(a.mode==="runner"){
      pos.rolling=!!raw.roll&&pos.y>=((pos.groundY||326)-2);
      pos.updatedAt=now;
      return {ok:true};
    }
    // JSON serializes NaN/Infinity as null. Number(null) is 0, which previously
    // turned a bad animation frame into a valid-looking teleport to (14,14).
    if(typeof raw.x!=="number"||typeof raw.y!=="number"||!Number.isFinite(raw.x)||!Number.isFinite(raw.y))
      return { ok: false, error: "Invalid position." };
    const x = raw.x, y = raw.y;
    const oldX = pos.x, oldY = pos.y;
    const movementDt = pos.updatedAt ? Math.max(.035, Math.min(.2, (now - pos.updatedAt) / 1000)) : .1;
    pos.x = Math.max(14, Math.min(706, x));
    pos.y = Math.max(14, Math.min(426, y));
    if(a.mode==="racing"){
      // Reject stale touch packets and impossible jumps after a phone wakes.
      // Otherwise a client can teleport to a corner, which then becomes its
      // nearest crash-respawn location.
      const dx=pos.x-oldX,dy=pos.y-oldY,distance=Math.hypot(dx,dy);
      const limit=Math.max(28,520*movementDt);
      if(distance>limit){pos.x=oldX+dx/distance*limit;pos.y=oldY+dy/distance*limit;}
    }
    if(a.mode==="fire"){
      const nextX=pos.x,nextY=pos.y;
      pos.x=this.fireBlocked(a,nextX,oldY,14,socketId)?oldX:nextX;
      pos.y=this.fireBlocked(a,pos.x,nextY,14,socketId)?oldY:nextY;
      let bombExitChanged=false;
      for(const bomb of a.bombs)if(bomb.ownerId===socketId&&!bomb.ownerExited){
        const cx=35+bomb.col*50+24,cy=20+bomb.row*45+21.5;
        // Do not turn the bomb solid until the player's entire circular body
        // has cleared its tile. Switching on the cell boundary trapped players.
        if(Math.abs(pos.x-cx)>38||Math.abs(pos.y-cy)>35.5){bomb.ownerExited=true;bombExitChanged=true;}
      }
      if(bombExitChanged)this.emitRoom(room.code,"arena:fire",{bombs:a.bombs,blasts:a.blasts,crates:a.crates,powerups:a.powerups,fireShrinkLevel:a.fireShrinkLevel||0});
      const cell=this.fireCell(pos.x,pos.y),key=`${cell.col}:${cell.row}`;
      const pickupIndex=a.powerups.findIndex((item)=>item.key===key);
      if(pickupIndex>=0){
        const pickup=a.powerups.splice(pickupIndex,1)[0],up=a.upgrades[socketId];
        if(pickup.type==="range")up.range=Math.min(5,up.range+1);
        if(pickup.type==="bombs")up.bombs=Math.min(4,up.bombs+1);
        if(pickup.type==="speed")up.speed=Math.min(3,up.speed+1);
        this.emitRoom(room.code,"arena:powerup",{playerId:socketId,type:pickup.type,upgrades:up});
        this.emitRoom(room.code,"arena:fire",{bombs:a.bombs,blasts:a.blasts,crates:a.crates,powerups:a.powerups});
      }
    }
    if(a.mode==="racing"){
      const angle=Number(raw.angle);if(Number.isFinite(angle))pos.angle=angle;
      const track=RACE_TRACKS.find((item)=>item.id===a.trackId)||RACE_TRACKS[0];
      const gate=track.checkpoints[pos.checkpoint];
      // Test the entire travelled segment. A fast car may cross a gate between
      // two position packets without either endpoint entering its trigger.
      const {nx,ny}=raceGateNormal(track,gate),half=(track.width||72)/2+10;
      const gateCrossed=gate&&segmentsIntersect(oldX,oldY,pos.x,pos.y,gate[0]-nx*half,gate[1]-ny*half,gate[0]+nx*half,gate[1]+ny*half);
      if(gateCrossed||gate&&distanceToSegment(gate[0],gate[1],oldX,oldY,pos.x,pos.y)<18){
        pos.checkpoint++;
        this.emitRoom(room.code,"arena:checkpoint",{
          playerId:socketId,checkpoint:pos.checkpoint,checkpointCount:track.checkpoints.length,lap:pos.lap
        });
        if(pos.checkpoint>=track.checkpoints.length){
          pos.checkpoint=0;pos.lap++;
          if(pos.lap>=3&&!a.finished[socketId]){
            a.finished[socketId]={timeMs:now-a.startedAt,place:a.finishOrder.length+1};
            a.finishOrder.push(socketId);
            this.emitRoom(room.code,"arena:racer-finished",{playerId:socketId,place:a.finishOrder.length,timeMs:now-a.startedAt});
          }
        }
      }
    }
    if(a.mode==="painter"){
      // Sample the whole travelled segment so fast packets cannot skip a tile.
      const samples=Math.max(1,Math.ceil(Math.hypot(pos.x-oldX,pos.y-oldY)/18));
      for(let step=0;step<=samples;step++){
        const t=step/samples,x=oldX+(pos.x-oldX)*t,y=oldY+(pos.y-oldY)*t;
        const col=Math.max(0,Math.min(a.painterCols-1,Math.floor(x/40)));
        const row=Math.max(0,Math.min(a.painterRows-1,Math.floor(y/40)));
        a.painterTerritory[`${col}:${row}`]=socketId;
      }
      const playerCol=Math.max(0,Math.min(a.painterCols-1,Math.floor(pos.x/40)));
      const playerRow=Math.max(0,Math.min(a.painterRows-1,Math.floor(pos.y/40)));
      const bucketIndex=a.painterBuckets.findIndex((bucket)=>bucket.col===playerCol&&bucket.row===playerRow);
      if(bucketIndex>=0){
        const bucket=a.painterBuckets.splice(bucketIndex,1)[0],cells=[];
        const add=(dc,dr)=>{
          const col=bucket.col+dc,row=bucket.row+dr;
          if(col<0||col>=a.painterCols||row<0||row>=a.painterRows)return;
          a.painterTerritory[`${col}:${row}`]=socketId;cells.push(`${col}:${row}`);
        };
        if(bucket.type==="speed")pos.painterSpeedUntil=now+3500;
        else if(bucket.type==="lightning"){
          for(const [otherId,otherPos] of Object.entries(a.positions))if(otherId!==socketId)otherPos.painterStunnedUntil=now+2000;
        }
        else if(bucket.type==="roller"){
          if(bucket.orientation==="vertical")for(let row=0;row<a.painterRows;row++){a.painterTerritory[`${bucket.col}:${row}`]=socketId;cells.push(`${bucket.col}:${row}`);}
          else for(let col=0;col<a.painterCols;col++){a.painterTerritory[`${col}:${bucket.row}`]=socketId;cells.push(`${col}:${bucket.row}`);}
        }
        else if(bucket.type==="cross")for(let n=-2;n<=2;n++){add(n,0);add(0,n);}
        else if(bucket.type==="splash")for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++)add(dc,dr);
        else for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++)if(Math.abs(dc)+Math.abs(dr)<=3)add(dc,dr);
        this.emitRoom(room.code,"arena:painter-bucket",{playerId:socketId,type:bucket.type,cells,buckets:a.painterBuckets});
        this.emitRoom(room.code,"arena:painter-buckets",{buckets:a.painterBuckets});
      }
      this.emitRoom(room.code,"arena:painter",{territory:a.painterTerritory,trails:a.painterTrails,players:this.arenaPublic(room).players});
    }
    pos.vx = Math.max(-350, Math.min(350, (pos.x - oldX) / movementDt));
    pos.vy = Math.max(-350, Math.min(350, (pos.y - oldY) / movementDt));
    // Resolve overlapping bodies on the server so every client converges on
    // the same playful bump rather than rendering players inside one another.
    for (const [otherId, other] of Object.entries(a.positions)) {
      if (otherId === socketId || a.eliminated[otherId] ||
          a.mode === "fire" || (other.layer || 0) !== (pos.layer || 0)) continue;
      const dx = pos.x - other.x, dy = pos.y - other.y;
      const distance = Math.hypot(dx, dy), minimum = a.mode==="racing"?42:34;
      if (distance > 0 && distance < minimum &&
          Date.now() >= (pos.jumpUntil || 0) && Date.now() >= (other.jumpUntil || 0)) {
        const overlap = minimum - distance, nx = dx / distance, ny = dy / distance;
        const ownSpeed = Math.hypot(pos.vx, pos.vy), otherSpeed = Math.hypot(other.vx || 0, other.vy || 0);
        const ownMomentum = (ownSpeed + 45) / (ownSpeed + otherSpeed + 90);
        const ownDisplacement = overlap * (1 - ownMomentum);
        const otherDisplacement = overlap * ownMomentum;
        pos.x = Math.max(14, Math.min(706, pos.x + nx * ownDisplacement));
        pos.y = Math.max(14, Math.min(426, pos.y + ny * ownDisplacement));
        other.x = Math.max(14, Math.min(706, other.x - nx * otherDisplacement));
        other.y = Math.max(14, Math.min(426, other.y - ny * otherDisplacement));
        if (a.mode === "colorfloor" || a.mode === "racing") {
          const key = [socketId, otherId].sort().join(":");
          if (now - (a.bumpCooldowns[key] || 0) > (a.mode==="racing"?320:280)) {
            a.bumpCooldowns[key] = now;
            const hitterId = ownSpeed >= otherSpeed ? socketId : otherId;
            const targetId = hitterId === socketId ? otherId : socketId;
            const rvx=(pos.vx||0)-(other.vx||0),rvy=(pos.vy||0)-(other.vy||0);
            const closing=Math.max(0,-(rvx*nx+rvy*ny));
            const bounce=Math.min(190,Math.max(38,closing*.82+overlap*5));
            const posImpulse={x:nx*bounce,y:ny*bounce};
            const otherImpulse={x:-nx*bounce,y:-ny*bounce};
            this.emitRoom(room.code, "arena:bump", {
              hitterId, targetId,
              intensity: Math.max(.25, Math.min(1, bounce / 170)),
              nx: hitterId===socketId?-nx:nx, ny:hitterId===socketId?-ny:ny,
              racing:a.mode==="racing",
              impulses:a.mode==="racing"?{[socketId]:posImpulse,[otherId]:otherImpulse}:undefined
            });
          }
        }
      }
    }
    pos.updatedAt = now;
    // Position packets arrive more frequently than the arena timer. Validate
    // Color Twister here as well so darting across an ignited tile for only a
    // few frames is still dangerous.
    if (a.mode === "colorfloor" && now >= (a.colorDangerAt || Infinity) &&
        now >= (pos.jumpUntil || 0)) {
      const col = Math.max(0, Math.min(5, Math.floor(pos.x / 120)));
      const row = Math.max(0, Math.min(3, Math.floor(pos.y / 110)));
      if (a.tileLayout[row * 6 + col] !== a.safeColor) {
        this.eliminateArena(room, socketId, "lava");
      }
    }
    if (a.mode === "bombpass" && a.holderId === socketId && now >= a.passLockedUntil &&
        now >= (pos.jumpUntil || 0)) {
      const target = this.roomManager.connectedPlayers(room).find((p) => {
        if (p.id === socketId || a.eliminated[p.id]) return false;
        const other = a.positions[p.id];
        return other && now >= (other.jumpUntil || 0) &&
          Math.hypot(other.x - pos.x, other.y - pos.y) < 48;
      });
      if (target) {
        a.previousHolderId = socketId;
        a.holderId = target.id;
        a.passLockedUntil = now + 850;
        this.emitRoom(room.code, "bombpass:holder", { holderId: target.id, fromId: socketId });
      }
    }
    this.emitRoom(room.code, "arena:positions", {
      players: this.arenaPublic(room).players, holderId: a.holderId, serverNow:now
    });
    return { ok: true };
  }

  resetPainterPlayer(arena,playerId){
    arena.painterTrails[playerId]=[];
    const spawn=arena.painterSpawns[playerId],pos=arena.positions[playerId];
    if(spawn&&pos){pos.x=spawn.x;pos.y=spawn.y;pos.vx=0;pos.vy=0;}
  }

  arenaJump(room, socketId) {
    if (!room || !room.arena || room.state !== GAME_STATES.QUESTION) {
      return { ok: false, error: "Not in a survival arena right now." };
    }
    const pos = room.arena.positions[socketId], now = Date.now();
    if (!pos || room.arena.eliminated[socketId]) return { ok: true };
    if(room.arena.mode==="racing"){
      this.emitRoom(room.code,"arena:horn",{playerId:socketId});
      return {ok:true};
    }
    if(room.arena.mode==="flappy"){
      if(now<(pos.jumpCooldownUntil||0))return {ok:true};
      pos.vy=-285;pos.jumpCooldownUntil=now+105;
      this.emitRoom(room.code,"arena:flap",{playerId:socketId,vy:pos.vy});
      return {ok:true};
    }
    if(room.arena.mode==="runner"){
      if(now<(pos.jumpCooldownUntil||0)||pos.y<324)return {ok:true};
      pos.vy=-420;pos.grounded=false;pos.jumpCooldownUntil=now+180;
      this.emitRoom(room.code,"arena:jumped",{playerId:socketId,jumpingUntil:now+650});
      return {ok:true};
    }
    if (now < (pos.jumpCooldownUntil || 0)) return { ok: true };
    pos.jumpUntil = now + 620;
    pos.jumpCooldownUntil = now + 1050;
    this.emitRoom(room.code, "arena:jumped", { playerId: socketId, jumpingUntil: pos.jumpUntil });
    return { ok: true };
  }

  finishArenaRound(room) {
    this.disarmTimer(room);
    const a = room.arena, duration = a.deadline - a.startedAt;
    if(a.mode==="painter"){
      const total=a.painterCols*a.painterRows;
      const ranking=this.roomManager.connectedPlayers(room).map((p)=>{
        const cells=Object.values(a.painterTerritory).filter((id)=>id===p.id).length;
        return {playerId:p.id,name:p.name,avatar:p.avatar,cells,percent:Math.round(cells/total*1000)/10};
      }).sort((x,y)=>y.cells-x.cells);
      ranking.forEach((entry,index)=>{entry.pointsAwarded=[100,60,30,10][index]||10;room.players[entry.playerId].score+=entry.pointsAwarded;entry.totalScore=room.players[entry.playerId].score;});
      room.state=GAME_STATES.RESULTS;room.deadline=null;
      const payload={mode:a.mode,ranking,roundNumber:room.roundIndex+1,totalRounds:room.totalRounds,isFinalRound:room.roundIndex+1>=room.totalRounds};
      room.lastResults=payload;this.emitRoom(room.code,"round:results",payload);return;
    }
    if(a.mode==="racing"){
      const checkpointCount=(RACE_TRACKS.find((track)=>track.id===a.trackId)||RACE_TRACKS[0]).checkpoints.length;
      const ranking=this.roomManager.connectedPlayers(room).map((p)=>{
        const pos=a.positions[p.id],finish=a.finished[p.id];
        const progress=(pos.lap||0)*checkpointCount+(pos.checkpoint||0);
        return {playerId:p.id,name:p.name,avatar:p.avatar,finished:!!finish,
          place:finish?.place,timeMs:finish?.timeMs,lap:pos.lap||0,progress};
      }).sort((x,y)=>Number(y.finished)-Number(x.finished)||(x.place||99)-(y.place||99)||y.progress-x.progress);
      ranking.forEach((entry,index)=>{
        entry.pointsAwarded=[100,60,30,10][index]||10;
        room.players[entry.playerId].score+=entry.pointsAwarded;
        entry.totalScore=room.players[entry.playerId].score;
      });
      room.state=GAME_STATES.RESULTS;room.deadline=null;
      const payload={mode:a.mode,ranking,roundNumber:room.roundIndex+1,totalRounds:room.totalRounds,
        isFinalRound:room.roundIndex+1>=room.totalRounds};
      room.lastResults=payload;this.emitRoom(room.code,"round:results",payload);return;
    }
    if(["flappy","runner"].includes(a.mode)){
      const ranking=this.roomManager.connectedPlayers(room).map((p)=>{
        const out=a.eliminated[p.id],distance=Math.floor((a.positions[p.id]?.distance||0)/10);
        return {playerId:p.id,name:p.name,avatar:p.avatar,survived:!out,
          timeMs:out?.timeMs??Math.min(duration,Date.now()-a.startedAt),reason:out?.reason,distance};
      }).sort((x,y)=>y.distance-x.distance||y.timeMs-x.timeMs);
      ranking.forEach((entry,index)=>{
        entry.pointsAwarded=[100,60,30,10][index]||10;
        room.players[entry.playerId].score+=entry.pointsAwarded;
        entry.totalScore=room.players[entry.playerId].score;
      });
      room.state=GAME_STATES.RESULTS;room.deadline=null;
      const payload={mode:a.mode,ranking,survivors:ranking.filter((p)=>p.survived).length,
        roundNumber:room.roundIndex+1,totalRounds:room.totalRounds,isFinalRound:room.roundIndex+1>=room.totalRounds};
      room.lastResults=payload;this.emitRoom(room.code,"round:results",payload);return;
    }
    const ranking = this.roomManager.connectedPlayers(room).map((p) => {
      const out = a.eliminated[p.id];
      const survived = !out;
      const timeMs = ["flappy","runner"].includes(a.mode)
        ? (out?.timeMs ?? Math.min(duration,Date.now()-a.startedAt))
        : (survived ? duration : out.timeMs);
      const pointsAwarded = survived ? 100 : Math.max(10, Math.round(60 * timeMs / duration));
      p.score += pointsAwarded;
      return {
        playerId: p.id, name: p.name, avatar: p.avatar, survived, timeMs,
        reason: out?.reason, pointsAwarded, totalScore: p.score,
        distance:["flappy","runner"].includes(a.mode)?Math.floor((a.positions[p.id]?.distance||0)/10):undefined
      };
    }).sort((x, y) => Number(y.survived) - Number(x.survived) || y.timeMs - x.timeMs);
    room.state = GAME_STATES.RESULTS;
    room.deadline = null;
    const payload = {
      mode: a.mode, ranking, survivors: ranking.filter((p) => p.survived).length,
      roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      isFinalRound: room.roundIndex + 1 >= room.totalRounds
    };
    room.lastResults = payload;
    this.emitRoom(room.code, "round:results", payload);
  }

  // ---- choose a door --------------------------------------------------------

  beginDoorsRound(room) {
    const hearts = {};
    const positions = {};
    this.roomManager.connectedPlayers(room).forEach((p, index) => {
      hearts[p.id] = 2;
      positions[p.id] = { x: 180 + (index % 4) * 120, y: 390, updatedAt: 0 };
    });
    room.doors = { stage: 1, hearts, choices: {}, eliminated: {}, handicaps: {}, positions: {} };
    room.doors.positions = positions;
    room.state = GAME_STATES.QUESTION;
    this.beginDoorStage(room);
  }

  beginDoorStage(room) {
    const d = room.doors;
    d.choices = {};
    d.botTargets = {};
    Object.entries(d.positions).forEach(([id, pos], index) => {
      pos.y = 390; pos.x = 180 + (index % 4) * 120; pos.updatedAt = 0;
    });
    const effects = ["safe", "damage", "inconvenience", "eliminate"];
    for (let i = effects.length - 1; i; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [effects[i], effects[j]] = [effects[j], effects[i]];
    }
    d.effects = effects;
    d.deadline = Date.now() + 7500;
    room.deadline = d.deadline;
    this.emitRoom(room.code, "doors:choose", this.doorsPublic(room));
    this.disarmTimer(room);
    this.timers.set(room.code, this.setTimer(() => {
      const current = this.roomManager.getRoom(room.code);
      if (current?.doors && current.state === GAME_STATES.QUESTION) this.revealDoors(current);
    }, 7500));
  }

  doorsPublic(room, reveal = false) {
    const d = room.doors;
    return {
      mode: "doors", stage: d.stage, maxStages: 3, deadline: d.deadline,
      roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      effects: reveal ? d.effects : undefined,
      players: this.roomManager.connectedPlayers(room).map((p) => ({
        playerId: p.id, name: p.name, avatar: p.avatar, hearts: d.hearts[p.id],
        eliminated: !!d.eliminated[p.id], choice: reveal ? d.choices[p.id] : undefined,
        x: d.positions[p.id]?.x, y: d.positions[p.id]?.y
      }))
    };
  }

  chooseDoor(room, socketId, rawIndex) {
    if (!room || this.mode(room) !== "doors" || room.state !== GAME_STATES.QUESTION || !room.doors) {
      return { ok: false, error: "The doors are not open right now." };
    }
    if (room.doors.eliminated[socketId]) return { ok: false, error: "You are out this round." };
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 0 || index > 3) return { ok: false, error: "Choose a valid door." };
    room.doors.choices[socketId] = index;
    this.emitSocket(socketId, "doors:selected", { doorIndex: index });
    const active = this.roomManager.connectedPlayers(room).filter((p) => !room.doors.eliminated[p.id]);
    this.emitRoom(room.code, "doors:progress", { chosen: Object.keys(room.doors.choices).length, total: active.length });
    if (active.every((p) => Number.isInteger(room.doors.choices[p.id]))) this.revealDoors(room);
    return { ok: true };
  }

  doorsPosition(room, socketId, raw = {}) {
    if (!room || this.mode(room) !== "doors" || room.state !== GAME_STATES.QUESTION || !room.doors) {
      return { ok: false, error: "Not running for a door right now." };
    }
    const d = room.doors, pos = d.positions[socketId];
    if (!pos || d.eliminated[socketId] || Number.isInteger(d.choices[socketId])) return { ok: true };
    const now = Date.now();
    if (now - pos.updatedAt < 35) return { ok: true };
    const x = Number(raw.x), y = Number(raw.y);
    if (![x, y].every(Number.isFinite)) return { ok: false, error: "Invalid position." };
    pos.x = Math.max(18, Math.min(702, x));
    pos.y = Math.max(45, Math.min(410, y));
    pos.updatedAt = now;
    this.emitRoom(room.code, "doors:positions", {
      players: this.doorsPublic(room, false).players
    });
    if (pos.y <= 92) {
      const doorIndex = Math.max(0, Math.min(3, Math.floor(pos.x / 180)));
      return this.chooseDoor(room, socketId, doorIndex);
    }
    return { ok: true };
  }

  revealDoors(room) {
    this.disarmTimer(room);
    const d = room.doors;
    for (const p of this.roomManager.connectedPlayers(room)) {
      if (d.eliminated[p.id]) continue;
      let choice = Number.isInteger(d.choices[p.id]) ? d.choices[p.id] : Math.floor(Math.random() * 4);
      if (d.handicaps[p.id]) {
        choice = (choice + 1) % 4;
        d.choices[p.id] = choice;
        delete d.handicaps[p.id];
      }
      d.choices[p.id] = choice;
      const effect = d.effects[choice];
      if (effect === "eliminate") d.eliminated[p.id] = true;
      if (effect === "inconvenience") d.handicaps[p.id] = true;
      if (effect === "damage") {
        d.hearts[p.id] -= 1;
        if (d.hearts[p.id] <= 0) d.eliminated[p.id] = true;
      }
    }
    this.emitRoom(room.code, "doors:reveal", this.doorsPublic(room, true));
    const alive = this.roomManager.connectedPlayers(room).filter((p) => !d.eliminated[p.id]);
    if (d.stage >= 3 || alive.length <= 1) {
      this.timers.set(room.code, this.setTimer(() => this.finishDoorsRound(room), 3000));
    } else {
      d.stage += 1;
      this.timers.set(room.code, this.setTimer(() => this.beginDoorStage(room), 3000));
    }
  }

  finishDoorsRound(room) {
    this.disarmTimer(room);
    const d = room.doors;
    const ranking = this.roomManager.connectedPlayers(room).map((p) => {
      const survived = !d.eliminated[p.id];
      const pointsAwarded = survived ? 100 + d.hearts[p.id] * 15 : 25;
      p.score += pointsAwarded;
      return {
        playerId: p.id, name: p.name, avatar: p.avatar, survived,
        hearts: d.hearts[p.id], pointsAwarded, totalScore: p.score
      };
    }).sort((a, b) => Number(b.survived) - Number(a.survived) || b.hearts - a.hearts);
    room.state = GAME_STATES.RESULTS;
    room.deadline = null;
    const payload = {
      mode: "doors", ranking, roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
      isFinalRound: room.roundIndex + 1 >= room.totalRounds
    };
    room.lastResults = payload;
    this.emitRoom(room.code, "round:results", payload);
  }

  // ---- platformer (build a level, then race) --------------------------------

  setupPlatformer(room) {
    room.platformer = {
      level: null,
      maps: this.platformerMaps(),
      mapChosen: null,
      mapVotes: {},
      phase: "mapvote",
      placements: {},
      outcomes: {},
      positions: {},
      selections: {},
      cursors: {},
      pool: {},
      removableTiles: {}
    };
  }

  platformerMaps() {
    const make=(id,name,emoji,description,theme,platforms)=>{
      const cols=24,rows=14,tile=40,tiles={};
      const solid=(c,r)=>{tiles[`${c},${r}`]="solid";};
      for(let c=0;c<=4;c++)for(let r=11;r<=13;r++)solid(c,r);
      for(let c=20;c<=23;c++)for(let r=11;r<=13;r++)solid(c,r);
      platforms.forEach(([c,r,w=1,type="solid"])=>{for(let i=0;i<w;i++)tiles[`${c+i},${r}`]=type;});
      return {
        id,name,emoji,description,
        level:{cols,rows,tile,tiles,theme,spawn:{x:2.5*tile,y:10*tile},goal:{x0:20*tile,x1:24*tile,y:11*tile}}
      };
    };
    return [
      make("skybridge","Skybridge","☁️","Sparse cloud islands climb high above the world.",
        {id:"sky",skyTop:"#38bdf8",skyBottom:"#dbeafe",void:"#3730a3"},
        [[7,10,1],[9,8,2],[13,6,1],[16,8,2],[19,10,1]]),
      make("canyon","Canyon Run","🏜️","A broad low route over unstable desert ledges.",
        {id:"canyon",skyTop:"#fb923c",skyBottom:"#fde68a",void:"#7c2d12"},
        [[6,11,3,"crumble"],[10,10,4],[15,11,4,"crumble"]]),
      make("zigzag","Neon Zigzag","⚡","Slippery ledges and bounce pads force a sharp zigzag.",
        {id:"neon",skyTop:"#111827",skyBottom:"#312e81",void:"#020617"},
        [[6,9,2,"ice"],[9,7,1,"bouncy"],[12,9,2,"ice"],[15,7,2],[18,9,1,"bouncy"]])
    ];
  }

  publicPlatformerMaps(room) {
    return room.platformer.maps.map((m)=>({
      id:m.id,name:m.name,emoji:m.emoji,description:m.description,
      theme:m.level.theme,
      preview:Object.entries(m.level.tiles).map(([key,type])=>[...key.split(",").map(Number),type])
    }));
  }

  platformerHand() {
    return ["solid", "spike", "bouncy", "ice", "crumble", "saw", "conveyor", "bombtrap"];
  }

  platformerPool(room) {
    const n = Math.max(2, this.roomManager.connectedPlayers(room).length);
    const types=this.platformerHand();
    const pool=Object.fromEntries(types.map((type)=>[type,0]));
    // One dependable block plus a small random draft: only players + 3 total.
    pool.solid=1;
    const bag=["solid","solid","spike","spike","bouncy","ice","ice","crumble","crumble","saw","conveyor","bombtrap"];
    for(let i=1;i<n+3;i++)pool[bag[Math.floor(Math.random()*bag.length)]]++;
    return pool;
  }

  platformerPoolRemaining(room) {
    const remaining = { ...room.platformer.pool };
    for (const type of Object.values(room.platformer.selections || {})) {
      if (remaining[type] !== undefined) remaining[type] = Math.max(0, remaining[type] - 1);
    }
    return remaining;
  }

  platformerBuilders(room) {
    return this.roomManager.connectedPlayers(room).map((p) => ({
      playerId: p.id, name: p.name, avatar: p.avatar,
      selected: room.platformer.selections[p.id] || null,
      cursor: room.platformer.cursors[p.id] || null
    }));
  }

  emitPlatformerBuilders(room) {
    this.emitRoom(room.code, "platformer:builders", {
      builders: this.platformerBuilders(room),
      pool: this.platformerPoolRemaining(room)
    });
  }

  beginPlatformerRound(room) {
    if (!room.platformer.mapChosen) return this.beginPlatformerMapVote(room);
    return this.beginPlatformerBuild(room);
  }

  beginPlatformerMapVote(room) {
    const pf=room.platformer;
    pf.phase="mapvote";pf.mapVotes={};
    room.state=GAME_STATES.QUESTION;
    room.deadline=Date.now()+9000;
    this.emitRoom(room.code,"platformer:map-vote",{
      maps:this.publicPlatformerMaps(room),votes:{},deadline:room.deadline
    });
    this.disarmTimer(room);
    this.timers.set(room.code,this.setTimer(()=>{
      const cur=this.roomManager.getRoom(room.code);
      if(cur&&cur.platformer?.phase==="mapvote")this.selectPlatformerMap(cur);
    },9000));
  }

  platformerMapVote(room,socketId,mapId) {
    if(!room||this.mode(room)!=="platformer"||room.platformer.phase!=="mapvote")return{ok:false,error:"Map voting is closed."};
    if(!room.players[socketId]?.connected)return{ok:false,error:"You are not in this room."};
    if(!room.platformer.maps.some((m)=>m.id===mapId))return{ok:false,error:"Unknown map."};
    room.platformer.mapVotes[socketId]=mapId;
    const counts={};
    Object.values(room.platformer.mapVotes).forEach((id)=>{counts[id]=(counts[id]||0)+1;});
    this.emitRoom(room.code,"platformer:map-votes",{votes:counts,votedPlayerIds:Object.keys(room.platformer.mapVotes)});
    const connected=this.roomManager.connectedPlayers(room);
    if(connected.length&&connected.every((p)=>room.platformer.mapVotes[p.id]))this.selectPlatformerMap(room);
    return{ok:true};
  }

  selectPlatformerMap(room) {
    const pf=room.platformer;
    if(pf.phase!=="mapvote")return;
    const counts={};
    Object.values(pf.mapVotes).forEach((id)=>{counts[id]=(counts[id]||0)+1;});
    const max=Math.max(0,...Object.values(counts));
    let finalists=pf.maps.filter((m)=>(counts[m.id]||0)===max);
    if(!finalists.length)finalists=[...pf.maps];
    const chosen=finalists[Math.floor(Math.random()*finalists.length)];
    pf.mapChosen=chosen.id;
    pf.level=JSON.parse(JSON.stringify(chosen.level));
    pf.removableTiles={};
    pf.phase="maproulette";
    room.deadline=Date.now()+2600;
    this.disarmTimer(room);
    this.emitRoom(room.code,"platformer:map-selected",{
      selectedId:chosen.id,finalistIds:finalists.map((m)=>m.id),rouletteMs:2600
    });
    this.timers.set(room.code,this.setTimer(()=>{
      const cur=this.roomManager.getRoom(room.code);
      if(cur&&cur.platformer?.phase==="maproulette")this.beginPlatformerBuild(cur);
    },2600));
  }

  beginPlatformerBuild(room) {
    const pf = room.platformer;
    pf.phase = "build";
    pf.placements = {};
    pf.outcomes = {};
    pf.selections = {};
    pf.cursors = {};
    pf.pool = this.platformerPool(room);
    room.state = GAME_STATES.QUESTION;
    room.deadline = Date.now() + Math.max(this.roundDurationMs(room), 20000);

    this.emitRoom(room.code, "platformer:build", {
      roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds,
      level: pf.level,
      hand: this.platformerHand(),
      pool: this.platformerPoolRemaining(room),
      builders: this.platformerBuilders(room),
      removableTiles:Object.keys(pf.removableTiles||{}),
      players: this.roomManager.connectedPlayers(room).map((p) => ({
        playerId: p.id, name: p.name, avatar: p.avatar
      })),
      placements: this.publicPlacements(room),
      standings: this.standings(room),
      deadline: room.deadline
    });

    this.disarmTimer(room);
    const handle = this.setTimer(() => {
      const cur = this.roomManager.getRoom(room.code);
      if (cur && this.mode(cur) === "platformer" && cur.platformer.phase === "build") {
        this.commitBuild(cur);
      }
    }, Math.max(this.roundDurationMs(room), 20000));
    this.timers.set(room.code, handle);
  }

  publicPlacements(room) {
    return Object.entries(room.platformer.placements).map(([id, p]) => ({
      playerId: id,
      name: room.players[id]?.name,
      avatar: room.players[id]?.avatar,
      col: p.col, row: p.row, type: p.type, locked: p.locked
    }));
  }

  emitPlatformerPlaced(room) {
    this.emitRoom(room.code, "platformer:placed", {
      placements: this.publicPlacements(room),
      pool: this.platformerPoolRemaining(room),
      builders: this.platformerBuilders(room),
      removableTiles: Object.keys(room.platformer.removableTiles || {})
    });
  }

  cellOccupied(room, col, row) {
    if (room.platformer.level.tiles[`${col},${row}`]) return true;
    return Object.values(room.platformer.placements).some((p) => p.col === col && p.row === row);
  }

  platformerSelect(room, socketId, type) {
    if (!room || this.mode(room) !== "platformer" || room.platformer.phase !== "build") {
      return { ok: false, error: "Building is closed." };
    }
    if (!room.players[socketId]?.connected) return { ok: false, error: "You are not in this room." };
    if (!this.platformerHand().includes(type)) return { ok: false, error: "Unknown tile." };
    if (room.platformer.placements[socketId]?.locked) return { ok: false, error: "Unlock your tile first." };
    const previous = room.platformer.selections[socketId];
    delete room.platformer.selections[socketId];
    if ((this.platformerPoolRemaining(room)[type] || 0) < 1) {
      if (previous) room.platformer.selections[socketId] = previous;
      this.emitPlatformerBuilders(room);
      return { ok: false, error: "That item is already taken from the pool." };
    }
    room.platformer.selections[socketId] = type;
    this.emitPlatformerBuilders(room);
    return { ok: true };
  }

  platformerHover(room, socketId, cursor = null) {
    if (!room || this.mode(room) !== "platformer" || room.platformer.phase !== "build") {
      return { ok: false, error: "Building is closed." };
    }
    if (!room.players[socketId]?.connected) return { ok: false, error: "You are not in this room." };
    if (cursor === null || cursor.col === null) {
      delete room.platformer.cursors[socketId];
    } else {
      const col=Math.floor(Number(cursor.col)), row=Math.floor(Number(cursor.row));
      if (!Number.isFinite(col)||!Number.isFinite(row)||col<0||col>=room.platformer.level.cols||
          row<0||row>=room.platformer.level.rows) return { ok:false,error:"Off the grid." };
      room.platformer.cursors[socketId]={col,row};
    }
    this.emitPlatformerBuilders(room);
    return { ok: true };
  }

  platformerPlace(room, socketId, { col, row, type } = {}) {
    if (!room || this.mode(room) !== "platformer") return { ok: false, error: "Wrong mode." };
    const pf = room.platformer;
    if (pf.phase !== "build") return { ok: false, error: "Building is closed." };
    const player = room.players[socketId];
    if (!player || !player.connected) return { ok: false, error: "You are not in this room." };
    col = Math.floor(Number(col)); row = Math.floor(Number(row));
    if (!Number.isFinite(col) || !Number.isFinite(row) ||
        col < 0 || col >= pf.level.cols || row < 0 || row >= pf.level.rows) {
      return { ok: false, error: "Off the grid." };
    }
    if (!this.platformerHand().includes(type)) return { ok: false, error: "Unknown tile." };
    // API/test compatibility: selecting and placing can be one atomic action.
    if (!pf.selections[socketId]) {
      if ((this.platformerPoolRemaining(room)[type] || 0) < 1) {
        return { ok: false, error: "That item is already taken from the pool." };
      }
      pf.selections[socketId] = type;
    }
    if (pf.selections[socketId] !== type) return { ok: false, error: "Select that item first." };
    // Ignore this player's current pick while checking the new target.
    const previous = pf.placements[socketId];
    delete pf.placements[socketId];
    if (type === "bombtrap") {
      if (previous?.demolished) {
        pf.placements[socketId]=previous;
        return { ok:false,error:"That bomb has already been used." };
      }
      const key=`${col},${row}`;
      const targetEntry=Object.entries(pf.placements).find(([,p])=>
        !p.skip&&!p.demolished&&p.col===col&&p.row===row);
      if (targetEntry) {
        const [targetId]=targetEntry;
        delete pf.placements[targetId];
        delete pf.selections[targetId];
        delete pf.cursors[targetId];
      } else if (pf.removableTiles[key]) {
        delete pf.level.tiles[key];
        delete pf.removableTiles[key];
      } else {
        if(previous)pf.placements[socketId]=previous;
        return {ok:false,error:pf.level.tiles[key]
          ?"That is protected map terrain."
          :"Place bombs on a player-added object."};
      }
      pf.placements[socketId]={col,row,type:"demolition",demolished:true,locked:false};
      room.lastActivity=Date.now();
      this.emitPlatformerPlaced(room);
      this.emitPlatformerBuilders(room);
      return {ok:true};
    }
    if (this.cellOccupied(room, col, row)) {
      if (previous) pf.placements[socketId] = previous;
      return { ok: false, error: "That cell is taken." };
    }
    pf.placements[socketId] = { col, row, type, locked: false };
    room.lastActivity = Date.now();
    this.emitPlatformerPlaced(room);
    return { ok: true };
  }

  platformerLock(room, socketId, locked) {
    if (!room || this.mode(room) !== "platformer") return { ok: false, error: "Wrong mode." };
    const pf = room.platformer;
    if (pf.phase !== "build") return { ok: false, error: "Building is closed." };
    // A player may lock with no tile placed (they skip placing this round).
    if (!pf.placements[socketId]) {
      pf.placements[socketId] = { skip: true, locked: false };
      delete pf.selections[socketId];
      delete pf.cursors[socketId];
    }
    pf.placements[socketId].locked = !!locked;
    room.lastActivity = Date.now();
    this.emitPlatformerPlaced(room);

    const connected = this.roomManager.connectedPlayers(room);
    const allLocked = connected.length > 0 &&
      connected.every((p) => pf.placements[p.id] && pf.placements[p.id].locked);
    if (allLocked) this.commitBuild(room);
    return { ok: true };
  }

  commitBuild(room) {
    const pf = room.platformer;
    // Bake locked placements into the persistent level.
    for (const p of Object.values(pf.placements)) {
      if (p && !p.skip && !p.demolished && Number.isFinite(p.col)) {
        const key=`${p.col},${p.row}`;
        pf.level.tiles[key] = p.type;
        pf.removableTiles[key]=true;
      }
    }
    this.beginRace(room);
  }

  beginRace(room) {
    const pf = room.platformer;
    pf.phase = "race";
    pf.outcomes = {};
    pf.positions = {};
    // Seed shared positions before the first packet so idle remote racers and
    // test bots are visible from the instant the race begins.
    const racers = this.roomManager.connectedPlayers(room);
    racers.forEach((player,index) => {
      const spawnCenter = racers.length > 1
        ? 32 + index * (96 / Math.max(1, racers.length - 1))
        : pf.level.spawn.x;
      pf.positions[player.id] = { x:spawnCenter-16, y:pf.level.spawn.y-34, vx:0, vy:0 };
    });
    room.state = GAME_STATES.QUESTION;
    room.deadline = Date.now() + 25000;
    this.emitRoom(room.code, "platformer:race", {
      roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds,
      level: pf.level,
      players: this.platformerPositions(room),
      deadline: room.deadline
    });
    this.disarmTimer(room);
    const handle = this.setTimer(() => {
      const cur = this.roomManager.getRoom(room.code);
      if (cur && this.mode(cur) === "platformer" && cur.platformer.phase === "race") {
        this.scoreRace(cur);
      }
    }, 25000);
    this.timers.set(room.code, handle);
  }

  platformerPositions(room) {
    return this.roomManager.connectedPlayers(room).map((p) => ({
      playerId: p.id, name: p.name, avatar: p.avatar,
      ...(room.platformer.positions[p.id] || {}),
      done: !!room.platformer.outcomes[p.id]
    }));
  }

  platformerPosition(room, socketId, position = {}) {
    if (!room || this.mode(room) !== "platformer" || room.platformer.phase !== "race") {
      return { ok: false, error: "Not racing." };
    }
    if (!room.players[socketId]?.connected) return { ok: false, error: "You are not in this room." };
    const { x, y, vx, vy } = position;
    if (![x,y,vx,vy].every(Number.isFinite)) return { ok: false, error: "Invalid position." };
    const level=room.platformer.level;
    room.platformer.positions[socketId] = {
      x: Math.max(-50,Math.min(level.cols*level.tile+50,x)),
      y: Math.max(-100,Math.min(level.rows*level.tile+100,y)),
      vx: Math.max(-700,Math.min(700,vx)),
      vy: Math.max(-900,Math.min(1200,vy))
    };
    this.emitRoom(room.code, "platformer:positions", { players: this.platformerPositions(room) });
    return { ok: true };
  }

  platformerOutcome(room, socketId, outcome, timeMs) {
    if (!room || this.mode(room) !== "platformer") return { ok: false, error: "Wrong mode." };
    const pf = room.platformer;
    if (pf.phase !== "race") return { ok: false, error: "Not racing." };
    if (!room.players[socketId]) return { ok: false, error: "You are not in this room." };
    if (pf.outcomes[socketId]) return { ok: true }; // first outcome wins
    const elapsed = Number(timeMs);
    pf.outcomes[socketId] = {
      outcome: outcome === "goal" ? "goal" : "dead",
      timeMs: Number.isFinite(elapsed) ? Math.max(0, Math.min(25000, elapsed)) : null
    };
    room.lastActivity = Date.now();
    this.emitRoom(room.code, "platformer:progress", {
      done: Object.keys(pf.outcomes).length,
      total: this.roomManager.connectedPlayers(room).length
    });
    const connected = this.roomManager.connectedPlayers(room);
    if (connected.length > 0 && connected.every((p) => pf.outcomes[p.id])) this.scoreRace(room);
    return { ok: true };
  }

  scoreRace(room) {
    this.disarmTimer(room);
    const pf = room.platformer;
    pf.phase = "results";
    const connected = this.roomManager.connectedPlayers(room);
    const reached = connected.filter((p) => pf.outcomes[p.id]?.outcome === "goal");
    const soloBonus = reached.length === 1 && connected.length > 1;

    const ranking = connected.map((p) => {
      const got = pf.outcomes[p.id]?.outcome === "goal";
      let pts = 0;
      if (got) pts = 1 + (soloBonus ? 2 : 0);
      p.score = (p.score ?? 0) + pts;
      return {
        playerId: p.id, name: p.name, avatar: p.avatar,
        reached: got, pointsAwarded: pts, totalScore: p.score,
        timeMs: pf.outcomes[p.id]?.timeMs ?? null
      };
    }).sort((a, b) => b.pointsAwarded - a.pointsAwarded || (a.timeMs ?? 9e9) - (b.timeMs ?? 9e9));

    room.state = GAME_STATES.RESULTS;
    room.deadline = null;
    const payload = {
      mode: "platformer",
      roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds,
      isFinalRound: room.roundIndex + 1 >= room.totalRounds,
      soloBonus,
      ranking
    };
    room.lastResults = payload;
    this.emitRoom(room.code, "round:results", payload);
  }

  // ---- reveal / results -----------------------------------------------------

  revealResults(room) {
    this.disarmTimer(room);
    const mode = this.mode(room);
    room.state = GAME_STATES.RESULTS;
    room.deadline = null;
    room.lastActivity = Date.now();

    if (mode === "bomb") return this.revealBombResults(room);
    if (mode === "map") return this.revealMapResults(room);

    const question = room.currentQuestion;
    const correctAnswer = question.answer;

    const players = Object.values(room.players).map((p) => ({
      id: p.id,
      name: p.name,
      guess: p.guess
    }));
    const scored = calculateRoundScores(players, correctAnswer);
    const pointsById = new Map(scored.map((s) => [s.playerId, s]));
    for (const s of scored) room.players[s.playerId].score += s.pointsAwarded;

    const ranking = scored.map((s) => ({
      playerId: s.playerId,
      name: s.name,
      guess: s.guess,
      distance: s.distance,
      pointsAwarded: s.pointsAwarded,
      totalScore: room.players[s.playerId].score
    }));
    const noAnswer = Object.values(room.players)
      .filter((p) => !pointsById.has(p.id))
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        guess: null,
        distance: null,
        pointsAwarded: 0,
        totalScore: p.score
      }));

    if (mode === "timeline") {
      room.placedEvents.push({ label: question.text, year: correctAnswer });
    }

    const payload = {
      mode,
      correctAnswer,
      unit: question.unit,
      questionText: question.text,
      roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds,
      isFinalRound: room.roundIndex + 1 >= room.totalRounds,
      ranking,
      noAnswer,
      placedEvents: mode === "timeline" ? room.placedEvents.slice() : undefined
    };
    room.lastResults = payload;
    this.emitRoom(room.code, "round:results", payload);
  }

  revealMapResults(room) {
    const question = room.currentQuestion;
    const answer = question.answer; // { lat, lng }
    const acceptableRadiusKm = question.acceptableRadiusKm || 0;

    // Distance (km) for each player; rank by distance via the shared scorer
    // (feed distance as the "guess" against a correct answer of 0).
    const dist = Object.values(room.players).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      guess: p.guess && Number.isFinite(p.guess.lat) ? p.guess : null,
      distanceKm: p.guess && Number.isFinite(p.guess.lat)
        ? (question.countryCode && pointInCountry(question.countryCode, p.guess)
          ? 0
          : Math.max(0, haversineKm(p.guess, answer) - acceptableRadiusKm))
        : null
    }));
    const scored = calculateRoundScores(
      dist.filter((d) => d.distanceKm !== null).map((d) => ({ id: d.id, name: d.name, guess: d.distanceKm })),
      0
    );
    const pointsById = new Map(scored.map((s) => [s.playerId, s]));
    for (const s of scored) {
      room.players[s.playerId].score += s.pointsAwarded;
      room.players[s.playerId].mapDistanceKm =
        Math.round(((room.players[s.playerId].mapDistanceKm || 0) + s.guess)*10)/10;
    }

    const ranking = scored.map((s) => {
      const d = dist.find((x) => x.id === s.playerId);
      return {
        playerId: s.playerId,
        name: s.name,
        avatar: d.avatar,
        guess: d.guess,
        distanceKm: Math.round(d.distanceKm*10)/10,
        withinTarget: d.distanceKm === 0,
        cumulativeDistanceKm: room.players[s.playerId].mapDistanceKm,
        pointsAwarded: s.pointsAwarded,
        totalScore: room.players[s.playerId].score
      };
    });
    const noAnswer = dist.filter((d) => d.distanceKm === null).map((d) => ({
      playerId: d.id, name: d.name, avatar: d.avatar,
      guess: null, distanceKm: null, pointsAwarded: 0, totalScore: room.players[d.id].score
    }));

    const payload = {
      mode: "map",
      prompt: question.text,
      answer,
      acceptableRadiusKm,
      roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds,
      isFinalRound: room.roundIndex + 1 >= room.totalRounds,
      ranking,
      noAnswer
    };
    room.lastResults = payload;
    this.emitRoom(room.code, "round:results", payload);
  }

  revealBombResults(room) {
    const bomb = room.bomb;
    const popperId = bomb.popperId;
    // Everyone who was connected this round except the popper survives.
    const ranking = room.turnOrder.map((id) => {
      const p = room.players[id];
      const survived = id !== popperId;
      const pts = survived ? BOMB_SURVIVOR_POINTS : 0;
      if (p) p.score += pts;
      return {
        playerId: id,
        name: p?.name ?? "?",
        survived,
        pointsAwarded: pts,
        totalScore: p?.score ?? 0
      };
    });

    const payload = {
      mode: "bomb",
      popperId,
      popperName: room.players[popperId]?.name,
      threshold: bomb.threshold,
      total: bomb.total,
      roundNumber: room.roundIndex + 1,
      totalRounds: room.totalRounds,
      isFinalRound: room.roundIndex + 1 >= room.totalRounds,
      ranking
    };
    room.lastResults = payload;
    this.emitRoom(room.code, "round:results", payload);
  }

  // ---- round transitions ----------------------------------------------------

  nextRound(room, socketId) {
    if (!room) return { ok: false, error: "Room not found." };
    if (socketId !== room.hostId) {
      return { ok: false, error: "Only the host can advance the round." };
    }
    if (room.state !== GAME_STATES.RESULTS) {
      return { ok: false, error: "The round is not finished yet." };
    }
    if (room.roundIndex + 1 >= room.totalRounds) {
      this.finishMode(room);
      return { ok: true };
    }
    room.roundIndex += 1;
    this.beginRound(room);
    return { ok: true };
  }

  finishGame(room, extra = {}) {
    this.disarmTimer(room);
    room.state = GAME_STATES.FINISHED;
    room.currentQuestion = null;
    room.deadline = null;
    room.lastActivity = Date.now();

    const standings = room.arcade?.battle ? this.battleStandings(room) : Object.values(room.players)
      .map((p) => ({
        playerId: p.id, name: p.name, avatar: p.avatar, score: p.score,
        cumulativeDistanceKm: p.mapDistanceKm
      }))
      .sort((a, b) => b.score - a.score);

    const topScore = standings.length ? standings[0].score : 0;
    const winners = standings.filter((s) => s.score === topScore);

    const payload = {
      mode: this.mode(room),
      arcade: !!room.arcade,
      battle: !!room.arcade?.battle,
      standings,
      winners,
      winner: winners.length === 1 ? winners[0] : null,
      ...extra
    };
    if (this.mode(room) === "timeline") payload.timelines = this.buildTimelines(room);
    room.lastFinal = payload;
    this.emitRoom(room.code, "game:finished", payload);
  }

  restartGame(room, socketId) {
    if (!room) return { ok: false, error: "Room not found." };
    if (socketId !== room.hostId) {
      return { ok: false, error: "Only the host can restart." };
    }
    this.disarmTimer(room);
    room.state = GAME_STATES.LOBBY;
    room.roundIndex = 0;
    room.questions = [];
    room.currentQuestion = null;
    room.deadline = null;
    room.placedEvents = [];
    room.bomb = null;
    room.hitster = null;
    room.drawPile = [];
    room.drawPointer = 0;
    room.currentCard = null;
    room.sharedTimeline = [];
    room.votes = {};
    room.lastPlacement = null;
    room.drawing = null;
    room.pushy = null;
    room.redlight = null;
    room.hidebomb = null;
    room.arena = null;
    room.doors = null;
    room.turnOrder = [];
    room.turnIndex = 0;
    room.arcade = null;
    room.currentMode = null;
    room.lastIntermission = null;
    room.lastResults = null;
    room.lastFinal = null;
    room.lastActivity = Date.now();
    for (const player of Object.values(room.players)) {
      player.score = 0;
      player.guess = null;
      player.cards = [];
    }
    return { ok: true };
  }

  // ---- resume + disconnect --------------------------------------------------

  buildResume(room, socketId) {
    const base = { state: room.state, mode: this.mode(room) };
    if (room.state === GAME_STATES.QUESTION) {
      const mode = this.mode(room);
      if (mode === "curling") {
        return {
          ...base,
          turn: {
            mode: "curling",
            roundNumber: room.roundIndex + 1,
            totalRounds: room.totalRounds,
            question: toPublicQuestion(room.currentQuestion),
            activePlayerId: room.turnOrder[room.turnIndex],
            order: this.curlingOrderView(room),
            shots: this.curlingShots(room),
            stones:room.curlingStones,
            deadline: room.deadline
          }
        };
      }
      if (mode === "bomb") {
        const activeId = room.turnOrder[room.turnIndex % room.turnOrder.length];
        return {
          ...base,
          turn: {
            mode: "bomb",
            roundNumber: room.roundIndex + 1,
            totalRounds: room.totalRounds,
            activePlayerId: activeId,
            total: room.bomb?.total ?? 0,
            order: this.bombOrderView(room, activeId),
            deadline: room.deadline
          }
        };
      }
      if (mode === "platformer") {
        const pf = room.platformer;
        if (pf?.phase === "mapvote") {
          const votes={};
          Object.values(pf.mapVotes||{}).forEach((id)=>{votes[id]=(votes[id]||0)+1;});
          return {...base,platformer:{
            phase:"mapvote",maps:this.publicPlatformerMaps(room),votes,
            votedPlayerIds:Object.keys(pf.mapVotes||{}),deadline:room.deadline
          }};
        }
        if (pf?.phase === "maproulette") {
          return {...base,platformer:{
            phase:"maproulette",maps:this.publicPlatformerMaps(room),
            selectedId:pf.mapChosen,rouletteMs:Math.max(0,room.deadline-Date.now()),deadline:room.deadline
          }};
        }
        if (pf?.phase === "build") {
          return {
            ...base,
            platformer: {
              phase: "build",
              roundNumber: room.roundIndex + 1,
              totalRounds: room.totalRounds,
              level: pf.level,
              hand: this.platformerHand(),
              pool: this.platformerPoolRemaining(room),
              builders: this.platformerBuilders(room),
              removableTiles: Object.keys(pf.removableTiles||{}),
              players: this.roomManager.connectedPlayers(room).map((p) => ({
                playerId: p.id, name: p.name, avatar: p.avatar
              })),
              placements: this.publicPlacements(room),
              standings: this.standings(room),
              deadline: room.deadline
            }
          };
        }
        return {
          ...base,
          platformer: {
            phase: "race",
            roundNumber: room.roundIndex + 1,
            totalRounds: room.totalRounds,
            level: pf?.level,
            players: this.platformerPositions(room),
            deadline: room.deadline,
            alreadyDone: !!pf?.outcomes?.[socketId]
          }
        };
      }
      if (mode === "drawing") {
        const d = room.drawing;
        return {
          ...base,
          drawing: {
            mode: "drawing", roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
            drawerId: d.drawerId, drawerName: room.players[d.drawerId]?.name,
            wordLength: d.word.length, deadline: room.deadline,
            strokes: d.strokes, alreadyGuessed: !!d.guessed[socketId],
            word: socketId === d.drawerId ? d.word : undefined
          }
        };
      }
      if (mode === "pushy") {
        return {
          ...base,
          pushy: {
            ...room.pushy.round,
            alreadyDone: !!room.pushy.outcomes[socketId],
            players: this.pushyPositions(room)
          }
        };
      }
      if (mode === "redlight") {
        this.syncRedLightBattery(room.redlight);
        return {
          ...base,
          redlight: {
            mode: "redlight", roundNumber: room.roundIndex + 1, totalRounds: room.totalRounds,
            light: room.redlight.light, controllerId: room.redlight.controllerId,
            controllerName: room.players[room.redlight.controllerId]?.name,
            battery: room.redlight.battery,
            players: this.redLightPlayers(room),
            deadline: room.deadline
          }
        };
      }
      if (mode === "hidebomb") {
        const hb = room.hidebomb;
        return {
          ...base,
          hidebomb: {
            ...this.hideBombPublic(room),
            ownChoice: hb.choices[socketId],
            choices: hb.stage === "reveal"
              ? Object.entries(hb.choices).filter(([, choice]) => choice === hb.lastTarget).map(([id, choice]) => ({
                playerId: id, name: room.players[id]?.name,
                avatar: room.players[id]?.avatar, objectIndex: choice
              }))
              : undefined
          }
        };
      }
      if (["colorfloor", "vanish", "bombpass", "fire", "racing", "flappy", "runner", "painter", "pong"].includes(mode) && room.arena) {
        return { ...base, arena: this.arenaPublic(room) };
      }
      if (mode === "doors" && room.doors) {
        return { ...base, doors: this.doorsPublic(room, false) };
      }
      if (mode === "timeline" && room.hitster?.teamVote) {
        return { ...base, turn: room.currentCard ? this.teamRoundPayload(room) : { mode: "timeline", teamVote: true } };
      }
      if (mode === "timeline") {
        const activeId = room.turnOrder[room.turnIndex % room.turnOrder.length];
        return {
          ...base,
          turn: {
            mode: "timeline",
            activePlayerId: activeId,
            card: room.currentCard
              ? { id: room.currentCard.id, label: room.currentCard.label, category: room.currentCard.category }
              : null,
            target: room.hitster?.target ?? 11,
            timelines: this.buildTimelines(room),
            deadline: room.deadline
          }
        };
      }
      const player = room.players[socketId];
      return {
        ...base,
        question: {
          mode,
          roundNumber: room.roundIndex + 1,
          totalRounds: room.totalRounds,
          question: toPublicQuestion(room.currentQuestion),
          deadline: room.deadline,
          placedEvents: mode === "timeline" ? room.placedEvents.slice() : undefined
        },
        yourGuess: player ? player.guess : null,
        progress: this.progress(room)
      };
    }
    if (room.state === GAME_STATES.RESULTS) return { ...base, results: room.lastResults ?? null };
    if (room.state === GAME_STATES.INTERMISSION) return { ...base, intermission: room.lastIntermission ?? null };
    if (room.state === GAME_STATES.FINISHED) return { ...base, final: room.lastFinal ?? null };
    return base;
  }

  handleDisconnectDuringGame(room) {
    if (!room || room.state !== GAME_STATES.QUESTION) return;
    const mode = this.mode(room);
    if (SIMULTANEOUS_MODES.has(mode)) {
      if (this.allConnectedSubmitted(room)) this.revealResults(room);
    } else if (mode === "curling") {
      // If the disconnected player was the active shooter, move on.
      const activeId = room.turnOrder[room.turnIndex];
      if (!room.players[activeId]?.connected) this.advanceCurling(room);
    } else if (mode === "bomb") {
      const activeId = room.turnOrder[room.turnIndex % room.turnOrder.length];
      if (!room.players[activeId]?.connected) {
        room.turnIndex++;
        this.startBombTurn(room);
      }
    } else if (mode === "timeline" && room.hitster?.teamVote) {
      // If the remaining connected voters have all locked in, resolve.
      const connected = this.roomManager.connectedPlayers(room);
      const allLocked = connected.length > 0 &&
        connected.every((p) => room.votes?.[p.id]?.locked);
      if (allLocked) this.resolveTeamVote(room);
    } else if (mode === "platformer" && room.platformer?.phase === "build") {
      const connected = this.roomManager.connectedPlayers(room);
      const allLocked = connected.length > 0 &&
        connected.every((p) => room.platformer.placements[p.id]?.locked);
      if (allLocked) this.commitBuild(room);
    } else if (mode === "platformer" && room.platformer?.phase === "race") {
      const connected = this.roomManager.connectedPlayers(room);
      if (connected.length > 0 && connected.every((p) => room.platformer.outcomes[p.id])) {
        this.scoreRace(room);
      }
    } else if (mode === "drawing") {
      if (room.drawing?.drawerId === room.players[room.drawing.drawerId]?.id &&
          !room.players[room.drawing.drawerId]?.connected) {
        this.finishDrawingRound(room);
      } else {
        const remaining = this.roomManager.connectedPlayers(room)
          .filter((p) => p.id !== room.drawing.drawerId && !room.drawing.guessed[p.id]);
        if (remaining.length === 0) this.finishDrawingRound(room);
      }
    } else if (mode === "pushy") {
      const connected = this.roomManager.connectedPlayers(room);
      if (connected.every((p) => room.pushy.outcomes[p.id])) this.finishPushyRound(room);
    } else if (mode === "redlight") {
      if (!room.players[room.redlight.controllerId]?.connected) {
        this.finishRedLightRound(room);
        return;
      }
      const active = Object.entries(room.redlight.players).filter(([id, p]) =>
        id !== room.redlight.controllerId && room.players[id]?.connected && !p.eliminated && !p.finished);
      if (active.length === 0) this.finishRedLightRound(room);
    } else if (mode === "hidebomb") {
      const hb = room.hidebomb;
      if (!room.players[hb.bomberId]?.connected) {
        this.finishHideBombRound(room);
      } else if (hb.stage === "hide") {
        const active = Object.entries(hb.alive)
          .filter(([id, alive]) => alive && room.players[id]?.connected).map(([id]) => id);
        if (active.every((id) => Number.isInteger(hb.choices[id]))) this.startHideBombAttack(room);
      }
    } else if (mode === "timeline") {
      const activeId = room.turnOrder[room.turnIndex % room.turnOrder.length];
      if (!room.players[activeId]?.connected) {
        room.turnIndex++;
        this.startTimelineTurn(room);
      }
    }
  }
}

module.exports = {
  GameManager,
  ROUND_DURATION_MS,
  GUESS_MIN,
  GUESS_MAX,
  BOMB_SURVIVOR_POINTS,
  VANISH_LAYERS,
  tileCellAt,
  PLAT
};
