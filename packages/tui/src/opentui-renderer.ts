import type { CliRenderer, CliRendererConfig } from "@opentui/core";
import { getOpenTuiRendererRuntimeStatus } from "./runtime.js";

export interface NativeOpenTuiRendererOptions extends Omit<
  CliRendererConfig,
  "exitOnCtrlC" | "screenMode"
> {
  exitOnCtrlC?: boolean;
  screenMode?: CliRendererConfig["screenMode"];
}

export async function createNativeOpenTuiRenderer(
  options: NativeOpenTuiRendererOptions = {},
): Promise<CliRenderer> {
  const status = getOpenTuiRendererRuntimeStatus();
  if (!status.available) {
    throw new Error(status.detail);
  }

  const { createCliRenderer } = await import("@opentui/core");
  return createCliRenderer({
    exitOnCtrlC: true,
    screenMode: "alternate-screen",
    ...options,
  });
}
