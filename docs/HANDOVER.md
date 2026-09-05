# Progress update — Confetti: Pocket Party

> Historical handover. For the 2026-09-05 audit and current launch requirements,
> read [ROADMAP.md](ROADMAP.md) and [STEAM-ONLINE.md](STEAM-ONLINE.md).

Handover for whoever picks this repo up next. Covers commits `6486e14`
through `18bcef8`.

**Headline: the game is renamed, ships as a desktop app, and the whole Steam
store kit exists.** Test suite is at **149 across 16 files** (was 115).

---

## 1. The game is now "Confetti: Pocket Party"

`Mini Mayhem` was effectively taken, and the shortlist ran into a crowded
shelf — Pummel Party, Mojo Party, Play Together, Play Friends and Arcade Party
all occupy the same genre and player count.

**Renames that will break your muscle memory:**

| Old | New |
|---|---|
| `window.MiniMayhemAudio` | `window.ConfettiAudio` |
| `window.MiniMayhemMenu` | `window.ConfettiMenu` |
| `window.miniMayhemDesktop` | `window.confettiDesktop` |
| IPC `minimayhem:*` | `confetti:*` |
| `mini-mayhem-*` localStorage | `confetti-*` |
| package `main` | `server.js` → `electron/main.js` |

⚠️ **localStorage keys were renamed WITH a migration** — see
`migrateLegacyStorage()` near the top of `app.js`. It copies the old
`mini-mayhem-*` / `closest-wins-*` keys across once. **Don't delete it before
first public release**; anyone who played a pre-rename build would silently
lose settings, cosmetics and match history.

`npm start`, `npm run dev` and `npm test` all behave exactly as before.

---

## 2. Desktop build (Electron)

New: `electron/main.js`, `electron/preload.js`, `electron/README.md`.

The shell starts the existing server **in-process on an OS-assigned free
port**, waits for it to listen, then opens a window at the resolved URL.
`PORT` still wins if set, which makes the desktop build tunnelable.

```
npm run desktop          # run against the working tree
npm run desktop:dir      # unpacked build in dist/ (this is what Steam wants)
npm run desktop:installer
```

**Things that will bite you if you touch this:**

- `server.js` now exports `start()` / `stop()` and only self-starts under
  `require.main === module`.
- **Do not pass a host to `server.listen`.** An earlier version bound
  `"0.0.0.0"`, which is IPv4-only; Windows resolves `localhost` to `::1`
  first, so `http://localhost` broke entirely. It binds dual-stack now, and
  that still accepts LAN connections.
- `asar: true` but **only `public/audio` is unpacked**. `public` as a whole
  must stay inside the archive because `src/gameManager.js` requires
  `../public/vanishMaps.js`.
- App icon lives at `build/icon.ico`, 7 sizes. Regenerate with
  `outputs/makecapsules.py`-style scripts if the palette changes.

---

## 3. Shared server+client modules — the important pattern

Three modules are loaded by **both** Node (`require`) and the browser
(`<script>`), following the existing `vanishMaps.js` shape:

| File | Holds |
|---|---|
| `public/progression.js` | emoji / colour / title / frame catalogues, unlock rules, `MAX_PLAYERS` |
| `public/modeInfo.js` | per-mode `min`/`max` and `bestFrom`/`bestTo` player counts |
| `public/vanishMaps.js` | (existing) Vanishing Grid layouts |

**Why it matters:** the server validates avatars against
`progression.js`. A cosmetic added on the client only would be silently
stripped on join. If you add one, add it there, not in `app.js`.

⚠️ **Room capacity changed shape.** It used to be
`usedColors.size >= AVATAR_COLORS.length`, so adding an unlockable colour
would have quietly raised the player cap. It's now an explicit
`MAX_PLAYERS = 8` in `progression.js`, with a test guarding the coupling.

---

## 4. New self-contained client modules

These deliberately build their own markup and inline styles and **do not
touch `app.js` or `styles.css`**, so they don't collide with game-logic work:

- `public/menu.js` — Settings / Credits / Unlockables panels
- `public/desktopHost.js` — lobby join panel (LAN URL + QR)
- `public/qrLite.js` — dependency-free QR encoder

If you're adding UI of this kind, the same approach is worth copying.

**On `qrLite.js`:** a CDN library wasn't an option because the desktop build
must work offline. It's covered by `tests/qrLite.test.js`, which decodes the
symbol back out and validates the Reed-Solomon bytes against a published test
vector. **Keep that test.** A subtly wrong encoder still round-trips its own
data while producing codes no real scanner accepts — that exact bug shipped
and was only caught by the known-answer check.

---

## 5. Features added

**Start menu** (`#screen-start`, now the first screen). Couch party · Online
party (disabled, "Coming soon") · Unlockables & stats · Settings · Credits ·
Exit (desktop only). The old home screen became the party-setup step.

**Settings**: music volume, SFX volume, SFX on/off, fullscreen — all
persisted. SFX volume didn't previously exist; it was a fixed `.28`.

