"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { RoomManager, GAME_STATES } = require("../src/roomManager");
const { GameManager } = require("../src/gameManager");

/** Build a manager that captures emitted events and uses no-op timers. */
function harness(minPlayers = 2) {
  const events = [];
  const rm = new RoomManager();
  const gm = new GameManager(rm, {
    emitRoom: (code, event, payload) => events.push({ event, payload }),
    minPlayersToStart: minPlayers,
    roundCountdownMs: 0,
    setTimer: () => 0,
    clearTimer: () => {}
  });
  const last = (ev) => [...events].reverse().find((e) => e.event === ev);
  return { events, rm, gm, last };
}

function enterPlatformerBuild(gm, room) {
  assert.equal(gm.startGame(room, "s1").ok, true);
  assert.equal(room.platformer.phase, "mapvote");
  gm.platformerMapVote(room, "s1", "skybridge");
  gm.platformerMapVote(room, "s2", "skybridge");
  assert.equal(room.platformer.phase, "maproulette");
  gm.beginPlatformerBuild(room);
  for (const type of gm.platformerHand()) room.platformer.pool[type] = 3;
}

test("no-repeat: a replay in the same room avoids used questions", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.rounds = 5;

  gm.startGame(room, "s1");
  const firstIds = room.questions.map((q) => q.id);
  gm.restartGame(room, "s1");
  gm.startGame(room, "s1");
  const secondIds = room.questions.map((q) => q.id);

  const overlap = secondIds.filter((id) => firstIds.includes(id));
  assert.equal(overlap.length, 0, "replay repeated a question");
});

test("curling: turn order puts the current leader first", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.joinRoom("s3", room.code, "Erik");
  // Anna leads, Erik second, Runar last.
  room.players["s1"].score = 10;
  room.players["s2"].score = 300;
  room.players["s3"].score = 120;
  assert.deepEqual(gm.buildTurnOrder(room), ["s2", "s3", "s1"]);
});

test("curling: only the active player may shoot; results rank by closeness", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.joinRoom("s3", room.code, "Erik");
  room.settings.mode = "curling";
  room.settings.rounds = 1;

  gm.startGame(room, "s1");
  assert.equal(room.state, GAME_STATES.QUESTION);
  const firstShooter = room.turnOrder[0];
  const other = room.turnOrder[1];
  // A non-active player cannot shoot.
  assert.equal(gm.submitGuess(room, other, {direction:0,power:.5}).ok, false);
  // The active player shoots, then the turn advances.
  assert.equal(gm.submitGuess(room, firstShooter, {direction:0,power:1}).ok, true);
  assert.equal(room.turnOrder[room.turnIndex], other);

  // Everyone gets three stones. Tests skip the real-time viewing delay.
  while(room.state===GAME_STATES.QUESTION){
    room.curlingPlaybackUntil=0;
    gm.submitGuess(room,room.turnOrder[room.turnIndex],{direction:0,power:.58});
  }

  assert.equal(room.state, GAME_STATES.RESULTS);
  const res = last("round:results").payload;
  assert.equal(res.ranking[0].pointsAwarded, 100);
  assert.ok(res.ranking[0].score >= res.ranking[1].score);
});

test("curling: standalone games use two sets while retaining three stones", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode="curling";room.settings.rounds=5;
  gm.startGame(room,"s1");
  assert.equal(room.totalRounds,2);
  assert.equal(room.turnOrder.length,6);
  assert.ok(gm.curlingOrderView(room).every((player)=>player.stonesTotal===3));
});

test("curling: stones collide on ice and can slide off an open edge", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.joinRoom("s3", room.code, "Erik");
  room.settings.mode="curling";room.settings.rounds=1;
  gm.startGame(room,"s1");
  const first=room.turnOrder[0],second=room.turnOrder[1],third=room.turnOrder[2];
  gm.submitGuess(room,first,{direction:0,power:.55});
  const before={...room.curlingStones.find((s)=>s.stoneId===`${first}:1`)};
  room.curlingPlaybackUntil=0;
  gm.submitGuess(room,second,{direction:0,power:.55});
  const after=room.curlingStones.find((s)=>s.stoneId===`${first}:1`);
  assert.ok(Math.hypot(after.x-before.x,after.y-before.y)>1,"the second stone should transfer momentum to the first");
  const settled=room.curlingStones.filter((s)=>!s.off);
  for(let i=0;i<settled.length;i++)for(let j=i+1;j<settled.length;j++){
    assert.ok(Math.hypot(settled[i].x-settled[j].x,settled[i].y-settled[j].y)>=49.9,"settled stones must not overlap");
  }
  while(room.state===GAME_STATES.QUESTION){
    room.curlingPlaybackUntil=0;
    const id=room.turnOrder[room.turnIndex];gm.submitGuess(room,id,{direction:id===third?1:0,power:id===third?1:.5});
  }
  assert.equal(room.lastResults.ranking.find((p)=>p.playerId===third).stones.length,3);
});

test("bomb: whoever crosses the hidden threshold pops and scores zero", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "bomb";
  room.settings.rounds = 1;

  gm.startGame(room, "s1");
  assert.equal(room.state, GAME_STATES.QUESTION);
  const threshold = room.bomb.threshold;
  assert.ok(threshold >= 1);

  // Press until it pops. Each press is by whoever is active.
  let guard = 0;
  while (room.state === GAME_STATES.QUESTION && guard++ < 100) {
    const activeId = room.turnOrder[room.turnIndex % room.turnOrder.length];
    gm.bombPress(room, activeId, 1);
  }
  assert.equal(room.state, GAME_STATES.RESULTS);
  const res = last("round:results").payload;
  assert.equal(res.mode, "bomb");
  const popper = res.ranking.find((r) => r.playerId === res.popperId);
  assert.equal(popper.pointsAwarded, 0);
  assert.ok(res.ranking.some((r) => r.survived && r.pointsAwarded > 0));
});

test("platformer: players build one tile, race, and score finishers", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "platformer";
  room.settings.rounds = 1;

  enterPlatformerBuild(gm, room);
  assert.equal(room.platformer.phase, "build");
  assert.equal(gm.platformerPlace(room, "s1", { col: 6, row: 8, type: "solid" }).ok, true);
  assert.equal(gm.platformerPlace(room, "s2", { col: 7, row: 8, type: "bouncy" }).ok, true);
  gm.platformerLock(room, "s1", true);
  gm.platformerLock(room, "s2", true);

  assert.equal(room.platformer.phase, "race");
  assert.ok(Number.isFinite(room.platformer.positions.s1.x));
  assert.ok(Number.isFinite(room.platformer.positions.s2.x));
  assert.notEqual(room.platformer.positions.s1.x, room.platformer.positions.s2.x);
  assert.equal(room.platformer.level.tiles["6,8"], "solid");
  assert.equal(room.platformer.level.tiles["7,8"], "bouncy");
  gm.platformerOutcome(room, "s1", "goal", 4200);
  gm.platformerOutcome(room, "s2", "dead", 5000);

  assert.equal(room.state, GAME_STATES.RESULTS);
  const result = last("round:results").payload;
  assert.equal(result.mode, "platformer");
  assert.equal(result.soloBonus, true);
  assert.equal(result.ranking[0].playerId, "s1");
  assert.equal(result.ranking[0].pointsAwarded, 3);
});

