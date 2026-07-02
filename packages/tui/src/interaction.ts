import type { TuiRouteId, TuiSurfaceModel } from "./surface.js";

export type TuiComposerMode = "quick" | "loop";
export type TuiClarifyLevel = "auto" | "dont-bother-me" | "light" | "balanced" | "deep";
export type TuiLoopLevel = "auto" | "one-plan-one-do" | "light" | "balanced" | "run-until-stopped";

export type TuiComposerControlId = "attach" | "provider" | "mode" | "clarify" | "loop";

export type TuiFocusTarget =
  | {
      kind: "nav";
      route: TuiRouteId;
    }
  | {
      kind: "composer-control";
      id: TuiComposerControlId;
    };

export type TuiInteractionAction =
  | { type: "focusNext" }
  | { type: "focusPrevious" }
  | { type: "openFocused" }
  | { type: "goBack" }
  | { type: "cycleMode" }
  | { type: "cycleClarify" }
  | { type: "cycleLoop" }
  | { type: "setRoute"; route: TuiRouteId };

export interface TuiInteractionState {
  activeRoute: TuiRouteId;
  focus: TuiFocusTarget;
  routeHistory: readonly TuiRouteId[];
  composer: {
    mode: TuiComposerMode;
    clarify: TuiClarifyLevel;
    loop: TuiLoopLevel;
  };
  notice: string;
}

export interface TuiInteractionHint {
  label: string;
  value: string;
}

const composerControls: readonly TuiComposerControlId[] = [
  "attach",
  "provider",
  "mode",
  "clarify",
  "loop",
];

const clarifyLevels: readonly TuiClarifyLevel[] = [
  "auto",
  "dont-bother-me",
  "light",
  "balanced",
  "deep",
];

const loopLevels: readonly TuiLoopLevel[] = [
  "auto",
  "one-plan-one-do",
  "light",
  "balanced",
  "run-until-stopped",
];

export function createInitialTuiInteractionState(model: TuiSurfaceModel): TuiInteractionState {
  return {
    activeRoute: model.activeRoute,
    focus: { kind: "nav", route: model.activeRoute },
    routeHistory: [],
    composer: {
      mode: "quick",
      clarify: "auto",
      loop: "auto",
    },
    notice: buildRouteNotice(model.activeRoute, model),
  };
}

export function buildTuiFocusOrder(model: TuiSurfaceModel): TuiFocusTarget[] {
  return [
    ...model.navigation.map((item) => ({ kind: "nav" as const, route: item.id })),
    ...composerControls.map((id) => ({ kind: "composer-control" as const, id })),
  ];
}

export function applyTuiInteractionAction(
  state: TuiInteractionState,
  action: TuiInteractionAction,
  model: TuiSurfaceModel,
): TuiInteractionState {
  switch (action.type) {
    case "focusNext":
      return moveFocus(state, model, 1);
    case "focusPrevious":
      return moveFocus(state, model, -1);
    case "openFocused":
      return openFocusedTarget(state, model);
    case "goBack":
      return goBack(state, model);
    case "cycleMode":
      return cycleMode(state);
    case "cycleClarify":
      return cycleClarify(state);
    case "cycleLoop":
      return cycleLoop(state);
    case "setRoute":
      return openRoute(state, action.route, model);
  }
}

export function buildTuiInteractionHints(
  state: TuiInteractionState,
  model: TuiSurfaceModel,
): TuiInteractionHint[] {
  return [
    { label: "Focus", value: describeTuiFocusTarget(state.focus, model) },
    { label: "Route", value: routeLabel(state.activeRoute, model) },
    { label: "Mode", value: modeLabel(state.composer.mode) },
    { label: "Clarify", value: clarifyLabel(state.composer.clarify) },
    {
      label: "Loop",
      value: isLoopControlEnabled(state) ? loopLabel(state.composer.loop) : "Off in Quick",
    },
    { label: "State", value: state.notice },
  ];
}

export function describeTuiFocusTarget(target: TuiFocusTarget, model: TuiSurfaceModel): string {
  if (target.kind === "nav") {
    return routeLabel(target.route, model);
  }
  switch (target.id) {
    case "attach":
      return "+ Images/files <10MB";
    case "provider":
      return "Provider";
    case "mode":
      return "Mode";
    case "clarify":
      return "Clarify";
    case "loop":
      return "Loop";
  }
}

export function routeLabel(route: TuiRouteId, model: TuiSurfaceModel): string {
  return model.navigation.find((item) => item.id === route)?.label ?? route;
}

export function modeLabel(mode: TuiComposerMode): string {
  switch (mode) {
    case "quick":
      return "Quick";
    case "loop":
      return "Loop";
  }
}

export function clarifyLabel(level: TuiClarifyLevel): string {
  switch (level) {
    case "auto":
      return "Auto";
    case "dont-bother-me":
      return "Don't Bother Me";
    case "light":
      return "Light";
    case "balanced":
      return "Balanced";
    case "deep":
      return "Dive Dive Dive";
  }
}

