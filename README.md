# Mini Mayhem

A browser-based multiplayer party game. Players join a private room with a short
code, then compete over five rounds of numerical trivia. Each round, everyone
submits one guess — the player **closest** to the correct answer scores the most
points.

> **Question:** How deep is the Mariana Trench?
> Runar guesses 10,500 m · Anna 12,000 m · Erik 8,900 m · Answer: 10,984 m →
> **Runar wins the round.**

## Game modes

The host picks a mode in the lobby before starting:

- **🧠 Trivia** — everyone guesses a number at once; closest wins (100 / 60 / 30, then 10).
- **🕰️ Timeline (Hitster-style)** — an event appears with its year hidden and must
  be slotted into a timeline (before / between / after existing cards). Two ways to
  play, chosen automatically by player count:
  - **Solo (2 players):** on your turn, slot the card into **your own** timeline;
    first to the target (default 11) wins.
  - **Team vote (3+ players):** everyone shares one timeline. Tap where you think the
    card goes — your character appears at that slot so you can **discuss** — then
    **lock in** your vote (you can unlock and change it). When everyone's locked, the
    **majority** placement decides whether the card is placed or discarded, and every
    player who personally voted a correct spot scores a point. First to the target wins.
- **🥌 Curling** — players shoot in turn, **the current leader first**, and every
  shot is revealed as it's taken so later players can react. Closest wins.
- **💣 Bomb** — a hidden number of presses arms the bomb. On your turn you press
  **1–3 times**; whoever makes it pop loses the round (0 points) while everyone
  else scores.
- **🗺️ Map "Place it"** — everyone sees a prompt (a capital, country, flag, river,
  mountain or landmark) and taps the world map to drop a pin. Closest by real
  great-circle distance wins. Categories toggle on/off.
- **🏗️ Build & Race** — players reserve blocks and traps from one shared pool
  while watching each other's live placement ghosts, then race a large shared
  course. The scarce pool is randomized each round and can contain blocks,
  spikes, bounce pads, ice, crumbling tiles, saws, conveyors and demolition
  bombs that remove previously player-placed objects.
  Buffered jumps, precise hazards and fast live racer updates keep keyboard and
  touch controls responsive.
- **🎨 Drawing** — one player draws a secret word on the shared canvas while
  everyone else guesses; correct guesses reward both the guesser and artist.
- **🐧 Pushy** — all players move together on one shared icy platform while
  increasingly dense left-to-right penguin crowds try to shove them into the
  water.
- **🚦 Red Light, Green Light** — one player controls the real light and can
  throw harmless red-light feints while everyone else holds to run and must
  release before a genuine red light. A recharging battery prevents the
  controller from leaving red on indefinitely.
- **💣 Hide and Go BOOM!** — the team gets ten seconds to choose one of four
  cannons, then stays hidden while the rotating solo player lights three
  different fuses. The solo player is blindfolded during hiding, and every
  choice has a synchronized fuse-burning suspense animation before the reveal.
  The team wins if anyone remains.

Trivia and Timeline also support **category include/exclude**, and every mode lets
the host choose the number of rounds (or the Hitster win target) and the time per turn.

### 🎮 Arcade playlist

Flip on **Arcade** in the lobby and build a playlist of modes (tap to add them in
order). The game then plays each mode back-to-back as a "leg", **scores carry over**
between legs, and between games everyone sees a running leaderboard while the host
starts the next one. After the final leg, one combined **grand champion** is crowned.

Before joining, each player builds a simple **character** (an emoji + colour) that
appears next to their name in the lobby, timelines, scoreboard and podium. The
choice is remembered on your device, and each character reacts with a **happy,
neutral or sad** sound when good, ordinary or bad things happen to it.

Action minigames render that identity through an original code-native
**paper-cutout character system**. The shared renderer supports idle, run, jump,
fall, stunned, eliminated, celebrate and sad states in both Canvas and regular
HTML interfaces, with no external art assets.

## Tech

- **Server:** Node.js + Express + Socket.IO (server-authoritative game state)
- **Client:** Vanilla HTML / CSS / JavaScript + Socket.IO client
- **Data:** in-memory rooms — no database

## Install & run

Requires Node.js 18+.

```bash
npm install
npm start
```

Then open **http://localhost:3000** in two browser tabs (or two phones on the
same network) to play.

### Useful options