test("platformer: a rejected move preserves the player's previous placement", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "platformer";
  enterPlatformerBuild(gm, room);

  gm.platformerPlace(room, "s1", { col: 6, row: 8, type: "spike" });
  const rejected = gm.platformerPlace(room, "s1", { col: 0, row: 10, type: "solid" });
  assert.equal(rejected.ok, false);
  assert.deepEqual(room.platformer.placements.s1, { col: 6, row: 8, type: "spike", locked: false });
});

test("platformer: live racer positions are shared and bounded", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "platformer";
  enterPlatformerBuild(gm, room);
  gm.platformerLock(room, "s1", true);
  gm.platformerLock(room, "s2", true);

  assert.equal(gm.platformerPosition(room, "s1", { x: 120, y: 286, vx: 80, vy: 0 }).ok, true);
  const update = last("platformer:positions").payload.players.find((p) => p.playerId === "s1");
  assert.deepEqual({ x: update.x, y: update.y, vx: update.vx, vy: update.vy },
    { x: 120, y: 286, vx: 80, vy: 0 });
  assert.equal(gm.platformerPosition(room, "s1", { x: Infinity, y: 0, vx: 0, vy: 0 }).ok, false);
});

test("platformer: shared pool reserves picks and broadcasts live builder cursors", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "platformer";
  enterPlatformerBuild(gm, room);
  room.platformer.pool.saw = 1;

  assert.equal(room.platformer.level.cols, 30);
  assert.equal(room.platformer.level.rows, 14);
  assert.equal(gm.platformerSelect(room, "s1", "saw").ok, true);
  assert.equal(gm.platformerSelect(room, "s2", "saw").ok, false);
  assert.equal(gm.platformerSelect(room, "s1", "solid").ok, true);
  assert.equal(gm.platformerSelect(room, "s2", "saw").ok, true);
  assert.equal(gm.platformerHover(room, "s2", { col: 12, row: 7 }).ok, true);

  const builders = last("platformer:builders").payload;
  assert.equal(builders.pool.saw, 0);
  assert.deepEqual(builders.builders.find((p) => p.playerId === "s2").cursor, { col: 12, row: 7 });
});

test("platformer: each round gets a scarce randomized pool including new block types", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  const pool = gm.platformerPool(room);
  assert.equal(Object.values(pool).reduce((sum, n) => sum + n, 0), 5);
  assert.ok(pool.solid >= 1);
  assert.ok("conveyor" in pool);
  assert.ok("bombtrap" in pool);
});

test("platformer: demolition bombs remove player tiles but not protected map terrain", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "platformer";
  enterPlatformerBuild(gm, room);
  gm.platformerPlace(room, "s1", { col: 6, row: 8, type: "solid" });
  gm.platformerPlace(room, "s2", { col: 7, row: 8, type: "spike" });
  gm.platformerLock(room, "s1", true);
  gm.platformerLock(room, "s2", true);
  gm.platformerOutcome(room, "s1", "dead", 1000);
  gm.platformerOutcome(room, "s2", "dead", 1100);
  gm.nextRound(room, "s1");

  for (const type of gm.platformerHand()) room.platformer.pool[type] = 0;
  room.platformer.pool.bombtrap = 2;
  assert.equal(gm.platformerSelect(room, "s1", "bombtrap").ok, true);
  assert.equal(gm.platformerPlace(room, "s1", { col: 6, row: 8, type: "bombtrap" }).ok, true);
  assert.equal(room.platformer.level.tiles["6,8"], undefined);
  assert.equal(room.platformer.placements.s1.type, "demolition");

  assert.equal(gm.platformerSelect(room, "s2", "bombtrap").ok, true);
  const protectedResult = gm.platformerPlace(room, "s2", { col: 0, row: 11, type: "bombtrap" });
  assert.equal(protectedResult.ok, false);
  assert.match(protectedResult.error, /protected/);
});

test("platformer: map templates have distinct routes, terrain, and themes", () => {
  const { gm } = harness();
  const maps = gm.platformerMaps();
  assert.equal(maps.length, 3);
  assert.equal(new Set(maps.map((m) => m.level.theme.id)).size, 3);
  assert.equal(new Set(maps.map((m) => JSON.stringify(m.level.tiles))).size, 3);
  assert.ok(Object.values(maps.find((m) => m.id === "canyon").level.tiles).includes("crumble"));
  assert.ok(Object.values(maps.find((m) => m.id === "zigzag").level.tiles).includes("ice"));
});

test("platformer: the complete spawn zone is protected from player objects", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");room.settings.mode="platformer";enterPlatformerBuild(gm,room);
  const result=gm.platformerPlace(room,"s1",{col:4,row:8,type:"spike"});
  assert.equal(result.ok,false);assert.match(result.error,/spawn zone|guardrail/i);
  assert.equal(gm.platformerPlace(room,"s1",{col:5,row:8,type:"spike"}).ok,true);
});

test("platformer: a crumble tile breaks once for every racer",()=>{
  const {rm,gm,last}=harness();const {room}=rm.createRoom("s1","Runar");rm.joinRoom("s2",room.code,"Anna");
  room.settings.mode="platformer";enterPlatformerBuild(gm,room);room.platformer.level.tiles["7,8"]="crumble";
  room.platformer.phase="race";room.platformer.crumbledTiles={};
  assert.equal(gm.platformerCrumble(room,"s1","7,8").ok,true);
  assert.equal(room.platformer.crumbledTiles["7,8"],true);assert.equal(last("platformer:crumbled").payload.key,"7,8");
  assert.equal(gm.platformerCrumble(room,"s2","7,8").ok,true);
});

test("pocket racers randomly selects its circuits without immediate repeats", () => {
  const { rm, gm }=harness();const { room }=rm.createRoom("s1","Runar");rm.joinRoom("s2",room.code,"Anna");
  room.settings.mode="racing";const ids=[];
  for(let round=0;round<12;round++){room.roundIndex=round;gm.beginArenaRound(room,"racing");ids.push(room.arena.trackId);gm.disarmTimer(room);}
  assert.ok(ids.every((id)=>["square","swing","harbor","oval"].includes(id)));
  assert.ok(ids.every((id,index)=>index===0||id!==ids[index-1]));
});

