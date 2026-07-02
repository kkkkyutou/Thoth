import type { TuiInteractionAction } from "./interaction.js";

export interface TuiKeyLike {
  name?: string | null;
  ctrl?: boolean;
  shift?: boolean;
}

export type TuiKeyIntent =
  | { type: "action"; action: TuiInteractionAction }
  | { type: "refresh" }
  | { type: "registerWorkspace" }
  | { type: "exit" }
  | { type: "none" };

export function mapTuiKeyToIntent(key: TuiKeyLike): TuiKeyIntent {
  const name = key.name ?? "";
  if (key.ctrl && name.toLowerCase() === "c") {
    return { type: "exit" };
  }
  switch (name) {
    case "q":
      return { type: "exit" };
    case "tab":
      return { type: "action", action: { type: key.shift ? "focusPrevious" : "focusNext" } };
    case "down":
    case "right":
      return { type: "action", action: { type: "focusNext" } };
    case "up":
    case "left":
      return { type: "action", action: { type: "focusPrevious" } };
    case "return":
    case "enter":
    case "space":
      return { type: "action", action: { type: "openFocused" } };
    case "escape":
    case "backspace":
      return { type: "action", action: { type: "goBack" } };
    case "m":
      return { type: "action", action: { type: "cycleMode" } };
    case "c":
      return { type: "action", action: { type: "cycleClarify" } };
    case "l":
      return { type: "action", action: { type: "cycleLoop" } };
    case "p":
      return { type: "action", action: { type: "setRoute", route: "providers" } };
    case "d":
      return { type: "action", action: { type: "setRoute", route: "connections" } };
    case "w":
      return { type: "registerWorkspace" };
    case "r":
      return { type: "refresh" };
    default:
      return { type: "none" };
  }
}
