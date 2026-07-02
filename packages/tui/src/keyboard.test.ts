import { describe, expect, test } from "vitest";
import { mapTuiKeyToIntent } from "./keyboard.js";

describe("mapTuiKeyToIntent", () => {
  test("maps navigation keys to focus actions", () => {
    expect(mapTuiKeyToIntent({ name: "tab" })).toEqual({
      type: "action",
      action: { type: "focusNext" },
    });
    expect(mapTuiKeyToIntent({ name: "tab", shift: true })).toEqual({
      type: "action",
      action: { type: "focusPrevious" },
    });
    expect(mapTuiKeyToIntent({ name: "up" })).toEqual({
      type: "action",
      action: { type: "focusPrevious" },
    });
  });

  test("maps enter escape and composer shortcuts", () => {
    expect(mapTuiKeyToIntent({ name: "return" })).toEqual({
      type: "action",
      action: { type: "openFocused" },
    });
    expect(mapTuiKeyToIntent({ name: "escape" })).toEqual({
      type: "action",
      action: { type: "goBack" },
    });
    expect(mapTuiKeyToIntent({ name: "m" })).toEqual({
      type: "action",
      action: { type: "cycleMode" },
    });
    expect(mapTuiKeyToIntent({ name: "c" })).toEqual({
      type: "action",
      action: { type: "cycleClarify" },
    });
    expect(mapTuiKeyToIntent({ name: "l" })).toEqual({
      type: "action",
      action: { type: "cycleLoop" },
    });
    expect(mapTuiKeyToIntent({ name: "p" })).toEqual({
      type: "providerSetup",
    });
    expect(mapTuiKeyToIntent({ name: "d" })).toEqual({
      type: "devicePairing",
    });
    expect(mapTuiKeyToIntent({ name: "w" })).toEqual({ type: "registerWorkspace" });
    expect(mapTuiKeyToIntent({ name: "r" })).toEqual({ type: "refresh" });
  });

  test("maps q and ctrl-c to exit", () => {
    expect(mapTuiKeyToIntent({ name: "q" })).toEqual({ type: "exit" });
    expect(mapTuiKeyToIntent({ name: "c", ctrl: true })).toEqual({ type: "exit" });
  });
});
