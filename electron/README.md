# Confetti — desktop build

Wraps the existing Node game server in an Electron window so the game ships as a
normal Windows application instead of something you start from a terminal.

Nothing here touches game logic. `npm start` behaves exactly as it always has.

## How it works

1. `electron/main.js` requires `../server.js` and calls `start({ port: 0 })`.
   Port `0` asks the OS for a free port — hardcoding 3000 breaks on machines
   that already use it, which is common.
2. It waits for the server to be listening, then opens a `BrowserWindow` at the
   resolved URL.
3. The server binds `0.0.0.0`, so other devices on the same wifi can join using
   the LAN URL. `electron/preload.js` exposes that to the client as
   `window.confettiDesktop.getHostInfo()`.

## Commands

```bash
npm install              # first time only — pulls electron + electron-builder
npm run desktop          # run the desktop app against your working tree
npm run desktop:dir      # build an unpacked app into dist/  (use this for Steam)
npm run desktop:installer  # build an NSIS installer into dist/
```

`npm start`, `npm run dev` and `npm test` are unchanged.

## Notes

- **`asar` is off** on purpose. Express serves `public/` off disk, and asar
  archives make static file serving fussy for no real benefit here — Steam ships
  loose files routinely.
- **Steam wants the unpacked build**, not the installer. Point the Steam content
  builder at `dist/win-unpacked/`.
- **Windows Firewall** will prompt on first launch because the server binds
  `0.0.0.0`. Allowing it on private networks is what enables phones to join.
  Worth explaining in-app before it appears.
- **`package.json` `main`** points at `electron/main.js` because that is Electron's
  entry point. `npm start` runs `node server.js` explicitly, so it is unaffected.

## Join screen

`public/desktopHost.js` injects a panel into the lobby showing the address other
devices should open, plus a scannable QR code. It is deliberately standalone —
it builds its own markup and inline styles and never touches `app.js`.

It resolves the address two ways:

- **Desktop build** — asks the preload bridge for the real LAN URL.
- **Plain browser** — falls back to the page origin, which is already correct
  whenever you opened the game over the network.

On localhost with no LAN address it shows nothing, because there would be
nothing useful to share.

`public/qrLite.js` is a dependency-free QR encoder (byte mode, EC level M,
versions 1-10). A CDN library was not an option: the desktop build has to work
with no internet. It is covered by `tests/qrLite.test.js`, which decodes the
symbol back and validates the Reed-Solomon bytes against a published test
vector — worth keeping, since a subtly wrong encoder still round-trips its own
data while producing codes no real scanner will accept.

## Icon

`build/icon.ico` carries 16/24/32/48/64/128/256px frames. The confetti detail is
dropped below 48px on purpose; at 16px it turns to mud and hurts legibility.
Regenerate with `outputs/makeicon.py` if the palette changes.

## Not done yet

- Code signing. Unsigned builds trigger SmartScreen warnings on first run, and
  this is the main remaining blocker for handing the installer to strangers.
- Auto-update. Not needed if you ship through Steam, which patches for you.
- macOS/Linux packaging. The icon PNGs exist; the targets are not configured.
