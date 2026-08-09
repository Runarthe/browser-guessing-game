"use strict";

const crypto = require("crypto");

/**
 * Room lifecycle and membership management for Confetti.
 *
 * Rooms live entirely in server memory. This module owns room creation, code
 * generation, player membership, host identity/migration and cleanup. It does
 * NOT run the game loop — see gameManager.js for that.
 */

const GAME_STATES = {
  LOBBY: "lobby",
  QUESTION: "question",
  RESULTS: "results",
  INTERMISSION: "intermission", // arcade: between two modes in a playlist
  FINISHED: "finished"
};

// Exclude confusing characters (0, O, 1, I).
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

const NAME_MIN = 2;
const NAME_MAX = 20;

// Rooms inactive for longer than this are cleaned up.
const ROOM_TTL_MS = 60 * 60 * 1000; // ~1 hour
// A lobby seat is held this long after a drop, so locking your phone or a brief
// wifi stumble doesn't cost you your place.
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;
// A room with nobody in it survives this long, so a total blip (router reset,
// host backgrounding the app) doesn't destroy a game everyone can return to.
const EMPTY_ROOM_GRACE_MS = 5 * 60 * 1000;

// Available game modes and settings bounds.
const GAME_MODES = ["trivia", "timeline", "curling", "golf", "bomb", "map", "platformer", "drawing", "pushy", "redlight", "hidebomb", "colorfloor", "vanish", "bombpass", "fire", "racing", "flappy", "runner", "painter", "pong", "doors"];
const ALLOWED_ROUNDS = Array.from({length:15},(_,i)=>i+1);
const ALLOWED_SECONDS = Array.from({length:23},(_,i)=>10+i*5);
// Hitster (timeline) target: first player to this many cards wins.
const ALLOWED_TARGETS = Array.from({length:20},(_,i)=>i+1);
const ALLOWED_BATTLE_TARGETS = Array.from({length:15},(_,i)=>i+1);

// Character creator options (validated server-side so clients can't inject junk).
// The catalogue is shared with the browser via public/progression.js so an
// unlockable cosmetic can never exist on one side only.
const Progression = require("../public/progression.js");
const AVATAR_EMOJIS = Progression.EMOJI_VALUES;
const AVATAR_COLORS = Progression.COLOR_VALUES;
// Room capacity used to be implied by AVATAR_COLORS.length, which meant adding
// a single unlockable colour silently raised the player cap. Now explicit.
const MAX_PLAYERS = Progression.MAX_PLAYERS;

function defaultSettings() {
  return {
    mode: "trivia",
    rounds: 5,
    roundSeconds: 45,
    // Hitster win target (timeline mode).
    target: 11,
    // Battle mode: a rotating player spins a random minigame wheel; first to
    // the configured number of minigame wins takes the match.
    arcade: false,
    battleTarget: 5,
    playlist: ["curling", "platformer", "pushy", "hidebomb", "colorfloor", "vanish", "fire", "racing", "flappy", "runner", "painter", "pong"],
    // null = all trivia categories enabled. Otherwise an array of category names.
    categories: null
  };
}

/** Clamp a client-supplied avatar to the allowed sets, with defaults.
 *  Title and frame are cosmetic and unlocked client-side; the server only
 *  checks that they name real catalogue entries before broadcasting them. */
function validateAvatar(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  return {
    emoji: AVATAR_EMOJIS.includes(a.emoji) ? a.emoji : AVATAR_EMOJIS[0],
    color: AVATAR_COLORS.includes(a.color) ? a.color : AVATAR_COLORS[1],
    title: Progression.TITLE_IDS.includes(a.title) ? a.title : "none",
    frame: Progression.FRAME_IDS.includes(a.frame) ? a.frame : "none"
  };
}

