import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { acquirePidLock, getPidLockInfo, releasePidLock, updatePidLock } from "./pid-lock.js";

describe("pid-lock ownership", () => {
  test("writes and releases lock for explicit owner pid", async () => {
    const thothHome = await mkdtemp(join(tmpdir(), "thoth-pid-lock-owner-"));
    const ownerPid = process.pid + 10_000;

    try {
      await (
        acquirePidLock as unknown as (
          home: string,
          sockPath: string | null,
          options: { ownerPid: number },
        ) => Promise<void>
      )(thothHome, null, { ownerPid });

      const lock = await getPidLockInfo(thothHome);
      expect(lock?.pid).toBe(ownerPid);
      expect(lock?.listen).toBeNull();

      await (
        updatePidLock as unknown as (
          home: string,
          patch: { listen: string },
          options: { ownerPid: number },
        ) => Promise<void>
      )(thothHome, { listen: "127.0.0.1:6767" }, { ownerPid });

      const updatedLock = await getPidLockInfo(thothHome);
      expect(updatedLock?.listen).toBe("127.0.0.1:6767");

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(thothHome, { ownerPid: ownerPid + 1 });
      const lockAfterWrongOwnerRelease = await getPidLockInfo(thothHome);
      expect(lockAfterWrongOwnerRelease?.pid).toBe(ownerPid);

      await (
        releasePidLock as unknown as (home: string, options: { ownerPid: number }) => Promise<void>
      )(thothHome, { ownerPid });
      const lockAfterOwnerRelease = await getPidLockInfo(thothHome);
      expect(lockAfterOwnerRelease).toBeNull();
    } finally {
      await rm(thothHome, { recursive: true, force: true });
    }
  });
});
