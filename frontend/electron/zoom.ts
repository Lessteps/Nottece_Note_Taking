// Interface zoom: Ctrl + «+» zooms in, Ctrl + «-» zooms out, Ctrl + 0 goes back to 100 %.
//
// The native application menu is removed (see main.ts), and with it Chromium's default zoom
// accelerators, so the shortcuts are handled here, on the window's input events. The level is
// remembered across restarts and shared by every window.

import { app, ipcMain, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { nextZoom, zoomActionFor, ZOOM_MAX, ZOOM_MIN, type ZoomAction } from "../src/core/zoomLevel.js";
import { browserManager } from "./browserManager.js";

const file = (): string => path.join(app.getPath("userData"), "zoom.json");

function readLevel(): number {
  try {
    const n = Number((JSON.parse(fs.readFileSync(file(), "utf8")) as { level?: unknown }).level);
    return Number.isFinite(n) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) : 0;
  } catch {
    return 0;
  }
}

function writeLevel(level: number): void {
  try {
    fs.writeFileSync(file(), JSON.stringify({ level }));
  } catch {
    /* the zoom still applies for this session */
  }
}

let current: number | null = null;
const windows = new Set<BrowserWindow>();
const canvasZoomTargets = new WeakSet<Electron.WebContents>();
ipcMain.on("nv-interactive-route-active", (event, active: unknown) => {
  if (active === true) canvasZoomTargets.add(event.sender);
  else canvasZoomTargets.delete(event.sender);
});

export function getCurrentZoomLevel(): number {
  current ??= readLevel();
  return current;
}

export function applyZoomAction(action: ZoomAction): void {
  current = nextZoom(current ?? 0, action);
  writeLevel(current);
  for (const w of windows) if (!w.isDestroyed()) w.webContents.setZoomLevel(current);
  browserManager.syncZoom(current);
}

/** Makes `win` follow the zoom shortcuts and start at the remembered level. */
export function installZoom(win: BrowserWindow): void {
  current ??= readLevel();
  windows.add(win);
  win.on("closed", () => windows.delete(win));
  const apply = (): void => {
    if (!win.isDestroyed()) {
      win.webContents.setZoomLevel(current ?? 0);
      browserManager.syncZoom(current ?? 0);
    }
  };
  win.webContents.on("did-finish-load", apply);
  win.webContents.on("before-input-event", (event, input) => {
    const action = zoomActionFor(input);
    if (!action) return;
    event.preventDefault();
    if (canvasZoomTargets.has(win.webContents) && action !== "reset") {
      win.webContents.send("nv-interactive-route-zoom", action);
      return;
    }
    applyZoomAction(action);
  });
}
