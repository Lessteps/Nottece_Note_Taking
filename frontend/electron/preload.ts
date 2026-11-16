import { contextBridge, ipcRenderer } from "electron";

// The ONLY thing exposed to the renderer. Mirrors window.pywebview.api's shape.
contextBridge.exposeInMainWorld("nv", {
  invoke: (method: string, args: unknown[]) => ipcRenderer.invoke("nv", method, args),
  setInteractiveRouteActive: (active: boolean) => ipcRenderer.send("nv-interactive-route-active", active),
  onInteractiveRouteZoom: (cb: (action: "in" | "out") => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: "in" | "out") => cb(action);
    ipcRenderer.on("nv-interactive-route-zoom", handler);
    return () => ipcRenderer.removeListener("nv-interactive-route-zoom", handler);
  },
  onWatchEvent: (cb: (data: { eventType: string; relPath: string; fullPath: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on("vault-watch-event", handler);
    return () => {
      ipcRenderer.removeListener("vault-watch-event", handler);
    };
  },
  /** The vault content changed outside the app (an agent, git…): caches were already cleared in the main process. */
  onVaultContentChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("vault-content-changed", handler);
    return () => {
      ipcRenderer.removeListener("vault-content-changed", handler);
    };
  },
  onBrowserState: (cb: (data: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on("nv-browser-state", handler);
    return () => {
      ipcRenderer.removeListener("nv-browser-state", handler);
    };
  },
  /** A review notification was clicked: open the Repaso calendar (channel: nv-open-review). */
  onOpenReview: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("nv-open-review", handler);
    return () => {
      ipcRenderer.removeListener("nv-open-review", handler);
    };
  },
  /** The capture shortcut was pressed (channel: nv-capture-request). */
  onCaptureRequest: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("nv-capture-request", handler);
    return () => {
      ipcRenderer.removeListener("nv-capture-request", handler);
    };
  },
  /** A screenshot was saved (channel: nv-capture-done). */
  onCaptureDone: (cb: (data: { rel: string; name: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on("nv-capture-done", handler);
    return () => {
      ipcRenderer.removeListener("nv-capture-done", handler);
    };
  },
  onWindowState: (cb: (data: { maximized: boolean }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { maximized: boolean }) => cb(data);
    ipcRenderer.on("nv-window-state", handler);
    return () => {
      ipcRenderer.removeListener("nv-window-state", handler);
    };
  },
  /** Tokens of a streamed AI answer (channel: nv-ai-stream). */
  onAiStream: (
    cb: (data: {
      id: string;
      type: "start" | "delta" | "thinking" | "done" | "error";
      text?: string;
      message?: string;
      stopped?: boolean;
    }) => void,
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, data: any) => cb(data);
    ipcRenderer.on("nv-ai-stream", handler);
    return () => {
      ipcRenderer.removeListener("nv-ai-stream", handler);
    };
  },
});