test("ricochet golf starts with a random closest-positioned opener and simulates bankable shots",()=>{
  const {rm,gm,last}=harness();const {room}=rm.createRoom("s1","Runar");rm.joinRoom("s2",room.code,"Anna");
  room.settings.mode="golf";gm.startGame(room,"s1");gm.disarmTimer(room);
  assert.equal(room.state,GAME_STATES.QUESTION);assert.equal(last("turn:started").payload.mode,"golf");
  assert.equal(room.turnOrder[0],room.golf.openingPlayerId,"a random opening player takes the first shot");
  assert.equal(gm.golfDistance(room,room.golf.openingPlayerId),Math.min(...Object.keys(room.golf.balls).map((id)=>gm.golfDistance(room,id))),"the opening ball is placed closest to the hole");
  assert.equal(gm.golfInside(100,500),true);assert.equal(gm.golfInside(320,420),false);
  const active=room.turnOrder[0],before={...room.golf.balls[active]};
  assert.equal(gm.submitGuess(room,active,{direction:.2,power:.55}).ok,true);gm.disarmTimer(room);
  assert.ok(room.golf.trajectory.length>2);assert.notDeepEqual(room.golf.balls[active],before);
  for(const ball of Object.values(room.golf.balls)){
    assert.ok(ball.holed||gm.golfInside(ball.x,ball.y,15,room.golf.courseId),"ball collision resolution must keep every ball on the fairway");
  }
  assert.notEqual(room.turnOrder[0],active,"every other player gets an opening shot before furthest-first begins");
});

test("ricochet golf gives everyone one opening shot before selecting the furthest ball",()=>{
  const {rm,gm}=harness();const {room}=rm.createRoom("s1","Runar");rm.joinRoom("s2",room.code,"Anna");rm.joinRoom("s3",room.code,"Bo");
  room.settings.mode="golf";gm.startGame(room,"s1");gm.disarmTimer(room);const opening=[...room.golf.openingOrder];
  for(let i=0;i<opening.length;i++){
    assert.equal(room.turnOrder[0],opening[i]);room.golf.playbackUntil=0;
    assert.equal(gm.submitGuess(room,opening[i],{direction:0,power:0}).ok,true);gm.disarmTimer(room);
  }
  assert.ok(Object.values(room.golf.shots).every((shots)=>shots===1));
  const furthest=Object.keys(room.golf.balls).sort((a,b)=>gm.golfDistance(room,b)-gm.golfDistance(room,a))[0];
  assert.equal(room.turnOrder[0],furthest);
});

test("ricochet golf records only the first player to hole out for the celebration",()=>{
  const {rm,gm}=harness();const {room}=rm.createRoom("s1","Runar");rm.joinRoom("s2",room.code,"Anna");room.settings.mode="golf";gm.startGame(room,"s1");gm.disarmTimer(room);
  const hole=room.golf.hole;Object.assign(room.golf.balls.s1,{x:hole.x-18,y:hole.y});
  gm.simulateGolfShot(room,"s1",{direction:0,power:0});assert.equal(room.golf.firstHoledPlayerId,"s1");
  Object.assign(room.golf.balls.s2,{x:hole.x-18,y:hole.y});gm.simulateGolfShot(room,"s2",{direction:0,power:0});
  assert.equal(room.golf.firstHoledPlayerId,"s1");
});

test("ricochet golf randomizes courses without repeats and supports gentle full-circle shots",()=>{
  const {rm,gm}=harness();const {room}=rm.createRoom("s1","Runar");rm.joinRoom("s2",room.code,"Anna");room.settings.mode="golf";
  gm.beginGolfRound(room);gm.disarmTimer(room);const first=room.golf.courseId;
  gm.beginGolfRound(room);gm.disarmTimer(room);assert.notEqual(room.golf.courseId,first);
  assert.ok(["corner","switchback","serpent","bumpers"].includes(room.golf.courseId));
  assert.equal(gm.golfInside(200,250,12,"bumpers"),false,"bumper obstacles are solid");
  assert.equal(gm.golfInside(100,250,12,"bumpers"),true);
  const active=room.turnOrder[0],start={...room.golf.balls[active]};
  const frames=gm.simulateGolfShot(room,active,{direction:1,power:0});
  assert.ok(frames.length>1);assert.ok(Math.hypot(room.golf.balls[active].x-start.x,room.golf.balls[active].y-start.y)<35,"minimum power should only nudge the ball");
});

test("drawing: only the artist draws and correct guesses score both players", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "drawing";
  room.settings.rounds = 1;
  gm.startGame(room, "s1");

  const drawer = room.drawing.drawerId;
  const guesser = drawer === "s1" ? "s2" : "s1";
  assert.equal(gm.drawingStroke(room, guesser, { x0: 0, y0: 0, x1: 1, y1: 1 }).ok, false);
  assert.equal(gm.drawingStroke(room, drawer, {
    x0: .1, y0: .1, x1: .2, y1: .2, color: "#123456", width: 5
  }).ok, true);
  assert.equal(gm.drawingGuess(room, guesser, room.drawing.word.toUpperCase()).correct, true);

  assert.equal(room.state, GAME_STATES.RESULTS);
  assert.equal(room.players[guesser].score, 100);
  assert.equal(room.players[drawer].score, 50);
  assert.equal(last("round:results").payload.word.length > 0, true);
});

test("pushy: survivors score highest and eliminated players earn survival points", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "pushy";
  room.settings.rounds = 1;
  gm.startGame(room, "s1");

  const move = gm.pushyPosition(room, "s1", { x: 400, y: 210, vx: 80, vy: -15 });
  assert.equal(move.ok, true);
  assert.equal(room.pushy.positions.s1.x, 400);
  assert.equal(last("pushy:positions").payload.players.length, 2);

  gm.pushyOutcome(room, "s1", "dead", 11000);
  gm.pushyOutcome(room, "s2", "survived", 22000);
  assert.equal(room.state, GAME_STATES.RESULTS);
  const result = last("round:results").payload;
  assert.equal(result.mode, "pushy");
  assert.equal(result.ranking[0].playerId, "s2");
  assert.equal(result.ranking[0].pointsAwarded, 100);
  assert.equal(result.ranking[1].pointsAwarded, 25);
});