/** Return a validated avatar whose colour is not already used in the room. */
function uniqueAvatar(room, raw, playerId = null) {
  const avatar = validateAvatar(raw);
  const used = new Set(Object.values(room?.players || {})
    .filter((p) => p.id !== playerId && p.connected !== false)
    .map((p) => p.avatar?.color));
  if (!used.has(avatar.color)) return avatar;
  avatar.color = AVATAR_COLORS.find((color) => !used.has(color)) || avatar.color;
  return avatar;
}

class RoomManager {
  constructor() {
    /** @type {Map<string, object>} code -> room */
    this.rooms = new Map();
  }

  generateRoomCode() {
    let code;
    do {
      code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
      }
    } while (this.rooms.has(code));
    return code;
  }

  /**
   * Validate and normalise a player name.
   * @returns {{ok: true, name: string} | {ok: false, error: string}}
   */
  static validateName(rawName) {
    if (typeof rawName !== "string") {
      return { ok: false, error: "Name is required." };
    }
    const name = rawName.trim();
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      return { ok: false, error: `Name must be ${NAME_MIN}–${NAME_MAX} characters.` };
    }
    return { ok: true, name };
  }

  isNameTaken(room, name) {
    const lowered = name.toLowerCase();
    return Object.values(room.players).some(
      (player) => player.name.toLowerCase() === lowered
    );
  }

  /**
   * Create a new room with the caller as host.
   * @returns {{ok: true, room: object} | {ok: false, error: string}}
   */
  createRoom(socketId, rawName, avatar) {
    const check = RoomManager.validateName(rawName);
    if (!check.ok) return check;

    const code = this.generateRoomCode();
    const room = {
      code,
      hostId: socketId,
      state: GAME_STATES.LOBBY,
      roundIndex: 0,
      totalRounds: 5,
      settings: defaultSettings(),
      players: {},
      questions: [],
      currentQuestion: null,
      deadline: null,
      // Question ids already used in this room, so replays don't repeat.
      usedQuestionIds: [],
      // Turn state (curling / bomb modes).
      turnOrder: [],
      turnIndex: 0,
      createdAt: Date.now(),
      lastActivity: Date.now()
    };
    room.players[socketId] = this.makePlayer(socketId, check.name, uniqueAvatar(room, avatar));
    this.rooms.set(code, room);
    return { ok: true, room };
  }

  makePlayer(socketId, name, avatar) {
    return {
      id: socketId,
      // Stable identity that survives a socket reconnect (page refresh).
      token: crypto.randomUUID(),
      name,
      avatar: validateAvatar(avatar),
      score: 0,
      guess: null,
      // Hitster (timeline) per-player card row.
      cards: [],
      connected: true
    };
  }

  /** Find a player in a room by their stable rejoin token. */
  findPlayerByToken(room, token) {
    if (!room || typeof token !== "string") return null;
    return Object.values(room.players).find((p) => p.token === token) ?? null;
  }

  /**
   * Reconnect an existing player under a new socket id (e.g. after a page
   * refresh). The player keeps their score, name and any in-round guess, and
   * regains host status if they were the host.
   *
   * @returns {{ok: true, room: object, player: object, wasHost: boolean}
   *          | {ok: false, error: string}}
   */
  rejoinRoom(newSocketId, code, token) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: "Room not found." };
    const player = this.findPlayerByToken(room, token);
    if (!player) {
      return { ok: false, error: "Could not rejoin — session expired." };
    }

    const oldId = player.id;
    const wasHost = room.hostId === oldId;
    // They're back: cancel both grace timers.
    player.disconnectedAt = null;
    room.emptySince = null;

    // Re-key the player entry under the new socket id.
    if (oldId !== newSocketId) {
      delete room.players[oldId];
      player.id = newSocketId;
      room.players[newSocketId] = player;
      if (wasHost) room.hostId = newSocketId;
      // Re-key mode state that stores socket ids so an in-progress action can
      // continue after refresh.
      if (Array.isArray(room.turnOrder)) {
        room.turnOrder = room.turnOrder.map((id) => id === oldId ? newSocketId : id);
      }
      if(Array.isArray(room.golf?.openingOrder))room.golf.openingOrder=room.golf.openingOrder.map((id)=>id===oldId?newSocketId:id);
      if(room.golf?.openingPlayerId===oldId)room.golf.openingPlayerId=newSocketId;
      for (const bag of [room.votes, room.platformer?.placements, room.platformer?.outcomes,
        room.pushy?.outcomes, room.pushy?.positions, room.drawing?.guessed,
        room.arena?.positions, room.arena?.eliminated, room.arena?.finished,
        room.arena?.upgrades, room.arena?.lives, room.arena?.playerSides,
        room.arena?.painterSpawns, room.arena?.painterTrails, room.doors?.hearts,
        room.doors?.choices, room.doors?.revealed, room.doors?.stageByPlayer, room.doors?.botTargets,
        room.doors?.eliminated, room.doors?.finished, room.doors?.positions]) {
        if (bag && Object.prototype.hasOwnProperty.call(bag, oldId)) {
          bag[newSocketId] = bag[oldId];
          delete bag[oldId];
        }
      }
      for(const bag of [room.golf?.balls,room.golf?.shots]){
        if(bag&&Object.prototype.hasOwnProperty.call(bag,oldId)){bag[newSocketId]=bag[oldId];delete bag[oldId];if(bag[newSocketId]?.playerId)bag[newSocketId].playerId=newSocketId;}
      }
      if (room.drawing?.drawerId === oldId) room.drawing.drawerId = newSocketId;
      if (room.redlight?.players?.[oldId]) {
        room.redlight.players[newSocketId] = room.redlight.players[oldId];
        delete room.redlight.players[oldId];
      }
      if (room.redlight?.controllerId === oldId) room.redlight.controllerId = newSocketId;
      if (room.hidebomb?.bomberId === oldId) room.hidebomb.bomberId = newSocketId;
      if (room.arena?.holderId === oldId) room.arena.holderId = newSocketId;
      if (room.arena?.previousHolderId === oldId) room.arena.previousHolderId = newSocketId;
      if (room.arcade?.spinnerId === oldId) room.arcade.spinnerId = newSocketId;
      for (const bag of [room.arcade?.wins, room.arcade?.scoresAtLegStart]) {
        if (bag && Object.prototype.hasOwnProperty.call(bag, oldId)) {
          bag[newSocketId] = bag[oldId];
          delete bag[oldId];
        }
      }
      if (room.lastIntermission) {
        if (room.lastIntermission.spinnerId === oldId) room.lastIntermission.spinnerId = newSocketId;
        if (Array.isArray(room.lastIntermission.lastWinners)) {
          room.lastIntermission.lastWinners = room.lastIntermission.lastWinners.map((id) => id === oldId ? newSocketId : id);
        }
        if (Array.isArray(room.lastIntermission.standings)) for (const row of room.lastIntermission.standings) {
          if (row.playerId === oldId) row.playerId = newSocketId;
        }
        if (room.lastIntermission.wins && Object.prototype.hasOwnProperty.call(room.lastIntermission.wins, oldId)) {
          room.lastIntermission.wins[newSocketId] = room.lastIntermission.wins[oldId];
          delete room.lastIntermission.wins[oldId];
        }
      }
      if (Array.isArray(room.arena?.finishOrder)) room.arena.finishOrder = room.arena.finishOrder.map((id) => id === oldId ? newSocketId : id);
      if (room.arena?.painterTerritory) for (const key of Object.keys(room.arena.painterTerritory)) {
        if (room.arena.painterTerritory[key] === oldId) room.arena.painterTerritory[key] = newSocketId;
      }
      for (const bag of [room.hidebomb?.alive, room.hidebomb?.choices, room.hidebomb?.points]) {
        if (bag && Object.prototype.hasOwnProperty.call(bag, oldId)) {
          bag[newSocketId] = bag[oldId];
          delete bag[oldId];
        }
      }
    }
    player.connected = true;
    room.lastActivity = Date.now();

    return { ok: true, room, player, wasHost };
  }

  getRoom(code) {
    if (typeof code !== "string") return null;
    return this.rooms.get(code.toUpperCase()) ?? null;
  }

  /**
   * Add a player to an existing room.
   * @returns {{ok: true, room: object} | {ok: false, error: string}}
   */
  joinRoom(socketId, code, rawName, avatar) {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: "Room not found." };
    if (room.state !== GAME_STATES.LOBBY) {
      return { ok: false, error: "This game has already started." };
    }
    const check = RoomManager.validateName(rawName);
    if (!check.ok) return check;
    if (this.isNameTaken(room, check.name)) {
      return { ok: false, error: "That name is already taken in this room." };
    }
    if (this.connectedPlayers(room).length >= MAX_PLAYERS) {
      return { ok: false, error: `This room is full (${MAX_PLAYERS} players max).` };
    }
    room.players[socketId] = this.makePlayer(socketId, check.name, uniqueAvatar(room, avatar));
    room.lastActivity = Date.now();
    return { ok: true, room };
  }

  connectedPlayers(room) {
    return Object.values(room.players).filter((p) => p.connected);
  }

  updateAvatar(room, socketId, rawAvatar) {
    if (!room?.players?.[socketId]) return { ok: false, error: "Player not found." };
    if (room.state !== GAME_STATES.LOBBY) return { ok: false, error: "Appearance is locked during a game." };
    const requested = validateAvatar(rawAvatar);
    const avatar = uniqueAvatar(room, requested, socketId);
    room.players[socketId].avatar = avatar;
    room.lastActivity = Date.now();
    return { ok: true, avatar, colorAdjusted: avatar.color !== requested.color };
  }

  /**
   * Update room settings. Host only, lobby only. Unknown/invalid values are
   * ignored so a malformed client cannot corrupt the room.
   * @returns {{ok: true, settings: object} | {ok: false, error: string}}
   */
  updateSettings(room, socketId, patch = {}) {
    if (!room) return { ok: false, error: "Room not found." };
    if (room.hostId !== socketId) {
      return { ok: false, error: "Only the host can change settings." };
    }
    if (room.state !== GAME_STATES.LOBBY) {
      return { ok: false, error: "Settings are locked once the game starts." };
    }
    const s = room.settings;
    if (typeof patch.mode === "string" && GAME_MODES.includes(patch.mode)) {
      s.mode = patch.mode;
    }
    if (ALLOWED_ROUNDS.includes(Number(patch.rounds))) {
      s.rounds = Number(patch.rounds);
    }
    if (ALLOWED_SECONDS.includes(Number(patch.roundSeconds))) {
      s.roundSeconds = Number(patch.roundSeconds);
    }
    if (ALLOWED_TARGETS.includes(Number(patch.target))) {
      s.target = Number(patch.target);
    }
    if (ALLOWED_BATTLE_TARGETS.includes(Number(patch.battleTarget))) {
      s.battleTarget = Number(patch.battleTarget);
    }
    if (typeof patch.arcade === "boolean") {
      s.arcade = patch.arcade;
    }
    if (Array.isArray(patch.playlist)) {
      // Keep only valid modes, in the given order; ignore an empty result.
      const clean = patch.playlist.filter((m) => GAME_MODES.includes(m));
      if (clean.length) s.playlist = clean;
    }
    if (patch.categories === null) {
      s.categories = null;
    } else if (Array.isArray(patch.categories)) {
      const clean = patch.categories.filter((c) => typeof c === "string");
      s.categories = clean.length ? clean : null;
    }
    room.lastActivity = Date.now();
    return { ok: true, settings: s };
  }

  /**
   * Remove a player from a room. In the lobby the player is removed outright;
   * mid-game they are marked disconnected but their score is retained.
   * Handles host migration and empty-room deletion.
   *
   * @returns {{room: object|null, hostChanged: boolean, deleted: boolean}}
   */
  removePlayer(socketId, code, { explicit = false } = {}) {
    const room = this.getRoom(code);
    if (!room || !room.players[socketId]) {
      return { room: null, hostChanged: false, deleted: false, empty: false };
    }

    const wasHost = room.hostId === socketId;
    const now = Date.now();
    const player = room.players[socketId];

    if (explicit) {
      // They pressed Leave. Honour it immediately — no seat held.
      delete room.players[socketId];
    } else if (room.state === GAME_STATES.LOBBY) {
      // A dropped connection in the lobby is usually a phone locking its
      // screen, not someone leaving. Hold the seat briefly so they come back
      // to the same spot instead of losing it.
      player.connected = false;
      player.disconnectedAt = now;
    } else {
      player.connected = false;
      player.disconnectedAt = now;
      player.guess = null;
    }
    room.lastActivity = now;

    // An empty room is kept for a grace period rather than destroyed, so a
    // brief total outage (router blip, host alt-tabbing on mobile) doesn't
    // vaporise a game in progress. Cleanup sweeps it up if nobody returns.
    const stillConnected = this.connectedPlayers(room);
    if (stillConnected.length === 0) {
      room.emptySince = now;
      return { room, hostChanged: false, deleted: false, empty: true };
    }
    room.emptySince = null;

    // Migrate host if the host left.
    let hostChanged = false;
    if (wasHost) {
      room.hostId = stillConnected[0].id;
      hostChanged = true;
    }

    return { room, hostChanged, deleted: false, empty: false };
  }

  deleteRoom(code) {
    const room = this.getRoom(code);
    if (room) this.rooms.delete(room.code);
  }

  /**
   * Sweep expired state. Handles three separate lifetimes:
   *   - lobby seats held for a disconnected player (short)
   *   - rooms nobody has returned to (medium)
   *   - rooms idle far too long (the original TTL)
   *
   * @returns {{removed: number, changed: string[]}} `changed` lists room codes
   *          whose player list altered, so the caller can re-broadcast them.
   */
  cleanupInactiveRooms(now = Date.now()) {
    let removed = 0;
    const changed = [];
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > ROOM_TTL_MS) {
        this.rooms.delete(code);
        removed++;
        continue;
      }
      // Nobody came back — drop the room once the grace period lapses.
      if (room.emptySince && now - room.emptySince > EMPTY_ROOM_GRACE_MS) {
        this.rooms.delete(code);
        removed++;
        continue;
      }
      // Release lobby seats still held by players who never returned.
      if (room.state === GAME_STATES.LOBBY) {
        let dropped = false;
        for (const [id, player] of Object.entries(room.players)) {
          if (player.connected === false && player.disconnectedAt &&
              now - player.disconnectedAt > DISCONNECT_GRACE_MS) {
            delete room.players[id];
            dropped = true;
          }
        }
        if (dropped) {
          const left = this.connectedPlayers(room);
          if (left.length === 0) {
            room.emptySince = room.emptySince || now;
          } else if (!room.players[room.hostId]) {
            room.hostId = left[0].id;      // host's seat expired; migrate
          }
          changed.push(code);
        }
      }
    }
    return { removed, changed };
  }
}

module.exports = {
  RoomManager,
  GAME_STATES,
  GAME_MODES,
  ALLOWED_ROUNDS,
  ALLOWED_SECONDS,
  ALLOWED_TARGETS,
  ALLOWED_BATTLE_TARGETS,
  AVATAR_EMOJIS,
  AVATAR_COLORS,
  MAX_PLAYERS,
  validateAvatar,
  uniqueAvatar,
  defaultSettings,
  ROOM_CODE_CHARS,
  ROOM_CODE_LENGTH,
  NAME_MIN,
  NAME_MAX,
  ROOM_TTL_MS,
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_GRACE_MS
};
