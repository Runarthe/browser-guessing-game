"use strict";

/**
 * Electron entry point for the Confetti desktop build.
 *
 * The desktop app is a thin shell around the existing Node game server:
 *   1. start the server in-process on an OS-assigned free port,
 *   2. open a window pointed at it,
 *   3. surface the LAN URL so phones on the same wifi can join.
 *
 * No game logic lives here. `npm start` still runs the plain server exactly as
 * it always has — this file is additive.
 */

const path = require("path");
const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");

const ROOT = path.join(__dirname, "..");

let mainWindow = null;
let serverInfo = null;
let gameServer = null;

// A single instance owns the port; a second launch just focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

async function startGameServer() {
  gameServer = require(path.join(ROOT, "server.js"));
  // Default to port 0 (OS picks a free one) because hardcoding 3000 fails on
  // any machine already using it. An explicit PORT wins, which makes the app
  // tunnelable with ngrok/Tailscale:  $env:PORT=3000; npm run desktop
  const port = Number(process.env.PORT) || 0;
  return gameServer.start({ port });
}

function createWindow(info) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#0f1226",
    show: false,
    autoHideMenuBar: true,
    title: "Confetti",
    // Packaged builds take the icon from the exe; this is for `npm run desktop`.
    icon: path.join(ROOT, "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Avoid a white flash before the canvas paints.
  mainWindow.once("ready-to-show", () => mainWindow.show());

  // Anything that wants a new window (external links) opens in the real browser
  // rather than an unchromed Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(info.localUrl);
}

// The renderer asks for the join address to show hosts where phones connect.
ipcMain.handle("confetti:host-info", () => serverInfo);

// Exit from the start menu. The renderer has already confirmed with the user.
ipcMain.on("confetti:quit", () => app.quit());

app.whenReady().then(async () => {
  try {
    serverInfo = await startGameServer();
  } catch (err) {
    dialog.showErrorBox(
      "Confetti could not start",
      `The game server failed to start.\n\n${err && err.message ? err.message : err}`
    );
    app.quit();
    return;
  }
  createWindow(serverInfo);

  // macOS: re-open a window when the dock icon is clicked.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverInfo) createWindow(serverInfo);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Close the HTTP/socket server before exiting so the port is released cleanly.
app.on("before-quit", async (event) => {
  if (!gameServer || gameServer.__stopping) return;
  gameServer.__stopping = true;
  event.preventDefault();
  try { await gameServer.stop(); } catch { /* shutting down anyway */ }
  app.exit(0);
});