```bash
# Run on a different port
PORT=4000 npm start

# Allow starting a game with a single player (handy for solo testing)
MIN_PLAYERS=1 npm start

# Change the per-round countdown (seconds, clamped 5–300; default 30)
ROUND_SECONDS=20 npm start
```

### Run the tests

```bash
npm test
```

Tests use Node's built-in test runner (`node --test`) — no extra framework.

## How to play

1. Enter your name and press **Create a room**. You are the host.
2. Share the room: press **Copy invite link** and send it, or read out the
   6-character room code.
3. Others open the link (which pre-fills the code) or enter the code manually,
   type their name, then **Join**.
4. When at least two players are in the lobby, the host presses **Start game**.
5. Each round shows one question. Type a number and **Submit guess**.
   You cannot change your guess once submitted.
6. When everyone has answered (or the 30-second timer expires) the answer and
   the ranking are revealed. Points: **100 / 60 / 30** for the three closest,
   **10** for any other valid guess. Tied distances score the same.
7. After five rounds the winner is crowned. The host can **Play again**.

If you accidentally refresh or briefly lose connection mid-game, you are
automatically returned to your seat with your score intact. A mute button
(top-right) toggles sound effects.

## Architecture

```
closest-wins/
├── server.js              # Express + Socket.IO wiring and event handlers
├── src/
│   ├── roomManager.js     # Rooms, codes, membership, host migration, cleanup
│   ├── gameManager.js     # Game loop: start, guesses, scoring, rounds, timer
│   ├── scoring.js         # Pure rank-based scoring (fully unit-tested)
│   ├── questionManager.js # Mode-aware selection (+ no-repeat, category filter)
│   ├── questions.js       # ~65 hand-written trivia questions with answers
│   ├── timelineEvents.js  # Dated events for Timeline mode
│   └── mapPlaces.js       # Geo-located places for Map mode
├── public/
│   ├── index.html         # All screens (home / lobby / question / map / results / …)
│   ├── styles.css         # Mobile-first, dark theme, one accent colour
│   ├── characters.js      # Shared paper-cutout renderer + animation states
│   ├── world.js           # Baked equirectangular world outline (Natural Earth 110m)
│   └── app.js             # State rendering + socket handling on the client
└── tests/
    ├── scoring.test.js
    ├── roomManager.test.js
    ├── gameManager.test.js
    ├── rejoin.test.js      # Reconnect / host restoration on refresh
    ├── questions.test.js   # Question-bank integrity + filtered picking
    ├── settings.test.js    # Settings validation + host-only guards
    ├── modes.test.js       # No-repeat, curling turns, bomb pop, timeline
    ├── avatars.test.js     # Avatar validation
    ├── arcade.test.js      # Playlist validation, leg advance, grand finish
    └── map.test.js         # Haversine scoring, map reveal, pin validation
```

Run `npm test` — 76 tests across scoring, rooms, reconnect, settings, avatars, the
arcade playlist and all ten game modes.

### Roadmap

Built: Arcade playlist ✅, Map "Place it" ✅, Leave button + confirm dialogs ✅,
Timeline team-voting ✅, character reaction sounds ✅, Build & Race platformer ✅,
Drawing ✅, Pushy platform survival ✅, Red Light Green Light ✅,
Hide and Go BOOM! ✅.

Systems & minigame ideas queued:

- **Mid-match chaos events** — random twists partway through a match (scoreboard
  flipped, the bottom player gets a boost, and other ways to mess with each other).
- **Journey map** — a little board/path shown between arcade games to visualise
  progress through the playlist.
- **Memory / Simon** — a card flashes N symbols, then vanishes; after a 3-2-1
  countdown a field of random icons appears and each player must click the symbols
  in the right order. Each round adds one symbol; one mistake and you're out.
- **Drag Race / Gear Shift** — a Mario Speedwagons-style race focused entirely
  on timing gear changes. Each shift has a moving sweet spot; the more precisely
  a player shifts, the more speed they carry into the next gear. Mistimed shifts
  bog down or briefly over-rev, and the most consistently precise driver wins.
- **Color Twister / Safe Color** — players move across a floor made from several
  colored tiles while a large sign rapidly flashes through those same colors.
  When the sign stops, only tiles matching the selected color are safe; every
  other tile becomes lava for a short elimination pulse. The flashing gets
  faster and safe areas become smaller until one player remains.
- **Vanishing Grid** — every floor tile cracks when stepped on and disappears
  shortly afterward. Players must keep moving and can cut off opponents, but
  cannot remain on one tile indefinitely. Fallen players are eliminated and the
  last survivor wins.
