"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const {
  RoomManager, GAME_STATES, GAME_MODES,
  ALLOWED_ROUNDS, ALLOWED_SECONDS, ALLOWED_TARGETS,
  AVATAR_EMOJIS, AVATAR_COLORS
} = require("./src/roomManager");
const { GameManager } = require("./src/gameManager");
const { categoriesForMode } = require("./src/questionManager");

const PORT = process.env.PORT || 3000;
// For testing you can temporarily allow starting with a single player.
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS || 2);
// Per-round countdown in seconds (clamped to a sane range).
const ROUND_SECONDS = Math.min(300, Math.max(5, Number(process.env.ROUND_SECONDS || 30)));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// This project is iterated on locally. Disable stale asset caching so every
// reload receives the renderer that matches the currently running server.
app.use(express.static(path.join(__dirname, "public"), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader("Cache-Control", "no-store, max-age=0")
}));

const roomManager = new RoomManager();
const gameManager = new GameManager(roomManager, {
  emitRoom: (code, event, payload) => io.to(code).emit(event, payload),
  emitSocket: (socketId, event, payload) => io.to(socketId).emit(event, payload),
  minPlayersToStart: MIN_PLAYERS,
  roundDurationMs: ROUND_SECONDS * 1000
});

/**
 * Build the client-facing view of a room. Never leaks correct answers or the
 * full question bank.
 */
function roomView(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    roundIndex: room.roundIndex,
    totalRounds: room.totalRounds,
    settings: room.settings,
    currentMode: room.currentMode ?? null,
    arcade: room.arcade
      ? { legIndex: room.arcade.legIndex, totalLegs: room.arcade.playlist.length, playlist: room.arcade.playlist }
      : null,
    players: Object.values(room.players).map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      connected: p.connected,
      hasGuessed: p.guess !== null,
      isBot: !!p.isBot
    }))
  };
}

// Static metadata the client needs to render the settings + character UI.
const GAME_META = {
  modes: GAME_MODES,
  rounds: ALLOWED_ROUNDS,
  seconds: ALLOWED_SECONDS,
  targets: ALLOWED_TARGETS,
  avatarEmojis: AVATAR_EMOJIS,
  avatarColors: AVATAR_COLORS,
  categoriesByMode: Object.fromEntries(
    GAME_MODES.map((m) => [m, categoriesForMode(m)])
  )
};

const testBotLoops = new Map();
function addTestBots(room) {
  const bots = [
    ["bot:pixel", "Pixel", { emoji: AVATAR_EMOJIS[1], color: AVATAR_COLORS[2] }],
    ["bot:sprocket", "Sprocket", { emoji: AVATAR_EMOJIS[4], color: AVATAR_COLORS[3] }],
    ["bot:bean", "Bean", { emoji: AVATAR_EMOJIS[9], color: AVATAR_COLORS[6] }]
  ];
  for (const [id, name, avatar] of bots) {
    room.players[id] = roomManager.makePlayer(id, name, avatar);
    room.players[id].isBot = true;
  }
  room.testMode = true;
}