**Cosmetic progression**: 28 emojis, 16 colours, 12 titles, 6 frames, gated on
games played / won / per-mode wins / distinct modes / streaks. Unlock state is
**client-side in localStorage** — deliberately not authoritative, to avoid
needing accounts. `avatarHtml()` is the single choke point for all 24 avatar
render sites; frames and titles were added there.

**Mode recommendations**: the lobby sorts minigames by fit for the current
player count and annotates them ("GREAT WITH 5", "Needs 3+ players"). Nothing
is ever blocked — the host keeps the final say. There's a
"Recommend for N players" button that fills the playlist.

⚠️ **The default playlist changed.** It previously contained only two of the
six best-received modes and *did* include the weakest one. It now leads with
the playtest winners, and `tests/modeInfo.test.js` guards that.

---

## 6. Bugs fixed — please don't reintroduce these

**Reconnect** (`edc7d90`)
- Session moved `sessionStorage` → `localStorage` with a 12h expiry.
  sessionStorage dies with the tab, which is exactly what happens when a phone
  evicts a backgrounded page.
- Auto-rejoin was gated on `currentScreen === "home"`. Adding the start menu
  meant a fresh load landed on `"start"`, silently killing resume-on-refresh.
  Now gated on `!state.room`.
- A dropped lobby connection holds the seat for 2 minutes; pressing Leave
  still frees it immediately. An emptied room survives 5 minutes.
- **Round timers deliberately keep running in an empty room.** Freezing them
  left a rejoining player on a round with a dead deadline that nothing would
  ever resolve.

**Curling audio** (`360e68d`, `c394575`)
- `curlingState()` included the trajectory in *every* state emit but only
  cleared it at round start, so each `turn:update` replayed the previous
  shot's animation and sounds. Now sent only during live playback, stamped
  with `curlingShotSeq`, and the client ignores a repeat of the shot it's
  already animating.
- The simulation samples a frame every 3 steps and a stone leaving the board
  freezes it, so the loop broke before `off` was ever sampled — measured at
  exactly 1 in 3 shots losing the sound. The settled state is now always
  appended as a final frame.

**Pong bandwidth** (`fef699a`)
- `arena:pong` fires ~18×/s and was sending the whole `arenaPublic()` players
  array — 25 fields each, most belonging to other minigames. Measured at
  **520 KB/s** for an 8-player room, ~50× every other mode. Now 108 KB/s.
- `updateArenaPlayers` merges the local player instead of replacing them,
  because slim packets omit stable fields like name and avatar.

---

## 7. Store kit (all new, in `store/`)

- `steam-store-copy.md` — short/long description, feature bullets, tags, EA
  questionnaire answers
- `trailer-shot-list.md` — 45s shot list, capture notes, capsule sizes
- `capsules/` — all five Steam capsule sizes, generated
- Trailer rough cut and 11 screenshots live in the user's
  `Videos/steamstorepage` folder, not this repo

⚠️ **Positioning note.** An earlier draft led with "everyone plays from their
own phone". That over-claims — phone controls aren't validated across every
minigame and desktop players are a first-class path. Copy now leads with the
games; joining method is a supporting fact. **Please keep it that way** unless
phone support gets finished.

---

## 8. Decisions on the shelf

**Landscape arena mode — scoped then deliberately shelved.** See
`docs/landscape-arena-scope.md`. The arena canvas is natively 720×440
(landscape) squeezed into a 460px portrait column. Fixing it is ~a week of
medium-risk work, and the minigames that tested best are portrait modes it
wouldn't change. Revisit if playtesters struggle on phones.

**Online play**: not built. The menu entry is visibly disabled. The free
option is Steam's relay (SDR), which works between Steam clients only — so
remote *phones* would need a paid relay, remote *PCs* wouldn't.

**Open decisions**: price, Early Access vs 1.0, and whether to claim all 19
minigames on the store page (claiming 19 sets an expectation that all 19 are
good).

---

## 9. Playtest findings

Best received: **Place It, Timeline, Trivia, Blast Brawl, Polygon Pong,
Balloon**. Solid: Curling, Wild Run, Build & Race, Pocket Racers (only tested
at 2 players). Weakest: **Territory Painter** — it's a territory race and
needs bodies on the board, now marked `bestFrom: 5` rather than treated as
broken.

The pattern: legibility beats depth. The strongest modes are either
simultaneous-and-social or instantly readable with one input.

---

## 10. Housekeeping

- Branch `agent/pre-battle-mode-backup`, in sync with origin as of `18bcef8`.
- **Uncommitted right now:** `docs/`, `store/capsules/`, and a modified
  `store/steam-store-copy.md`.
- `npm test` runs `node --test "tests/**/*.test.js"` — the glob is deliberate.
  A bare `node --test` also discovers the `_safety-backup-*/tests` copies and
  runs everything twice.
- Backups at `_safety-backup-*/` are gitignored working-tree snapshots.