- **Bomb Pass** — one player carries a bomb with a hidden fuse. Touching another
  player passes the bomb and briefly protects the recipient from an immediate
  pass-back. Movement speed and warning effects increase as the fuse gets close
  to exploding; the holder is eliminated when it detonates.
- **Fire Escape** — outrun rising flames and commit to one of three hidden routes
  across three consecutive selections. Doors can be safe, eliminate a player,
  deal persistent damage, or apply inconveniences such as reversed controls,
  slower movement, obscured choices, or a shorter decision timer. Surviving all
  three doors wins, with points awarded for each stage reached.
- **N-Sided Pong** — each player guards one side of a polygonal arena while a
  shared ball ricochets between the walls. Missing the ball costs a life or
  removes that side of the arena; the final player remaining wins. The arena
  scales from a triangle for three players to larger polygons for bigger groups.
- **Volleyball** — two teams move and jump on opposite sides of a net, trying to
  keep the ball airborne and ground it on the opposing court. Use short rounds,
  forgiving touches, team-colored halves, and a brief serve countdown so it
  remains readable and responsive with the lightweight 2D character system.

**Server authority.** The server owns all game state (`lobby → question →
results → finished`). The client only renders pushed state and submits actions.
The correct answer is never sent to clients during a round — see
`toPublicQuestion()` in [src/questionManager.js](src/questionManager.js). Clients
cannot award points, pick questions, decide the winner, advance rounds, or
submit for another player.

### Socket.IO events

**Client → server:** `room:create`, `room:join`, `room:rejoin`, `room:leave`,
`settings:update`, `game:start`, `guess:submit`, `bomb:press`, `timeline:place`,
`timeline:vote`, `timeline:lock`, `platformer:map-vote`, `platformer:select`, `platformer:hover`, `platformer:place`, `platformer:lock`,
`platformer:position`, `platformer:outcome`, `drawing:stroke`, `drawing:clear`, `drawing:guess`,
`pushy:position`, `pushy:outcome`, `redlight:press`, `redlight:control`, `round:next`,
`hidebomb:choose`, `hidebomb:attack`, `arcade:advance`, `game:restart`

**Server → client:** `room:created`, `room:joined`, `room:resumed`,
`room:rejoin:failed`, `room:updated`, `room:error`, `round:question`,
`turn:started`, `turn:update`, `timeline:result`, `timeline:votes`,
`platformer:map-vote`, `platformer:map-votes`, `platformer:map-selected`,
`platformer:build`, `platformer:builders`, `platformer:placed`, `platformer:race`,
`platformer:positions`, `platformer:progress`, `drawing:start`, `drawing:secret`, `drawing:stroke`,
`drawing:cleared`, `drawing:guess`, `pushy:start`, `pushy:positions`, `pushy:progress`,
`redlight:start`, `redlight:light`, `redlight:feint`, `redlight:battery`, `redlight:progress`,
`redlight:caught`, `guess:accepted`, `round:progress`, `round:results`,
`hidebomb:start`, `hidebomb:chosen`, `hidebomb:progress`, `hidebomb:attack`,
`hidebomb:ignite`, `hidebomb:reveal`, `arcade:intermission`, `game:finished`, `host:changed`

Turn-based modes (Curling, Bomb) use `turn:started` / `turn:update` instead of the
simultaneous `round:question` / `round:progress` pair.

## Reliability

- **Validation:** player names (2–20 chars, unique, trimmed, escaped on
  display), room codes (6 uppercase chars, no confusing `0/O/1/I`), guesses
  (finite, within bounds, one per round).
- **Disconnects:** lobby leavers are removed; mid-game leavers are marked
  disconnected but keep their score. If the host leaves, host passes to the
  first remaining connected player. Empty rooms are deleted, and inactive rooms
  are cleaned up after ~1 hour.
- **Reconnect:** each player gets a stable session token (kept in
  `sessionStorage`). On a refresh or dropped connection the client silently
  rejoins the same room and is placed back on the current screen — question,
  results or final — with their score and submitted guess preserved.
- **XSS:** all user-supplied text is HTML-escaped before rendering.

## Known limitations

- Rooms live in memory only, so a server restart drops all active games.
- Reconnect relies on `sessionStorage`, so it works across a refresh or brief
  disconnect but not after the browser tab is closed.
- Question answers are approximate by nature — the game rewards closeness, not
  exactness.
- Single Node process; no horizontal scaling.