function startTestBots(room) {
  if (!room?.testMode || testBotLoops.has(room.code)) return;
  const handle = setInterval(() => {
    const current = roomManager.getRoom(room.code);
    if (!current || !current.testMode || current.state === GAME_STATES.FINISHED) {
      clearInterval(handle); testBotLoops.delete(room.code); return;
    }
    if (current.state !== GAME_STATES.QUESTION) return;
    const bots = Object.values(current.players).filter((p) => p.isBot && p.connected);
    const mode = gameManager.mode(current);
    const activeId = current.turnOrder?.[current.turnIndex % Math.max(1, current.turnOrder.length)];
    if (mode === "bomb" && current.players[activeId]?.isBot) {
      // Pace bot pumps so each turn (and its walk-up animation) is watchable.
      const nowT = Date.now();
      if (nowT - (current._botBombAt || 0) >= 1300) {
        current._botBombAt = nowT;
        gameManager.bombPress(current, activeId, 1 + Math.floor(Math.random() * 3));
      }
      return;
    }
    if (mode === "curling" && current.players[activeId]?.isBot) {
      gameManager.submitGuess(current, activeId, Math.round(Math.random() * 1000));
      return;
    }
    for (const bot of bots) {
      if (["trivia", "map"].includes(mode) && bot.guess === null) {
        if (mode === "map") gameManager.submitGuess(current, bot.id, {
          lat: -70 + Math.random() * 140, lng: -170 + Math.random() * 340
        });
        else gameManager.submitGuess(current, bot.id, Math.round(Math.random() * 1000));
      } else if (mode === "doors" && !current.doors?.eliminated[bot.id] &&
                 !Number.isInteger(current.doors?.choices[bot.id])) {
        const d=current.doors,pos=d.positions[bot.id];
        d.botTargets[bot.id] ??= Math.floor(Math.random()*4);
        const targetX=d.botTargets[bot.id]*180+90;
        gameManager.doorsPosition(current,bot.id,{
          x:pos.x+Math.sign(targetX-pos.x)*Math.min(10,Math.abs(targetX-pos.x)),
          y:pos.y-7
        });
      } else if (["colorfloor", "vanish", "bombpass", "fire", "racing", "flappy", "pong"].includes(mode) &&
                 !current.arena?.eliminated[bot.id]) {
        const pos = current.arena?.positions[bot.id];
        if (pos) {
          if(mode==="flappy"){
            if(pos.y>235||(pos.vy||0)>150&&Math.random()<.35)gameManager.arenaJump(current,bot.id);
            continue;
          }
          if(mode==="pong"){
            const a=current.arena,sides=a.pongSides,side=a.playerSides[bot.id],angle=-Math.PI/2+side*Math.PI*2/sides;
            const tx=-Math.sin(angle),ty=Math.cos(angle),ball=a.balls.reduce((best,item)=>{
              const d=Math.hypot(item.x-360,item.y-220);return !best||d>best.d?{...item,d}:best;
            },null);
            if(ball){
              const along=(ball.x-360)*tx+(ball.y-220)*ty;
              const sideLength=2*174*Math.tan(Math.PI/sides),range=Math.max(35,sideLength-105);
              const target=Math.max(0,Math.min(1,.5+along/range));
              gameManager.arenaPosition(current,bot.id,{x:(pos.paddleT??.5)+Math.sign(target-(pos.paddleT??.5))*.075,y:0});
            }
            continue;
          }
          if(mode==="fire"&&Math.random()<.12)gameManager.arenaAction(current,bot.id);
          if(mode==="racing"){
            const tracks={
              square:[[590,90],[640,140],[640,320],[590,370],[130,370],[80,320],[80,140],[130,90]],
              swing:[[310,70],[520,105],[630,190],[540,260],[630,350],[390,375],[250,310],[90,350],[120,220],[260,205],[110,100]]
            };
            const waypoints=tracks[current.arena.trackId]||tracks.square;
            current.arena.botRace ||= {};const ri=current.arena.botRace[bot.id]||0,target=waypoints[ri];
            const dx=target[0]-pos.x,dy=target[1]-pos.y,d=Math.max(1,Math.hypot(dx,dy));
            gameManager.arenaPosition(current,bot.id,{x:pos.x+dx/d*18,y:pos.y+dy/d*18,angle:Math.atan2(dy,dx)});
            if(d<35)current.arena.botRace[bot.id]=(ri+1)%waypoints.length;
            continue;
          }
          current.arena.botMotion ||= {};
          const motion = current.arena.botMotion[bot.id] ||= {
            vx: (Math.random() - .5) * 150, vy: (Math.random() - .5) * 150,
            changeAt: 0, jumpAt: Date.now() + 1200 + Math.random() * 1800
          };
          const now = Date.now();
          if (now >= motion.changeAt) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 85 + Math.random() * 85;
            motion.vx = Math.cos(angle) * speed; motion.vy = Math.sin(angle) * speed;
            motion.changeAt = now + 700 + Math.random() * 1200;
          }
          if (pos.x < 70 || pos.x > 650) motion.vx *= -1;
          if (pos.y < 55 || pos.y > 385) motion.vy *= -1;
          gameManager.arenaPosition(current, bot.id, {
            x: pos.x + motion.vx * .1, y: pos.y + motion.vy * .1
          });
          if (now >= motion.jumpAt) {
            gameManager.arenaJump(current, bot.id);
            motion.jumpAt = now + 1800 + Math.random() * 2400;
          }
        }
      } else if (mode === "drawing" && bot.id !== current.drawing?.drawerId &&
                 !current.drawing?.guessed[bot.id]) {
        gameManager.drawingGuess(current, bot.id, current.drawing.word);
      } else if (mode === "pushy" && !current.pushy?.outcomes[bot.id]) {
        gameManager.pushyOutcome(current, bot.id, Math.random() > .35 ? "survived" : "dead",
          9000 + Math.random() * 12000);
      } else if (mode === "redlight" && bot.id !== current.redlight?.controllerId) {
        if (current.redlight?.light === "green") {
          current.redlight.players[bot.id].lastPress = 0;
          gameManager.redLightPress(current, bot.id);
        }
      } else if (mode === "hidebomb") {
        const hb = current.hidebomb;
        if (hb?.stage === "hide" && bot.id !== hb.bomberId && hb.alive[bot.id] &&
            !Number.isInteger(hb.choices[bot.id])) {
          gameManager.hideBombChoose(current, bot.id, Math.floor(Math.random() * 4));
        } else if (hb?.stage === "attack" && bot.id === hb.bomberId) {
          const available = [0,1,2,3].filter((i) => !hb.attacked.includes(i));
          if (available.length) gameManager.hideBombAttack(current, bot.id, available[Math.floor(Math.random()*available.length)]);
        }
      } else if (mode === "platformer") {
        const pf = current.platformer;
        if (pf?.phase === "mapvote" && !pf.mapVotes[bot.id]) {
          gameManager.platformerMapVote(current, bot.id, pf.maps[Math.floor(Math.random()*pf.maps.length)].id);
        } else if (pf?.phase === "build" && !pf.placements[bot.id]?.locked) {
          gameManager.platformerLock(current, bot.id, true);
        } else if (pf?.phase === "race" && !pf.outcomes[bot.id]) {
          gameManager.platformerOutcome(current, bot.id,
            Math.random() > .3 ? "finished" : "dead", 8000 + Math.random() * 10000);
        }
      }
    }
  }, 100);
  testBotLoops.set(room.code, handle);
}

