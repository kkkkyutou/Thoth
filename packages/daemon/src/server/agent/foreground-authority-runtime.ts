import path from "node:path";
import type { Logger } from "pino";
import { ForegroundAuthorityStore } from "./foreground-authority-store.js";

const stores = new Map<string, ForegroundAuthorityStore>();

export function getForegroundAuthorityStore(input: {
  thothHome: string;
  logger: Logger;
}): ForegroundAuthorityStore {
  const key = path.resolve(input.thothHome);
  const existing = stores.get(key);
  if (existing) {
    return existing;
  }
  const store = new ForegroundAuthorityStore({
    thothHome: key,
    logger: input.logger.child({ module: "foreground-authority-store" }),
  });
  stores.set(key, store);
  return store;
}

export function closeForegroundAuthorityStore(thothHome: string): void {
  const key = path.resolve(thothHome);
  stores.get(key)?.close();
  stores.delete(key);
}

export function resetForegroundAuthorityStoresForTest(): void {
  for (const store of stores.values()) {
    store.close();
  }
  stores.clear();
}
