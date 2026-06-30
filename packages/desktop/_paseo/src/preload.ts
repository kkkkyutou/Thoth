import { contextBridge, ipcRenderer, webUtils } from "electron";

type EventHandler = (payload: unknown) => void;

contextBridge.exposeInMainWorld("thothDesktop", {
  platform: process.platform,
  invoke: (command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke("thoth:invoke", command, args),
  getPendingOpenProject: () =>
    ipcRenderer.invoke("thoth:get-pending-open-project") as Promise<string | null>,
  events: {
    on: (event: string, handler: EventHandler): Promise<() => void> => {
      const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
        handler(payload);
      };
      ipcRenderer.on(`thoth:event:${event}`, listener);
      return Promise.resolve(() => {
        ipcRenderer.removeListener(`thoth:event:${event}`, listener);
      });
    },
  },
  window: {
    openNew: (options?: { pendingOpenProjectPath?: string | null }) =>
      ipcRenderer.invoke("thoth:window:openNew", options),
    getCurrentWindow: () => ({
      toggleMaximize: () => ipcRenderer.invoke("thoth:window:toggleMaximize"),
      isFullscreen: () => ipcRenderer.invoke("thoth:window:isFullscreen"),
      updateWindowControls: (update: {
        height?: number;
        backgroundColor?: string;
        foregroundColor?: string;
      }) => ipcRenderer.invoke("thoth:window:updateWindowControls", update),
      onResized: (handler: EventHandler): (() => void) => {
        const listener = (_ipcEvent: Electron.IpcRendererEvent, payload: unknown) => {
          handler(payload);
        };
        ipcRenderer.on("thoth:window:resized", listener);
        return () => {
          ipcRenderer.removeListener("thoth:window:resized", listener);
        };
      },
      setBadgeCount: (count?: number) => ipcRenderer.invoke("thoth:window:setBadgeCount", count),
    }),
  },
  dialog: {
    ask: (message: string, options?: Record<string, unknown>) =>
      ipcRenderer.invoke("thoth:dialog:ask", message, options),
    askWithCheckbox: (message: string, options: Record<string, unknown>) =>
      ipcRenderer.invoke("thoth:dialog:askWithCheckbox", message, options),
    open: (options?: Record<string, unknown>) => ipcRenderer.invoke("thoth:dialog:open", options),
  },
  notification: {
    isSupported: () => ipcRenderer.invoke("thoth:notification:isSupported"),
    sendNotification: (payload: { title: string; body?: string; data?: Record<string, unknown> }) =>
      ipcRenderer.invoke("thoth:notification:send", payload),
  },
  opener: {
    openUrl: (url: string) => ipcRenderer.invoke("thoth:opener:openUrl", url),
  },
  editor: {
    listTargets: () => ipcRenderer.invoke("thoth:editor:listTargets"),
    openTarget: (input: {
      editorId: string;
      path: string;
      cwd?: string;
      mode?: "open" | "reveal";
    }) => ipcRenderer.invoke("thoth:editor:openTarget", input),
  },
  webUtils: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  menu: {
    showContextMenu: (input?: Record<string, unknown>) =>
      ipcRenderer.invoke("thoth:menu:showContextMenu", input),
  },
  browser: {
    setWorkspaceActiveBrowser: (browserId: string | null) =>
      ipcRenderer.invoke("thoth:browser:set-workspace-active-browser", browserId),
    openDevTools: (browserId: string) =>
      ipcRenderer.invoke("thoth:browser:open-devtools", browserId),
    clearPartition: (browserId: string) =>
      ipcRenderer.invoke("thoth:browser:clear-partition", browserId),
  },
});
