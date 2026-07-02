import { describe, expect, test } from "vitest";
import { getOpenTuiRendererRuntimeStatus } from "./runtime.js";

describe("getOpenTuiRendererRuntimeStatus", () => {
  test("keeps the locked Node 24 toolchain in non-rendering mode", () => {
    expect(
      getOpenTuiRendererRuntimeStatus({
        runtimeName: "node",
        nodeVersion: "24.14.0",
        execArgv: [],
      }),
    ).toMatchObject({
      available: false,
      runtime: "node",
      reason: "node_version_too_old",
      minimumNodeVersion: "26.3.0",
    });
  });

  test("requires the Node FFI flag even on a new enough Node runtime", () => {
    expect(
      getOpenTuiRendererRuntimeStatus({
        runtimeName: "node",
        nodeVersion: "26.3.0",
        execArgv: [],
      }),
    ).toMatchObject({
      available: false,
      reason: "node_ffi_flag_missing",
    });
  });

  test("allows Node renderer creation when version and FFI flag are both present", () => {
    expect(
      getOpenTuiRendererRuntimeStatus({
        runtimeName: "node",
        nodeVersion: "26.3.0",
        execArgv: ["--experimental-ffi"],
      }),
    ).toMatchObject({
      available: true,
      runtime: "node",
    });
  });

  test("allows Bun as the OpenTUI examples runtime without locking the project decision", () => {
    expect(
      getOpenTuiRendererRuntimeStatus({
        runtimeName: "node",
        nodeVersion: "24.14.0",
        bunVersion: "1.3.0",
        execArgv: [],
      }),
    ).toMatchObject({
      available: true,
      runtime: "bun",
    });
  });
});