test("color twister: server validates positions and scores the last survivor", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "colorfloor";
  room.settings.rounds = 1;
  assert.equal(gm.startGame(room, "s1").ok, true);
  assert.equal(last("arena:start").payload.mode, "colorfloor");
  assert.ok(room.arena.deadline-room.arena.startedAt>=70000,"Color Twister should last about 70 seconds");
  assert.equal(gm.arenaPosition(room, "s1", { x: 125, y: 125 }).ok, true);
  assert.equal(gm.arenaJump(room, "s1").ok, true);
  assert.ok(room.arena.positions.s1.jumpUntil > Date.now());
  assert.ok(gm.colorFloorTiming(0).duration > gm.colorFloorTiming(18000).duration);
  assert.equal(gm.colorFloorTiming(0).duration, 6800, "the opening call should be generous");
  assert.ok(gm.colorFloorTiming(30000).duration <= 3550, "late calls should become frantic");
  const shuffled = gm.colorFloorLayout();
  assert.deepEqual([0,1,2,3].map((color) => shuffled.filter((v) => v === color).length), [6,6,6,6]);
  Object.assign(room.arena.positions.s1, { x: 200, y: 200, vx: 180, vy: 0, jumpUntil: 0, updatedAt: Date.now()-100 });
  Object.assign(room.arena.positions.s2, { x: 230, y: 200, vx: 10, vy: 0, updatedAt: Date.now()-100 });
  gm.arenaPosition(room, "s1", { x: 208, y: 200 });
  assert.ok(last("arena:bump"), "touching players should emit a bump reaction");
  assert.ok(room.arena.positions.s2.x > 230, "the contacted player should be pushed away");
  room.arena.tileLayout = Array(24).fill(1);
  room.arena.safeColor = 0;
  room.arena.colorDangerAt = Date.now() - 1000;
  room.arena.positions.s2.updatedAt = 0;
  gm.arenaPosition(room, "s2", { x: 240, y: 220 });
  assert.equal(room.arena.eliminated.s2.reason, "lava", "crossing an unsafe tile stays continuously lethal");
  gm.finishArenaRound(room);
  assert.equal(last("round:results").payload.ranking[0].playerId, "s1");
  assert.equal(room.players.s1.score, 100);
});

test("vanishing grid: stepped tiles crack and expired tiles eliminate", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "vanish";
  gm.startGame(room, "s1");
  // Force a full-grid map + spawns on exact tile centres so each player's
  // footprint sits on a single tile (footprint straddling activates several).
  room.arena.vmask = "full";
  room.arena.positions.s1 = { x: 240, y: 201.33, vx: 0, vy: 0, updatedAt: 0, jumpUntil: 0, layer: 0 };
  room.arena.positions.s2 = { x: 480, y: 238.67, vx: 0, vy: 0, updatedAt: 0, jumpUntil: 0, layer: 0 };
  gm.tickArena(room);
  assert.equal(Object.keys(room.arena.tiles).length, 2);
  assert.ok(last("vanish:tile"));
  const own = room.arena.positions.s1;
  const { tileCellAt } = require("../src/gameManager");
  const cell = tileCellAt(own.x, own.y);
  const key = `0:${cell.col}:${cell.row}`;
  room.arena.tiles[key].disappearsAt = Date.now() - 1;
  gm.tickArena(room);
  assert.equal(room.arena.positions.s1.layer, 1, "the first fall should land on a lower floor");
  room.arena.positions.s1.jumpUntil = 0;
  const lowerKey = `1:${cell.col}:${cell.row}`;
  room.arena.tiles[lowerKey] = { disappearsAt: Date.now() - 1 };
  gm.tickArena(room);
  assert.equal(room.arena.positions.s1.layer, 2);
});

test("vanishing grid: a genuine step across a seam activates both touched tiles", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "vanish";
  gm.startGame(room, "s1");
  room.arena.vmask = "full";
  // On the vertical seam between cols 5 and 6 (x=72+6*48=360), row 3 centre.
  room.arena.positions.s1 = { x: 360, y: 201, vx: 0, vy: 0, updatedAt: 0, jumpUntil: 0, layer: 0 };
  room.arena.positions.s2 = { x: 480, y: 238.67, vx: 0, vy: 0, updatedAt: 0, jumpUntil: 0, layer: 0 };
  gm.tickArena(room);
  assert.ok(room.arena.tiles["0:5:3"], "left tile under the seam cracks");
  assert.ok(room.arena.tiles["0:6:3"], "right tile under the seam cracks");
});

test("vanishing grid: movement never resets decay and the circular footprint skips diagonal tiles", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "vanish";
  gm.startGame(room, "s1");
  room.arena.vmask = "full";
  room.arena.positions.s1 = { x: 362, y: 222, vx: 0, vy: 0, updatedAt: 0, jumpUntil: 0, layer: 0 };
  room.arena.positions.s2.jumpUntil = Date.now() + 10000;
  gm.tickArena(room);
  const first = room.arena.tiles["0:6:4"];
  assert.ok(first);
  const originalExpiry = first.disappearsAt;
  gm.tickArena(room);
  assert.equal(first.disappearsAt, originalExpiry, "revisiting a tile must not restart its countdown");
  assert.equal(room.arena.tiles["0:5:3"], undefined, "a diagonally adjacent tile is not under the circular foot contact");
});

test("bomb pass: touching passes the hidden-fuse bomb without exposing its deadline", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "bombpass";
  gm.startGame(room, "s1");
  room.arena.holderId = "s1";
  room.arena.passLockedUntil = 0;
  room.arena.positions.s2 = { x: 220, y: 220, updatedAt: 0 };
  gm.arenaPosition(room, "s1", { x: 220, y: 220 });
  assert.equal(room.arena.holderId, "s2");
  assert.equal("explodeAt" in last("arena:start").payload, false);
  assert.equal(last("bombpass:holder").payload.holderId, "s2");
});

test("playing with fire: bombs destroy crates and eliminate players in the blast", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "fire";
  gm.startGame(room, "s1");
  assert.equal(last("arena:start").payload.mode, "fire");
  const owner = room.arena.positions.s1;
  const cell = gm.fireCell(owner.x, owner.y);
  room.arena.crates = [`${cell.col + 1}:${cell.row}`];
  assert.equal(gm.arenaAction(room, "s1").ok, true);
  const bomb = room.arena.bombs[0];
  room.arena.positions.s1.x += 120;
  room.arena.positions.s2 = { x: 35 + cell.col*50 + 25, y: 20 + cell.row*45 + 22, updatedAt: 0 };
  gm.explodeFireBomb(room, bomb, Date.now());
  assert.equal(room.arena.eliminated.s2.reason, "blast");
  assert.equal(room.arena.crates.length, 0);
  assert.ok(last("arena:fire"));
});

