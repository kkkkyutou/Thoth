import { webContents as allWebContents, type WebContents } from "electron";
import {
  BROWSER_NEW_TAB_REQUEST_EVENT,
  handleBrowserWindowOpenRequest,
  isAllowedBrowserWebviewUrl,
} from "./window-open.js";

export { BROWSER_NEW_TAB_REQUEST_EVENT, handleBrowserWindowOpenRequest };

const browserIdsByWebContentsId = new Map<number, string>();
let workspaceActiveBrowserId: string | null = null;

function getBrowserIdFromWebviewPartition(partition: string | undefined): string | null {
  const prefix = "persist:thoth-browser-";
  if (!partition?.startsWith(prefix)) {
    return null;
  }
  const browserId = partition.slice(prefix.length).trim();
  return browserId.length > 0 ? browserId : null;
}

export function readBrowserIdFromWebviewAttach(input: {
  src?: string;
  partition?: string;
}): string | null {
  if (!isAllowedBrowserWebviewUrl(input.src)) {
    return null;
  }
  return getBrowserIdFromWebviewPartition(input.partition);
}

export function listRegisteredThothBrowserIds(): string[] {
  return Array.from(new Set(browserIdsByWebContentsId.values())).sort();
}

export function registerThothBrowserWebContents(contents: WebContents, browserId: string): void {
  browserIdsByWebContentsId.set(contents.id, browserId);
  contents.once("destroyed", () => {
    browserIdsByWebContentsId.delete(contents.id);
    if (workspaceActiveBrowserId === browserId) {
      workspaceActiveBrowserId = null;
    }
  });
}

export function getThothBrowserIdForWebContents(contents: WebContents | null): string | null {
  if (!contents || contents.isDestroyed()) {
    return null;
  }
  return browserIdsByWebContentsId.get(contents.id) ?? null;
}

export function setWorkspaceActiveThothBrowserId(browserId: string | null): void {
  workspaceActiveBrowserId = browserId;
}

export function getThothBrowserWebContents(browserId: string): WebContents | null {
  for (const [contentsId, registeredBrowserId] of browserIdsByWebContentsId) {
    if (registeredBrowserId !== browserId) continue;
    const contents = allWebContents.fromId(contentsId);
    if (contents && !contents.isDestroyed()) {
      return contents;
    }
  }
  return null;
}

export function getWorkspaceActiveThothBrowserWebContents(): WebContents | null {
  if (!workspaceActiveBrowserId) {
    return null;
  }
  return getThothBrowserWebContents(workspaceActiveBrowserId);
}

function preventUnsafeBrowserWebviewNavigation(
  event: { preventDefault: () => void },
  url: string | undefined,
): void {
  if (!isAllowedBrowserWebviewUrl(url)) {
    event.preventDefault();
  }
}

export function registerBrowserWebviewNavigationGuards(contents: WebContents): void {
  contents.on("will-navigate", (event) => {
    preventUnsafeBrowserWebviewNavigation(event, event.url);
  });
  contents.on("will-frame-navigate", (event) => {
    preventUnsafeBrowserWebviewNavigation(event, event.url);
  });
  contents.on("will-redirect", (event) => {
    preventUnsafeBrowserWebviewNavigation(event, event.url);
  });
}
