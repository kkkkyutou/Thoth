import { describe, expect, test } from "vitest";
import {
  applyTuiInteractionAction,
  buildTuiFocusOrder,
  buildTuiInteractionHints,
  createInitialTuiInteractionState,
} from "./interaction.js";
import { buildTuiSurfaceModel, type TuiSurfaceInput } from "./surface.js";

function model(input: Partial<TuiSurfaceInput> = {}) {
  return buildTuiSurfaceModel({
    connection: { status: "idle" },
    terminalWidth: 100,
    terminalHeight: 32,
    ...input,
  });
}

describe("TUI interaction state", () => {
  test("starts on the surface route and uses nav focus first", () => {
    const surface = model();
    const state = createInitialTuiInteractionState(surface);

    expect(state.activeRoute).toBe("home");
    expect(state.focus).toEqual({ kind: "nav", route: "home" });
    expect(buildTuiFocusOrder(surface)).toEqual(
      expect.arrayContaining([
        { kind: "nav", route: "providers" },
        { kind: "composer-control", id: "provider" },
        { kind: "composer-control", id: "loop" },
      ]),
    );
  });

  test("cycles focus through navigation and composer controls", () => {
    const surface = model();
    let state = createInitialTuiInteractionState(surface);

    state = applyTuiInteractionAction(state, { type: "focusPrevious" }, surface);
    expect(state.focus).toEqual({ kind: "composer-control", id: "loop" });

    state = applyTuiInteractionAction(state, { type: "focusNext" }, surface);
    expect(state.focus).toEqual({ kind: "nav", route: "home" });

    for (let index = 0; index < surface.navigation.length; index += 1) {
      state = applyTuiInteractionAction(state, { type: "focusNext" }, surface);
    }
    expect(state.focus).toEqual({ kind: "composer-control", id: "attach" });
  });

  test("opens focused routes and can return through route history", () => {
    const surface = model();
    let state = createInitialTuiInteractionState(surface);

    state = applyTuiInteractionAction(state, { type: "setRoute", route: "providers" }, surface);
    expect(state.activeRoute).toBe("providers");
    expect(state.notice).toBe("Select model first");

    state = applyTuiInteractionAction(state, { type: "setRoute", route: "connections" }, surface);
    expect(state.activeRoute).toBe("connections");
    expect(state.notice).toBe("Fresh pairing supported");

    state = applyTuiInteractionAction(state, { type: "goBack" }, surface);
    expect(state.activeRoute).toBe("providers");
    expect(state.focus).toEqual({ kind: "nav", route: "providers" });

    state = applyTuiInteractionAction(state, { type: "goBack" }, surface);
    expect(state.activeRoute).toBe("home");
  });

  test("provider composer control opens the provider route without fake backend state", () => {
    const surface = model();
    let state = createInitialTuiInteractionState(surface);

    state = {
      ...state,
      focus: { kind: "composer-control", id: "provider" },
    };
    state = applyTuiInteractionAction(state, { type: "openFocused" }, surface);

    expect(state.activeRoute).toBe("providers");
    expect(state.notice).toBe("Select model first");
  });

  test("keeps loop disabled in Quick mode and enabled after explicit Loop mode", () => {
    const surface = model();
    let state = createInitialTuiInteractionState(surface);

    state = applyTuiInteractionAction(state, { type: "cycleLoop" }, surface);
    expect(state.composer.mode).toBe("quick");
    expect(state.composer.loop).toBe("auto");
    expect(state.notice).toBe("Loop control is disabled while Mode is Quick");
    expect(buildTuiInteractionHints(state, surface)).toContainEqual({
      label: "Loop",
      value: "Off in Quick",
    });

    state = applyTuiInteractionAction(state, { type: "cycleMode" }, surface);
    state = applyTuiInteractionAction(state, { type: "cycleLoop" }, surface);
    expect(state.composer.mode).toBe("loop");
    expect(state.composer.loop).toBe("one-plan-one-do");
    expect(buildTuiInteractionHints(state, surface)).toContainEqual({
      label: "Loop",
      value: "One Plan, One Do",
    });
  });

  test("cycles clarify labels through user-facing levels", () => {
    const surface = model();
    let state = createInitialTuiInteractionState(surface);

    state = applyTuiInteractionAction(state, { type: "cycleClarify" }, surface);
    expect(buildTuiInteractionHints(state, surface)).toContainEqual({
      label: "Clarify",
      value: "Don't Bother Me",
    });

    state = applyTuiInteractionAction(state, { type: "cycleClarify" }, surface);
    expect(buildTuiInteractionHints(state, surface)).toContainEqual({
      label: "Clarify",
      value: "Light",
    });
  });
});