test("playing with fire: body collision prevents diagonal clipping and powerups upgrade bombs", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "fire";
  gm.startGame(room, "s1");
  room.arena.crates=[];
  const pos=room.arena.positions.s1;
  Object.assign(pos,{x:120,y:125,updatedAt:0});
  gm.arenaPosition(room,"s1",{x:148,y:145});
  assert.equal(pos.x,120,"the full character body must not enter the solid block at cell 2:2");
  assert.ok(pos.y>125,"axis resolution should still allow sliding alongside the block");

  const cell=gm.fireCell(pos.x,pos.y),key=`${cell.col}:${cell.row}`;
  room.arena.powerups=[{key,type:"range"}];pos.updatedAt=0;
  gm.arenaPosition(room,"s1",{x:pos.x,y:pos.y});
  assert.equal(room.arena.upgrades.s1.range,3);
  assert.equal(last("arena:powerup").payload.type,"range");
  gm.arenaAction(room,"s1");
  assert.equal(room.arena.bombs[0].range,3);
});

test("playing with fire: borders stay sealed, bombs block, and active flame remains lethal", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "fire"; gm.startGame(room, "s1");
  for(const mapId of ["classic","fortress","switchback"]){
    for(let col=0;col<13;col++){assert.equal(gm.fireSolid(col,0,mapId),true);assert.equal(gm.fireSolid(col,8,mapId),true);}
    for(let row=0;row<9;row++){assert.equal(gm.fireSolid(0,row,mapId),true);assert.equal(gm.fireSolid(12,row,mapId),true);}
  }
  room.arena.crates=[];room.arena.bombs=[{ownerId:"s1",col:3,row:3,ownerExited:true,explodeAt:Date.now()+5000}];
  assert.equal(gm.fireBlocked(room.arena,35+3*50+24,20+3*45+22,14,"s2"),true);
  room.arena.bombs[0].ownerExited=false;
  assert.equal(gm.fireBlocked(room.arena,35+3*50+24,20+3*45+22,14,"s1"),false,"owner can clear a newly placed bomb");
  room.arena.bombs[0].ownerExited=true;
  const victim=room.arena.positions.s2;Object.assign(victim,{x:35+4*50+24,y:20+3*45+22});
  room.arena.blasts=[{cells:["4:3"],until:Date.now()+500}];
  gm.tickArena(room);
  assert.equal(room.arena.eliminated.s2.reason,"blast");
  room.arena.blasts=[{cells:["5:3"],until:Date.now()-1}];gm.tickArena(room);
  assert.deepEqual(last("arena:fire").payload.blasts,[],"expired blast visuals are explicitly cleared for every client");
  room.arena.fireNextShrinkAt=Date.now()+3000;room.arena.fireWarnedLevel=0;gm.tickArena(room);
  assert.equal(last("arena:fire-warning").payload.level,1,"players receive advance notice before the arena shrinks");
});

test("pocket racers: sequential checkpoints complete three laps", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "racing";
  gm.random=()=>0; // keep this physics test on its explicit square-track coordinates
  gm.startGame(room, "s1");
  assert.equal(last("arena:start").payload.mode, "racing");
  assert.equal(last("arena:start").payload.raceMaxSpeed,255,"every racer receives the same base maximum speed");
  assert.ok(Math.hypot(
    room.arena.positions.s1.x-room.arena.positions.s2.x,
    room.arena.positions.s1.y-room.arena.positions.s2.y
  )>=50,"front-row cars should spawn side-by-side with generous separation");
  assert.ok(Math.abs(room.arena.positions.s1.x-room.arena.positions.s2.x)<2,
    "the first pair should receive an equal starting distance");
  const pos = room.arena.positions.s1;
  assert.equal(room.arena.trackId,"square");
  const fast = room.arena.positions.s2;
  Object.assign(fast,{x:640,y:200,updatedAt:Date.now()-100,checkpoint:0});
  gm.arenaPosition(room,"s2",{x:640,y:260,angle:Math.PI/2});
  assert.equal(fast.checkpoint,1,"crossing a checkpoint between packets must still register");
  const crossings=[[[640,200],[640,260]],[[390,370],[330,370]],[[80,260],[80,200]],[[330,90],[390,90]]];
  for (let lap=0;lap<3;lap++) for (const [[oldX,oldY],[x,y]] of crossings) {
    Object.assign(pos,{x:oldX,y:oldY,updatedAt:Date.now()-100});
    gm.arenaPosition(room,"s1",{x,y,angle:0});
  }
  assert.equal(pos.lap,3);
  assert.equal(room.arena.finished.s1.place,1);
  assert.ok(last("arena:racer-finished"));
  Object.assign(room.arena.positions.s1,{x:300,y:90,vx:220,vy:0,updatedAt:Date.now()-100});
  Object.assign(room.arena.positions.s2,{x:328,y:90,vx:20,vy:0,updatedAt:Date.now()-100});
  room.arena.finished={};room.arena.bumpCooldowns={};
  gm.arenaPosition(room,"s1",{x:306,y:90,angle:0});
  const impact=last("arena:bump").payload;
  assert.equal(impact.racing,true,"car contact should broadcast a competitive impact");
  assert.ok(impact.impulses.s1&&impact.impulses.s2,"both cars receive a directional bounce impulse");
  assert.ok(impact.impulses.s1.x*impact.impulses.s2.x<=0,"collision impulses push the cars apart");
  assert.ok(Math.hypot(impact.impulses.s1.x,impact.impulses.s1.y)>=55,"race collisions have a noticeable minimum bounce");
  Object.assign(room.arena.positions.s1,{x:700,y:220,crashCooldownUntil:0});
  assert.equal(gm.arenaCrash(room,"s1").ok,true);
  assert.equal(room.arena.positions.s1.x,640,"a fallen car should return to the nearest centerline");
  assert.equal(room.arena.positions.s1.y,220);
  assert.ok(last("arena:racer-crashed"));
});

test("arena positions reject null coordinates instead of teleporting to a corner", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode="racing";room.settings.rounds=1;
  gm.startGame(room,"s1");
  const before={...room.arena.positions.s1};
  const result=gm.arenaPosition(room,"s1",{x:null,y:null,angle:0});
  assert.equal(result.ok,false);
  assert.equal(room.arena.positions.s1.x,before.x);
  assert.equal(room.arena.positions.s1.y,before.y);
});

