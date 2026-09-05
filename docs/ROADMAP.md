# Confetti: Pocket Party — release roadmap

Reviewed 2026-09-05 against the working tree. This document supersedes older
roadmap statements in README and HANDOVER. Steam App ID: **5229250**.

## Launch decision

PC online multiplayer through Steam is required before launch. Phones remain
a LAN joining option. Online is not implemented yet and must not be advertised
as available until it passes the acceptance checks below.

## Current baseline

- Implemented: battle wheel with repeat weighting, star and winner ceremonies,
  countdowns, rematch, reconnect, bot testing, music/SFX and cosmetic progression.
- Windows Electron wrapper and packaging configuration exist.
- 21 implemented modes; 18 friend-test-ready and 3 WIP. Ready is not release QA.
- 148 automated tests passed in the 2026-09-05 review.
- Capsules and store-copy drafts exist. Store artwork and gameplay need consistent faces.

## Provisional launch lineup (18)

Trivia, Place It, Timeline, Drawing, Balloon Popper, Curling, Ricochet Golf,
Build & Race, Penguin Menace, Cannon Caper, Color Twister, Vanishing Grid,
Blast Brawl, Pocket Racers, Dragon Rider, Wild Run, Territory Painter, Polygon Pong.

WIP, excluded from recommendations: Bomb Pass, Red Light, Fire Escape.
Keep these separate until promoted by multiplayer playtest results.

## Passes and completion criteria

1. **Release baseline and visual consistency — in progress.** Back up current
   changes, reconcile roadmap/store counts, unify SVG/canvas expression artwork
   with capsule characters. Check faces at actual phone and desktop sizes.
2. **Steam online integration — required, not implemented.** Native Steam API
   initialization, friends-only lobbies/invites, relay transport to the host's
   authoritative server, identity binding, session cleanup and reconnect.
   See STEAM-ONLINE.md for the integration boundary.
3. **Packaged multiplayer validation — pending.** Run all launch modes at 2, 4
   and 8 players (respect role-split minimums), with real remote Steam clients.
   Verify last survivor, ties, round transitions, host/guest deaths, audio,
   phone multi-touch on LAN, refresh, screen lock and disconnect handling.
4. **Store/build release gate — pending.** Confirm screenshots/trailer match
   shipping gameplay, verify audio credits/licenses, test a clean Windows install,
   upload/test a Steam branch, and settle price and Early Access versus 1.0.

## Online acceptance gate

- Two Steam accounts on separate networks can invite, join and finish a match.
- No public tunnel or manual port forwarding required.
- 4–8 players complete a battle without stuck screens or missing characters.
- Malformed messages and non-members cannot act as another player.
- Version mismatch, invitation failure and disconnects have readable feedback.
- Host exit is handled explicitly; host migration is not promised because game
  state currently lives only in the host process.
- Repeated joins/leaves and reconnects do not leak sessions or replay old actions.

## Deferred

Memory/Simon, gear-shift drag racing, volleyball, journey map and chaos events.
Landscape phone layout remains shelved. Cosmetic unlocks are local achievements,
not Steam achievements or Steam Cloud synchronization.
