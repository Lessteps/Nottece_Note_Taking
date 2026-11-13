import { app, BrowserWindow, globalShortcut, Menu, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerIpc } from "./ipc";
import { startReviewNotifier } from "./reviewNotifier";
import { getAppState, initRegistry, warmStudyIndex } from "../src/api/registry";

import fs from "node:fs";
import { AppConfig } from "../src/api/appConfig";
import { readGpuStatus } from "../src/api/gpuStatus";
import { browserManager } from "./browserManager";
import { getPreloadPath } from "./windowFactory";
import { installCrashLog, watchWindowHealth } from "./crashLog";
import { installZoom } from "./zoom";

// Allow HTML5 video and audio autoplay in embedded views
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// Configure GPU and rendering switches before app ready to maximize performance and respect settings
try {
  if (process.platform === "linux" && !app.commandLine.hasSwitch("ozone-platform") && !app.commandLine.hasSwitch("ozone-platform-hint")) {
    const isWayland = process.env.XDG_SESSION_TYPE === "wayland" || Boolean(process.env.WAYLAND_DISPLAY);
    if (isWayland) {
      app.commandLine.appendSwitch("ozone-platform-hint", "auto");
    } else {
      app.commandLine.appendSwitch("ozone-platform", "x11");
    }
  }
  const rendering = AppConfig.get_rendering();
  if (rendering.mode === "software") {
    app.disableHardwareAcceleration();
  } else {
    app.commandLine.appendSwitch("ignore-gpu-blocklist");
    app.commandLine.appendSwitch("enable-gpu-rasterization");
    if (process.platform !== "linux") {
      app.commandLine.appendSwitch("enable-zero-copy");
    } else {
      app.commandLine.appendSwitch("disable-features", "UseChromeOSDirectVideoDecoder");
    }
    if (rendering.angle !== "default") {
      app.commandLine.appendSwitch("use-angle", rendering.angle);
    }
    if (rendering.angle === "vulkan") {
      app.commandLine.appendSwitch("enable-features", "Vulkan");
    }
  }
} catch (e) {
  console.warn("Failed to apply rendering command-line switches:", e);
}

export async function gpuStatus() {
  return readGpuStatus();
}

// The bundle is loaded as an ES module, where __dirname is undefined.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;

import { FileWatcherService, type WatchEvent } from "../src/core/fileWatcher";
import { createVaultChangeNotifier } from "../src/core/vaultChange";
import { invalidateVaultCaches } from "../src/api/vaultInvalidate";
import { isOwnWriteEcho } from "../src/core/ownWrites";

let win: BrowserWindow | null = null;
let fileWatcher: FileWatcherService | null = null;

export function restartFileWatcher(root?: string) {
  if (fileWatcher) {
    fileWatcher.stop();
    fileWatcher = null;
  }
  const target = root ?? getAppState()?.root;
  if (target && fs.existsSync(target)) {
    // Cambios hechos fuera de la app (Antigravity, git…): una sola relectura por ráfaga y aviso a la interfaz para que los temas nuevos aparezcan solos
    const notify = createVaultChangeNotifier(() => {
      invalidateVaultCaches(target);
      if (win && !win.isDestroyed()) win.webContents.send("vault-content-changed");
    });
    fileWatcher = new FileWatcherService(target, (event: WatchEvent) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("vault-watch-event", event);
      }
      // el eco del autoguardado de una nota que se está editando no es un cambio de fuera: no invalida índices ni manda releer planes y temas
      if (event.eventType === "change" && isOwnWriteEcho(event.fullPath)) return;
      notify(event.relPath);
    });
    fileWatcher.start();
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#191919",
    autoHideMenuBar: true,
    // The app draws its own title bar: one row with the tab strip, the sync
    // status and the window controls. Without `frame: false` Windows puts its
    // own title bar above that one and the interface loses the space.
    frame: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  win.on("maximize", () => win?.webContents.send("nv-window-state", { maximized: true }));
  win.on("unmaximize", () => win?.webContents.send("nv-window-state", { maximized: false }));
  const state = getAppState();
  if (state) state.window = win;
  browserManager.setWindow(win);
  // El <webview> es contenido de terceros: nunca con Node, sin preload propio y solo con la partición del navegador de la app (y solo orígenes web)
  win.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
    delete (webPreferences as { preload?: string }).preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    // En vez de impedir que se acople (eso deja el navegador en negro), se corrige: siempre la partición de la app y solo orígenes web
    params.partition = "persist:nvweb";
    if (params.src && !/^(?:https?:|about:blank|data:text\/html)/i.test(params.src)) params.src = "about:blank";
  });
  win.webContents.on("did-attach-webview", (_event, guestContents) => {
    browserManager.attachGuest(guestContents);
  });
  watchWindowHealth(win);
  installZoom(win);
  restartFileWatcher();
  // The window must never navigate away; external links open in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    const base = DEV_URL ?? "file://";
    if (!url.startsWith(base)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });
  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, "../dist/index.html"));
}

installCrashLog();

// One instance per profile. A second one shares the same storage (LevelDB lock, config), so
// Chromium made it wait ~6 s on its first localStorage read (measured: 170 ms alone, 6 090 ms
// with another instance open) and both could write the same files. Opening the app again just
// brings the existing window to the front. Isolated test runs (NV_E2E_HOME) skip the lock.
const gotInstanceLock = Boolean(process.env.NV_E2E_HOME) || app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
}

app.whenReady().then(() => {
  if (!gotInstanceLock) return;
  // The app has its own custom top bar; drop Electron's native File/Edit/View menu.
  Menu.setApplicationMenu(null);
  initRegistry();
  registerIpc();
  createWindow();
  startReviewNotifier();
  // Works from any app, so a shot can be taken of whatever is in front.
  globalShortcut.register("CommandOrControl+Alt+S", () => {
    if (win && !win.isDestroyed()) win.webContents.send("nv-capture-request");
  });
  // The first study view of a cold process used to wait ~30 s for the whole vault
  // to be read (measured over 2 107 notes). Warming it here, in the background and
  // in batches, takes that off the click; nothing is waiting for the result.
  setTimeout(() => {
    void warmStudyIndex()
      .then((r) => console.log(`study index warm: ${r.notes} notes in ${r.ms} ms`))
      .catch((e) => console.warn("study index warm failed:", e));
  }, 300);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("before-quit", () => {
  browserManager.destroy();
  fileWatcher?.stop();
});
