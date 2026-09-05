# Steam online integration

App ID **5229250**, supplied by Runar on 2026-09-05.
Status: design established; no Steam runtime or relay integration implemented.

## Existing boundary

Electron starts server.js locally. The renderer uses Socket.IO; gameManager owns
game state and roomManager keys players by their socket sessions. A Steam lobby
alone cannot carry these connections over the internet.

## Intended architecture

- Steam SDK initialization, lobby callbacks, invites and networking live in
  Electron main/native code, never in the web renderer.
- Host runs the existing authoritative Node game server.
- Guests render local bundled assets and communicate through a transport bridge
  over SteamNetworkingMessages or SteamNetworkingSockets with relay support.
- Evaluate an event adapter versus a local Socket.IO proxy in a two-client spike
  before rewriting the game's transport. Preserve existing room permissions,
  acknowledgement handling, replay/resume logic and event ordering.
- Bind authenticated remote Steam IDs to server sessions. Do not trust Steam IDs
  supplied inside game payloads. Accept traffic only from current lobby members.
- Keep lobby discovery separate from high-frequency game packets; reliable events
  for round changes/actions, with movement sequencing to reject stale updates.
- Reject incompatible protocol versions; bound packet sizes and inbound rates.
- A failed native initialization must leave LAN play usable.

## Implementation sequence

Candidate binding: https://github.com/ceifa/steamworks.js (Electron/Node native
module). Its documented `init(appId)` entry point is suitable for the first
spike; networking and callback declarations still need checking before selection.
Keep native calls in main with context isolation enabled, rather than copying
the README's optional renderer/nodeIntegration example.

1. Verify an Electron-compatible maintained native binding exposes current Steam
   lobby/invite callbacks AND modern relay networking, including Windows packaging.
2. Initialize 5229250 under Steam, test lobby create/join/invite with two accounts.
3. Send authenticated echo messages over the relay; verify disconnect cleanup.
4. Bridge one trivia round end-to-end; then test action updates and reconnect.
5. Enable the online menu only when real cross-network play works.
6. Validate all launch modes and the unpacked Steam build.

## Distribution choice still open

LAN currently lets friends join without installing. Remote Steam clients need
a Steam-enabled build. Decide whether guests own the game or use a separately
distributed companion/friend-pass build before promising "one copy" online.
The current store promise applies only to LAN.

## Sources

- https://partner.steamgames.com/doc/features/multiplayer/networking
- https://partner.steamgames.com/doc/api/ISteamNetworkingMessages
- https://partner.steamgames.com/doc/features/multiplayer/matchmaking

Steamworks account/tax approval and publishing status cannot be verified from
this repository. App ID availability is not evidence that a build has passed QA.
