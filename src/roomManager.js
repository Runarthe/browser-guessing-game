"use strict";

const crypto = require("crypto");

/**
 * Room lifecycle and membership management for Closest Wins.
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

// Available game modes and settings bounds.
const GAME_MODES = ["trivia", "timeline", "curling", "bomb", "map", "platformer", "drawing", "pushy", "redlight", "hidebomb", "colorfloor", "vanish", "bombpass", "fire", "racing", "flappy", "runner", "painter", "pong", "doors"];
const ALLOWED_ROUNDS = [3, 5, 7, 10];
const ALLOWED_SECONDS = [20, 30, 45, 60, 90];
// Hitster (timeline) target: first player to this many cards wins.
const ALLOWED_TARGETS = [5, 7, 10, 11, 15];

// Character creator options (validated server-side so clients can't inject junk).
const AVATAR_EMOJIS = ["🦊", "🐼", "🐸", "🐙", "🦉", "🐝", "🦄", "🐲", "🐳", "🦁", "🐧", "🦖", "🐢", "🐬", "🦇", "🐰"];
const AVATAR_COLORS = ["#ff6b6b", "#ffcb3d", "#4ade80", "#60a5fa", "#f472b6", "#a78bfa", "#22d3ee", "#fb923c"];

function defaultSettings() {
  return {
    mode: "trivia",
    rounds: 5,
    roundSeconds: 45,
    // Hitster win target (timeline mode).
    target: 11,
    // Arcade: play a sequence of modes back-to-back, scores carrying over.
    arcade: false,
    playlist: ["trivia", "bomb", "curling", "timeline"],
    // null = all trivia categories enabled. Otherwise an array of category names.
    categories: null
  };
}

/** Clamp a client-supplied avatar to the allowed sets, with defaults. */
function validateAvatar(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  return {
    emoji: AVATAR_EMOJIS.includes(a.emoji) ? a.emoji : AVATAR_EMOJIS[0],
    color: AVATAR_COLORS.includes(a.color) ? a.color : AVATAR_COLORS[1]
  };
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
    room.players[socketId] = this.makePlayer(socketId, check.name, avatar);
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
      for (const bag of [room.votes, room.platformer?.placements, room.platformer?.outcomes,
        room.pushy?.outcomes, room.pushy?.positions, room.drawing?.guessed,
        room.arena?.positions, room.arena?.eliminated, room.doors?.hearts,
        room.doors?.choices, room.doors?.eliminated, room.doors?.positions]) {
        if (bag && Object.prototype.hasOwnProperty.call(bag, oldId)) {
          bag[newSocketId] = bag[oldId];
          delete bag[oldId];
        }
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
    room.players[socketId] = this.makePlayer(socketId, check.name, avatar);
    room.lastActivity = Date.now();
    return { ok: true, room };
  }

  connectedPlayers(room) {
    return Object.values(room.players).filter((p) => p.connected);
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
  removePlayer(socketId, code) {
    const room = this.getRoom(code);
    if (!room || !room.players[socketId]) {
      return { room: null, hostChanged: false, deleted: false };
    }

    const wasHost = room.hostId === socketId;

    if (room.state === GAME_STATES.LOBBY) {
      delete room.players[socketId];
    } else {
      const player = room.players[socketId];
      player.connected = false;
      player.guess = null;
    }
    room.lastActivity = Date.now();

    // Delete the room if nobody is connected any more.
    const stillConnected = this.connectedPlayers(room);
    if (stillConnected.length === 0) {
      this.rooms.delete(room.code);
      return { room: null, hostChanged: false, deleted: true };
    }

    // Migrate host if the host left.
    let hostChanged = false;
    if (wasHost) {
      room.hostId = stillConnected[0].id;
      hostChanged = true;
    }

    return { room, hostChanged, deleted: false };
  }

  deleteRoom(code) {
    const room = this.getRoom(code);
    if (room) this.rooms.delete(room.code);
  }

  /** Remove rooms that have been inactive beyond the TTL. */
  cleanupInactiveRooms(now = Date.now()) {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity > ROOM_TTL_MS) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }
}

module.exports = {
  RoomManager,
  GAME_STATES,
  GAME_MODES,
  ALLOWED_ROUNDS,
  ALLOWED_SECONDS,
  ALLOWED_TARGETS,
  AVATAR_EMOJIS,
  AVATAR_COLORS,
  validateAvatar,
  defaultSettings,
  ROOM_CODE_CHARS,
  ROOM_CODE_LENGTH,
  NAME_MIN,
  NAME_MAX,
  ROOM_TTL_MS
};
