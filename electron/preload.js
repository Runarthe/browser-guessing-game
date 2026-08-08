"use strict";

/**
 * Bridge between the Electron main process and the game client.
 *
 * Deliberately tiny: the web client is unchanged and works in a normal browser,
 * so it must treat `window.miniMayhemDesktop` as optional. Its only job is to
 * let the host screen show the LAN address other players type into their phones.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("miniMayhemDesktop", {
  isDesktop: true,
  /** @returns {Promise<{port:number, localUrl:string, lanUrl:string|null}>} */
  getHostInfo: () => ipcRenderer.invoke("minimayhem:host-info")
});