test("tab hopper: flaps are authoritative and pop-up collisions record distance", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "flappy";
  gm.startGame(room, "s1");
  assert.equal(last("arena:start").payload.mode, "flappy");
  assert.equal(last("arena:start").payload.obstacles.length, 40);
  gm.arenaJump(room, "s1");
  assert.equal(room.arena.positions.s1.vy, -285);
  const progress=(Date.now()-room.arena.startedAt)*.12;
  room.arena.obstacles=[{x:150+progress,gapY:250,gap:90}];
  Object.assign(room.arena.positions.s1,{y:100,vy:0});
  Object.assign(room.arena.positions.s2,{y:250,vy:0});
  room.players.s2.connected=false; // a sleeping phone still owns its run
  room.arena.physicsAt=Date.now()-55;
  gm.tickArena(room);
  assert.ok(room.arena.eliminated.s1,"hitting a pop-up should eliminate the tab");
  assert.equal(room.state,"question","the final surviving tab keeps flying");
  room.players.s2.connected=true;
  room.arena.positions.s1.distance=900;
  room.arena.positions.s2.distance=650;
  Object.assign(room.arena.positions.s2,{y:100,vy:0});
  room.arena.physicsAt=Date.now()-55;
  gm.tickArena(room);
  assert.equal(last("round:results").payload.mode,"flappy");
  assert.equal(last("round:results").payload.ranking[0].playerId,"s1","furthest distance wins even if everybody crashes");
  assert.equal(last("round:results").payload.ranking[0].pointsAwarded,100);
  assert.ok(Number.isFinite(last("round:results").payload.ranking.find((p)=>p.playerId==="s1").distance));
});

test("wild run: players get identical private lanes, jump hazards, and rank by distance", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "runner";
  gm.startGame(room, "s1");
  const start=last("arena:start").payload;
  assert.equal(start.mode,"runner");
  assert.equal(start.obstacles.length,48);
  assert.ok(start.runnerCoins.length>50);
  assert.ok(["moonwood","sunset","crystal","storm"].includes(start.runnerTheme));
  assert.equal(room.arena.positions.s1.y,326);
  assert.equal(room.arena.positions.s2.y,326);
  gm.arenaJump(room,"s1");
  assert.equal(room.arena.positions.s1.vy,-420);
  // A floating platform is real ground: it must support the runner and allow
  // the next jump instead of treating the landing as an airborne tick.
  const platform={x:135+room.arena.positions.s1.distance,y:205,w:160};
  room.arena.runnerPlatforms=[platform];
  Object.assign(room.arena.positions.s1,{y:200,vy:120,grounded:false});
  room.arena.physicsAt=Date.now()-55;
  gm.tickArena(room);
  assert.equal(room.arena.positions.s1.y,205,"runner lands on the platform top");
  assert.equal(room.arena.positions.s1.grounded,true,"platform landing is grounded");
  room.arena.positions.s1.jumpCooldownUntil=0;
  gm.arenaJump(room,"s1");
  assert.equal(room.arena.positions.s1.vy,-420,"runner can jump again from a platform");
  const elapsed=Date.now()-room.arena.startedAt;
  const speed=Math.min(.24,.105+elapsed/360000),progress=elapsed*speed;
  room.arena.obstacles=[{x:135+progress,w:30,h:55,type:"stump"}];
  Object.assign(room.arena.positions.s1,{y:240,vy:-100});
  Object.assign(room.arena.positions.s2,{y:326,vy:0});
  room.arena.physicsAt=Date.now()-55;
  gm.tickArena(room);
  assert.equal(room.arena.eliminated.s1,undefined,"an airborne runner clears the same hazard");
  assert.ok(room.arena.eliminated.s2,"a grounded runner hits it");
  assert.equal(room.state,"question","the best runner continues until they crash");
});

test("territory painter: every stepped tile changes to the latest player's color", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode="painter";gm.startGame(room,"s1");
  assert.equal(last("arena:start").payload.mode,"painter");
  room.arena.positions.s1.updatedAt=0;gm.arenaPosition(room,"s1",{x:180,y:100});
  assert.equal(room.arena.painterTerritory["4:2"],"s1");
  room.arena.positions.s2.updatedAt=0;gm.arenaPosition(room,"s2",{x:180,y:100});
  assert.equal(room.arena.painterTerritory["4:2"],"s2","rivals can repaint an occupied tile");
  assert.ok(last("arena:painter"));
  assert.equal(room.arena.deadline-room.arena.startedAt,42000);
  room.arena.painterBuckets=[{id:1,col:5,row:2,type:"cross",expiresAt:Date.now()+5000}];
  room.arena.positions.s1.updatedAt=0;gm.arenaPosition(room,"s1",{x:220,y:100});
  assert.equal(room.arena.painterTerritory["5:0"],"s1","cross buckets splash beyond the stepped tile");
  room.arena.painterBuckets=[{id:2,col:6,row:2,type:"speed",expiresAt:Date.now()+5000}];
  room.arena.positions.s1.updatedAt=0;gm.arenaPosition(room,"s1",{x:260,y:100});
  assert.ok(room.arena.positions.s1.painterSpeedUntil>Date.now()+3000,"speed buckets grant a short boost");
  room.arena.painterBuckets=[{id:3,col:7,row:3,type:"roller",expiresAt:Date.now()+5000}];
  room.arena.positions.s1.updatedAt=0;gm.arenaPosition(room,"s1",{x:300,y:140});
  assert.equal(Object.keys(room.arena.painterTerritory).filter((key)=>key.endsWith(":3")&&room.arena.painterTerritory[key]==="s1").length,18,"roller paints the complete row");
  room.arena.painterBuckets=[{id:4,col:8,row:4,type:"roller",orientation:"vertical",expiresAt:Date.now()+5000}];
  room.arena.positions.s1.updatedAt=0;gm.arenaPosition(room,"s1",{x:340,y:180});
  assert.equal(Object.keys(room.arena.painterTerritory).filter((key)=>key.startsWith("8:")&&room.arena.painterTerritory[key]==="s1").length,11,"vertical roller paints the complete column");
  room.arena.painterBuckets=[{id:5,col:9,row:4,type:"lightning",expiresAt:Date.now()+5000}];
  room.arena.positions.s1.updatedAt=0;gm.arenaPosition(room,"s1",{x:380,y:180});
  assert.ok(room.arena.positions.s2.painterStunnedUntil>Date.now()+1500,"lightning stuns every opponent");
  assert.equal(room.arena.positions.s1.painterStunnedUntil||0,0,"the collector is immune to their own lightning");
  const frozen={x:room.arena.positions.s2.x,y:room.arena.positions.s2.y};
  room.arena.positions.s2.updatedAt=0;gm.arenaPosition(room,"s2",{x:300,y:300});
  assert.deepEqual({x:room.arena.positions.s2.x,y:room.arena.positions.s2.y},frozen,"stunned players cannot move");
});