function broadcastRoom(room) {
  io.to(room.code).emit("room:updated", roomView(room));
}

io.on("connection", (socket) => {
  // Track which room this socket belongs to for disconnect handling.
  socket.data.roomCode = null;

  socket.on("room:create", ({ playerName, avatar } = {}) => {
    const result = roomManager.createRoom(socket.id, playerName, avatar);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    const room = result.room;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.emit("room:created", {
      room: roomView(room),
      youAreHost: true,
      selfId: socket.id,
      token: room.players[socket.id].token,
      meta: GAME_META
    });
    broadcastRoom(room);
  });

  socket.on("test:create", ({ playerName, avatar } = {}) => {
    const result = roomManager.createRoom(socket.id, playerName || "Tester", avatar);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    const room = result.room;
    addTestBots(room);
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.emit("room:created", {
      room: roomView(room), youAreHost: true, selfId: socket.id,
      token: room.players[socket.id].token, meta: GAME_META
    });
    broadcastRoom(room);
  });

  socket.on("room:join", ({ roomCode, playerName, avatar } = {}) => {
    const result = roomManager.joinRoom(socket.id, roomCode, playerName, avatar);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    const room = result.room;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.emit("room:joined", {
      room: roomView(room),
      youAreHost: room.hostId === socket.id,
      selfId: socket.id,
      token: room.players[socket.id].token,
      meta: GAME_META
    });
    broadcastRoom(room);
  });

  // Host adjusts game settings in the lobby.
  socket.on("settings:update", (patch) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = roomManager.updateSettings(room, socket.id, patch);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    broadcastRoom(room);
  });

  // Reconnect an existing player after a page refresh, using their token.
  socket.on("room:rejoin", ({ roomCode, token } = {}) => {
    const result = roomManager.rejoinRoom(socket.id, roomCode, token);
    if (!result.ok) {
      socket.emit("room:rejoin:failed", { message: result.error });
      return;
    }
    const room = result.room;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.emit("room:resumed", {
      room: roomView(room),
      youAreHost: room.hostId === socket.id,
      selfId: socket.id,
      token: result.player.token,
      meta: GAME_META,
      resume: gameManager.buildResume(room, socket.id)
    });
    broadcastRoom(room);
  });

  socket.on("room:leave", () => {
    leaveCurrentRoom(socket);
  });

  socket.on("game:start", () => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.startGame(room, socket.id);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    // beginRound already emitted round:question; refresh room view too.
    broadcastRoom(room);
    startTestBots(room);
  });

  socket.on("guess:submit", ({ guess } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.submitGuess(room, socket.id, guess);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    socket.emit("guess:accepted", { guess: room.players[socket.id].guess });
    broadcastRoom(room);
  });

  socket.on("bomb:press", ({ times } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.bombPress(room, socket.id, times);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    broadcastRoom(room);
  });

  socket.on("timeline:place", ({ slot } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.timelinePlace(room, socket.id, slot);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    broadcastRoom(room);
  });

  // Team-voting timeline: cast/change a vote and lock/unlock it.
  socket.on("timeline:vote", ({ slot } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.timelineVote(room, socket.id, slot);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("timeline:lock", ({ locked } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.timelineLock(room, socket.id, locked);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("platformer:place", (placement = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.platformerPlace(room, socket.id, placement);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("platformer:map-vote", ({ mapId } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.platformerMapVote(room, socket.id, mapId);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("platformer:select", ({ type } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.platformerSelect(room, socket.id, type);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("platformer:hover", (cursor = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.platformerHover(room, socket.id,
      cursor.col === null ? null : cursor);
    if (!result.ok && result.error !== "Building is closed.") socket.emit("room:error", { message: result.error });
  });

  socket.on("platformer:lock", ({ locked } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.platformerLock(room, socket.id, locked);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("platformer:outcome", ({ outcome, timeMs } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.platformerOutcome(room, socket.id, outcome, timeMs);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("platformer:position", (position = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.platformerPosition(room, socket.id, position);
    if (!result.ok && result.error !== "Not racing.") socket.emit("room:error", { message: result.error });
  });

  socket.on("drawing:stroke", (stroke = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.drawingStroke(room, socket.id, stroke);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("drawing:clear", () => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.drawingClear(room, socket.id);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("drawing:guess", ({ guess } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.drawingGuess(room, socket.id, guess);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("pushy:outcome", ({ outcome, timeMs } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.pushyOutcome(room, socket.id, outcome, timeMs);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("pushy:position", (position = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.pushyPosition(room, socket.id, position);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("arena:position", (position = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.arenaPosition(room, socket.id, position);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("arena:jump", () => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.arenaAction(room, socket.id);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("arena:crash", () => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.arenaCrash(room, socket.id);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("doors:choose", ({ doorIndex } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.chooseDoor(room, socket.id, doorIndex);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("doors:position", (position = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.doorsPosition(room, socket.id, position);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("redlight:press", () => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.redLightPress(room, socket.id);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("redlight:control", ({ action } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.redLightControl(room, socket.id, action);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("hidebomb:choose", ({ objectIndex } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.hideBombChoose(room, socket.id, objectIndex);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("hidebomb:attack", ({ objectIndex } = {}) => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.hideBombAttack(room, socket.id, objectIndex);
    if (!result.ok) socket.emit("room:error", { message: result.error });
  });

  socket.on("round:next", () => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.nextRound(room, socket.id);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    broadcastRoom(room);
  });

  // Host advances from an arcade intermission to the next mode.
  socket.on("arcade:advance", () => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.startNextLeg(room, socket.id);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    broadcastRoom(room);
  });

  socket.on("game:restart", () => {
    const room = roomManager.getRoom(socket.data.roomCode);
    const result = gameManager.restartGame(room, socket.id);
    if (!result.ok) {
      socket.emit("room:error", { message: result.error });
      return;
    }
    broadcastRoom(room);
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);
  });

  function leaveCurrentRoom(sock) {
    const code = sock.data.roomCode;
    if (!code) return;
    const room = roomManager.getRoom(code);
    const wasInGame = room && room.state !== GAME_STATES.LOBBY;

    const { room: updated, hostChanged, deleted } = roomManager.removePlayer(
      sock.id,
      code
    );
    sock.leave(code);
    sock.data.roomCode = null;

    if (deleted || !updated) {
      // Room gone; if it was mid-game, stop its timer.
      if (room) gameManager.disarmTimer(room);
      const botLoop = testBotLoops.get(code);
      if (botLoop) { clearInterval(botLoop); testBotLoops.delete(code); }
      return;
    }

    if (hostChanged) {
      io.to(updated.code).emit("host:changed", { hostId: updated.hostId });
    }
    if (wasInGame) {
      gameManager.handleDisconnectDuringGame(updated);
    }
    broadcastRoom(updated);
  }
});

// Periodically clean up inactive rooms (~1 hour TTL).
setInterval(() => {
  const removed = roomManager.cleanupInactiveRooms();
  if (removed > 0) {
    console.log(`Cleaned up ${removed} inactive room(s).`);
  }
}, 5 * 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`Closest Wins running at http://localhost:${PORT}`);
  console.log(`Minimum players to start: ${MIN_PLAYERS} · Round length: ${ROUND_SECONDS}s`);
});

module.exports = { app, server, io, roomManager, gameManager };