export function loopLabel(level: TuiLoopLevel): string {
  switch (level) {
    case "auto":
      return "Auto";
    case "one-plan-one-do":
      return "One Plan, One Do";
    case "light":
      return "Light";
    case "balanced":
      return "Balanced";
    case "run-until-stopped":
      return "Run Until Stopped";
  }
}

export function isLoopControlEnabled(state: TuiInteractionState): boolean {
  return state.composer.mode === "loop";
}

function moveFocus(
  state: TuiInteractionState,
  model: TuiSurfaceModel,
  direction: 1 | -1,
): TuiInteractionState {
  const focusOrder = buildTuiFocusOrder(model);
  const currentIndex = Math.max(
    0,
    focusOrder.findIndex((target) => focusTargetEquals(target, state.focus)),
  );
  const nextIndex = (currentIndex + direction + focusOrder.length) % focusOrder.length;
  const focus = focusOrder[nextIndex];
  return {
    ...state,
    focus,
    notice: `Focus ${describeTuiFocusTarget(focus, model)}`,
  };
}

function openFocusedTarget(
  state: TuiInteractionState,
  model: TuiSurfaceModel,
): TuiInteractionState {
  if (state.focus.kind === "nav") {
    return openRoute(state, state.focus.route, model);
  }
  switch (state.focus.id) {
    case "attach":
      return {
        ...state,
        notice: "Attachments are limited to images/files under 10MB",
      };
    case "provider":
      return openRoute(state, "providers", model);
    case "mode":
      return cycleMode(state);
    case "clarify":
      return cycleClarify(state);
    case "loop":
      return cycleLoop(state);
  }
}

function openRoute(
  state: TuiInteractionState,
  route: TuiRouteId,
  model: TuiSurfaceModel,
): TuiInteractionState {
  if (state.activeRoute === route) {
    return {
      ...state,
      notice: buildRouteNotice(route, model),
    };
  }
  return {
    ...state,
    activeRoute: route,
    routeHistory: [...state.routeHistory, state.activeRoute],
    notice: buildRouteNotice(route, model),
  };
}

function goBack(state: TuiInteractionState, model: TuiSurfaceModel): TuiInteractionState {
  const previousRoute = state.routeHistory[state.routeHistory.length - 1];
  if (!previousRoute) {
    return {
      ...state,
      activeRoute: model.activeRoute,
      focus: { kind: "nav", route: model.activeRoute },
      notice: `Back to ${routeLabel(model.activeRoute, model)}`,
    };
  }
  return {
    ...state,
    activeRoute: previousRoute,
    focus: { kind: "nav", route: previousRoute },
    routeHistory: state.routeHistory.slice(0, -1),
    notice: `Back to ${routeLabel(previousRoute, model)}`,
  };
}

function cycleMode(state: TuiInteractionState): TuiInteractionState {
  const mode: TuiComposerMode = state.composer.mode === "quick" ? "loop" : "quick";
  return {
    ...state,
    composer: {
      ...state.composer,
      mode,
    },
    notice: mode === "loop" ? "Loop mode prepares task control slots" : "Quick mode passes through",
  };
}

function cycleClarify(state: TuiInteractionState): TuiInteractionState {
  const clarify = nextValue(clarifyLevels, state.composer.clarify);
  return {
    ...state,
    composer: {
      ...state.composer,
      clarify,
    },
    notice: `Clarify ${clarifyLabel(clarify)}`,
  };
}

function cycleLoop(state: TuiInteractionState): TuiInteractionState {
  if (!isLoopControlEnabled(state)) {
    return {
      ...state,
      notice: "Loop control is disabled while Mode is Quick",
    };
  }
  const loop = nextValue(loopLevels, state.composer.loop);
  return {
    ...state,
    composer: {
      ...state.composer,
      loop,
    },
    notice: `Loop ${loopLabel(loop)}`,
  };
}

function buildRouteNotice(route: TuiRouteId, model: TuiSurfaceModel): string {
  switch (route) {
    case "home":
      return "One Thoth overview";
    case "workspace":
      return model.activeWorkspace.status === "ready"
        ? "Workspace control surface"
        : "Needs workspace registration";
    case "tasks":
      return "Task loop slots are preview-only";
    case "providers":
      return model.statusChips.find((chip) => chip.label === "Provider")?.value ?? "Provider state";
    case "connections":
      return model.statusChips.find((chip) => chip.label === "Relay")?.value ?? "Connection state";
    case "review":
      return "Evidence and review receipts are preview-only";
    case "settings":
      return "Settings and product identity preview";
  }
}

function focusTargetEquals(left: TuiFocusTarget, right: TuiFocusTarget): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "nav" && right.kind === "nav") {
    return left.route === right.route;
  }
  if (left.kind === "composer-control" && right.kind === "composer-control") {
    return left.id === right.id;
  }
  return false;
}

function nextValue<T>(values: readonly T[], current: T): T {
  const currentIndex = values.indexOf(current);
  return values[(currentIndex + 1) % values.length];
}