test("polygon pong: paddles move, misses cost three lives, and multiball grows", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.joinRoom("s3", room.code, "Erik");
  room.settings.mode = "pong";
  gm.startGame(room, "s1");
  assert.equal(last("arena:start").payload.pongSides,3);
  assert.equal(room.arena.lives.s1,3);
  gm.arenaPosition(room,"s1",{x:.8,y:0});
  assert.equal(room.arena.positions.s1.paddleT,.8);
  for(let miss=0;miss<3;miss++){
    Object.assign(room.arena.balls[0],{x:300,y:24,vx:0,vy:-120});
    room.arena.physicsAt=Date.now()-55;
    gm.tickArena(room);
  }
  assert.equal(room.arena.lives.s1,0);
  assert.ok(room.arena.eliminated.s1);
  room.arena.balls=[{id:1,x:360,y:220,vx:170,vy:100}];
  room.arena.nextBallAt=Date.now()-1;room.arena.physicsAt=Date.now();
  gm.tickArena(room);
  assert.equal(room.arena.balls.length,2);
  assert.equal(last("arena:pong-ball").payload.count,2);
});

test("polygon pong: corner strikes resolve against a side instead of escaping", () => {
  const { rm, gm } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "pong";
  gm.startGame(room, "s1");
  Object.assign(room.arena.balls[0],{x:540,y:40,vx:150,vy:-150});
  for(let i=0;i<4;i++){room.arena.physicsAt=Date.now()-55;gm.tickArena(room);}
  const ball=room.arena.balls[0],apothem=174;
  const outside=Math.max(
    (ball.x-360),(360-ball.x),(ball.y-220),(220-ball.y)
  );
  assert.ok(outside<apothem+16,"a corner ball must be reflected or charged as a miss");
});

test("choose a door: fire escape locks choices and enforces hidden route geometry", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.joinRoom("s3", room.code, "Erik");
  rm.joinRoom("s4", room.code, "Mina");
  room.settings.mode = "doors";
  gm.startGame(room, "s1");
  assert.deepEqual(room.doors.botTargets,{},"fire escape initializes bot lane targets before the bot loop runs");
  const sharedUpdate=Date.now()-100;Object.assign(room.doors.positions.s1,{y:1400,updatedAt:sharedUpdate});Object.assign(room.doors.positions.s2,{y:1400,updatedAt:sharedUpdate});
  gm.doorsPosition(room,"s1",{x:120,y:0});gm.doorsPosition(room,"s2",{x:360,y:1399});assert.ok(Math.abs(room.doors.positions.s1.y-room.doors.positions.s2.y)<1,"all runners advance at the same server-authoritative speed regardless of submitted y");
  room.doors.routes=["straight","big","small"];room.doors.routeSets[0]=room.doors.routes;
  room.doors.positions.s1 = { x: 120, y: 1070, updatedAt: 0 };
  gm.doorsPosition(room, "s1", { x: 120, y: 1030 });
  assert.equal(room.doors.choices.s1, 0, "crossing the lane split locks that lane");
  gm.chooseDoor(room,"s1",2);assert.equal(room.doors.choices.s1,0,"a locked choice cannot be regretted");
  gm.chooseDoor(room,"s2",1);Object.assign(room.doors.positions.s2,{x:360,y:720,updatedAt:0});gm.doorsPosition(room,"s2",{x:360,y:680});assert.equal(room.doors.positions.s2.y,700,"the big route forces its first detour");
  gm.chooseDoor(room,"s3",2);Object.assign(room.doors.positions.s3,{x:630,y:580,updatedAt:0});gm.doorsPosition(room,"s3",{x:630,y:540});assert.equal(room.doors.positions.s3.y,560,"the small route forces its single detour");
  Object.assign(room.doors.positions.s1,{x:120,y:280,updatedAt:0});gm.doorsPosition(room,"s1",{x:120,y:260});assert.equal(room.doors.stageByPlayer.s1,1,"finishing one route opens another irreversible lane choice");assert.equal(room.doors.choices.s1,undefined,"the next junction requires a fresh choice");
  gm.eliminateDoorRunner(room,"s1","fire");gm.eliminateDoorRunner(room,"s2","fire");gm.eliminateDoorRunner(room,"s3","fire");room.doors.endingAt=Date.now()-1;gm.tickDoors(room);
  assert.equal(last("round:results").payload.ranking[0].playerId,"s4","the round ends when only one runner remains");
});

test("fire escape accepts movement immediately and rising fire leaves exactly one survivor",()=>{
  const {rm,gm,last}=harness();const {room}=rm.createRoom("s1","Runar");rm.joinRoom("s2",room.code,"Anna");room.settings.mode="doors";gm.startGame(room,"s1");gm.disarmTimer(room);
  const startY=room.doors.positions.s1.y;assert.equal(gm.doorsPosition(room,"s1",{x:room.doors.positions.s1.x,y:startY-30}).ok,true);assert.ok(room.doors.positions.s1.y<startY,"the first movement packet must not be discarded");
  room.doors.startedAt=Date.now()-7000;room.doors.positions.s1.y=1400;room.doors.positions.s2.y=1400;gm.tickDoors(room);room.doors.endingAt=Date.now()-1;gm.tickDoors(room);
  const result=last("round:results").payload;assert.equal(result.ranking.filter((p)=>p.survived).length,1,"the fire stops after swallowing the second-last runner");
});

test("red light: green presses advance, red presses eliminate, finishers win", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.joinRoom("s3", room.code, "Erik");
  room.settings.mode = "redlight";
  room.settings.rounds = 1;
  gm.startGame(room, "s1");

  assert.equal(room.redlight.controllerId, "s1");
  assert.equal(gm.redLightPress(room, "s1").ok, false);
  gm.redLightPress(room, "s2");
  assert.equal(room.redlight.players.s2.progress, 2);
  assert.equal(gm.redLightControl(room, "s1", "feint").ok, true);
  assert.equal(room.redlight.light, "green", "a feint must not change the real light");
  assert.equal(room.redlight.battery <= 88, true, "a feint should consume battery");
  room.redlight.battery = 19;
  room.redlight.batteryUpdatedAt = Date.now();
  assert.equal(gm.redLightControl(room, "s1", "toggle").ok, false, "low battery blocks red");
  room.redlight.battery = 100;
  gm.redLightControl(room, "s1", "toggle");
  room.redlight.players.s2.lastPress = 0;
  gm.redLightPress(room, "s2");
  assert.equal(room.redlight.players.s2.eliminated, true);

  gm.redLightControl(room, "s1", "toggle");
  for (let i = 0; i < 50; i++) {
    room.redlight.players.s3.lastPress = 0;
    gm.redLightPress(room, "s3");
  }
  assert.equal(room.state, GAME_STATES.RESULTS);
  const result = last("round:results").payload;
  assert.equal(result.mode, "redlight");
  assert.equal(result.ranking[0].playerId, "s3");
  assert.equal(result.ranking[0].finished, true);
  assert.equal(result.ranking[1].eliminated, true);
  assert.equal(result.ranking[2].isController, true);
  assert.equal(result.ranking[2].pointsAwarded, 25);
});

test("hide & blow up: choices stay secret until attack and survivors score", () => {
  const { rm, gm, last, events } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.joinRoom("s3", room.code, "Erik");
  rm.joinRoom("s4", room.code, "Mina");
  room.settings.mode = "hidebomb";
  room.settings.rounds = 1;
  gm.startGame(room, "s1");

  assert.equal(room.hidebomb.bomberId, "s1");
  gm.hideBombChoose(room, "s2", 0);
  gm.hideBombChoose(room, "s3", 1);
  gm.hideBombChoose(room, "s4", 2);
  const publicProgress = last("hidebomb:progress").payload;
  assert.equal("choices" in publicProgress, false, "public progress must not leak hiding places");
  assert.equal(room.hidebomb.stage, "hide", "players may change their last choice until time expires");
  gm.startHideBombAttack(room);
  gm.hideBombAttack(room, "s1", 0);
  assert.equal(room.hidebomb.stage, "ignite");
  assert.equal(last("hidebomb:ignite").payload.target, 0);
  gm.resolveHideBombAttack(room);
  const reveal = last("hidebomb:reveal").payload;
  assert.equal(reveal.eliminated.includes("s2"), true);
  assert.equal(reveal.choices.length, 1, "only the fired cannon may reveal occupants");
  assert.equal(reveal.choices[0].playerId, "s2");

  gm.startHideBombAttack(room);
  assert.equal(room.hidebomb.choices.s3, 1, "survivors must remain in their original cannon");
  gm.hideBombAttack(room, "s1", 1);
  gm.resolveHideBombAttack(room);
  gm.startHideBombAttack(room);
  gm.hideBombAttack(room, "s1", 3);
  gm.resolveHideBombAttack(room);
  assert.equal(room.hidebomb.stage, "reveal", "final explosion should remain visible before results");
  gm.finishHideBombRound(room);

  assert.equal(room.state, GAME_STATES.RESULTS);
  const result = last("round:results").payload;
  assert.equal(result.mode, "hidebomb");
  assert.equal(result.ranking.find((r) => r.playerId === "s4").pointsAwarded, 100);
  assert.equal(result.ranking.find((r) => r.playerId === "s1").pointsAwarded, 0);
  assert.equal(events.some((e) => e.event === "hidebomb:reveal"), true);
});

test("timeline placement correctness handles before/between/after and ties", () => {
  const { gm } = harness();
  const cards = [{ year: 1900 }, { year: 1950 }, { year: 2000 }];
  // slot 0 = before first; slot 3 = after last; slots 1,2 = between.
  assert.equal(gm.isPlacementCorrect(cards, 0, 1850), true);
  assert.equal(gm.isPlacementCorrect(cards, 0, 1970), false);
  assert.equal(gm.isPlacementCorrect(cards, 1, 1925), true);   // between 1900 and 1950
  assert.equal(gm.isPlacementCorrect(cards, 2, 1975), true);   // between 1950 and 2000
  assert.equal(gm.isPlacementCorrect(cards, 3, 2020), true);   // after last
  assert.equal(gm.isPlacementCorrect(cards, 3, 1975), false);
  assert.equal(gm.isPlacementCorrect(cards, 1, 1900), true);   // "at exactly" a boundary
});

test("timeline: team draw creates coloured shared timelines and last picks count", () => {
  const { rm, gm, last } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  rm.joinRoom("s3", room.code, "Erik");
  room.settings.mode = "timeline";
  room.settings.target = 20; gm.random=()=>.1;
  gm.startGame(room, "s1");
  assert.equal(room.timeline.teamMode, true, "the draw can select teams");
  assert.equal(room.timeline.sides.length, 2, "two coloured teams are created");
  const t0 = last("turn:started").payload;
  assert.equal(t0.teamMode, true);
  assert.equal(t0.card.year, undefined, "year leaked in team payload");
  const side=room.timeline.sides.find((s)=>s.memberIds.includes("s1"));
  const correct=side.cards.findIndex((c)=>room.currentCard.year<=c.year);const slot=correct<0?side.cards.length:correct;
  gm.timelinePlace(room,"s1",slot===0?Math.min(1,side.cards.length):0);
  gm.timelinePlace(room,"s1",slot); // latest pick replaces the earlier one
  assert.equal(room.timeline.picks.s1.slot,slot);
  const before=side.cards.length;gm.resolveTimelineRound(room);
  assert.ok(last("timeline:result").payload.perPlayer.some((p)=>p.playerId==="s1"&&p.correct));
  assert.equal(side.cards.length,before+1,"one correct teammate grows the shared timeline once");
});

test("timeline: solo players place simultaneously and first to target wins", () => {
  const { rm, gm, last, events } = harness();
  const { room } = rm.createRoom("s1", "Runar");
  rm.joinRoom("s2", room.code, "Anna");
  room.settings.mode = "timeline";
  room.settings.target = 5;

  gm.startGame(room, "s1");
  assert.equal(room.state, GAME_STATES.QUESTION);
  // Each player receives an individually coloured timeline, zero points.
  assert.equal(room.timeline.teamMode,false);
  assert.equal(room.timeline.sides.length,2);
  assert.equal(room.players["s1"].score, 0);

  // The public turn payload must not leak the year.
  const t0 = last("turn:started").payload;
  assert.equal(t0.card.year, undefined, "card year leaked");
  assert.ok(t0.sides.length === 2);

  // Every player keeps a pick; the timer resolution scores their last pick.
  let guard = 0;
  while (room.state === GAME_STATES.QUESTION && guard++ < 500) {
    for(const player of rm.connectedPlayers(room)){
      const side=room.timeline.sides.find((s)=>s.memberIds.includes(player.id));
      let slot=side.cards.slice().sort((a,b)=>a.year-b.year).findIndex((c)=>room.currentCard.year<=c.year);
      if(slot<0)slot=side.cards.length;
      assert.equal(gm.timelinePlace(room,player.id,slot).ok,true);
    }
    gm.resolveTimelineRound(room);
  }

  assert.equal(room.state, GAME_STATES.FINISHED);
  const fin = last("game:finished").payload;
  assert.equal(fin.mode, "timeline");
  assert.ok(fin.standings[0].score >= 5, "winner should reach the target");
  // A result event was emitted for placements.
  assert.ok(events.some((e) => e.event === "timeline:result"));
});
