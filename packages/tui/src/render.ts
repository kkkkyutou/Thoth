import { Box, Text, type CliRenderer } from "@opentui/core";
import {
  applyTuiInteractionAction,
  buildTuiInteractionHints,
  clarifyLabel,
  createInitialTuiInteractionState,
  describeTuiFocusTarget,
  isLoopControlEnabled,
  loopLabel,
  modeLabel,
  type TuiComposerControlId,
  type TuiFocusTarget,
  type TuiInteractionState,
} from "./interaction.js";
import { mapTuiKeyToIntent, type TuiKeyLike } from "./keyboard.js";
import type { TuiBadgeTone, TuiNavItem, TuiStatusChip, TuiSurfaceModel } from "./surface.js";

export interface TuiSurfaceLine {
  text: string;
  tone: TuiBadgeTone | "title" | "muted";
}

export interface TuiRenderOptions {
  interaction?: TuiInteractionState;
}

export interface TuiSurfaceMount {
  getInteraction(): TuiInteractionState;
  getModel(): TuiSurfaceModel;
  update(interaction: TuiInteractionState): void;
  updateModel(model: TuiSurfaceModel, interaction?: TuiInteractionState): void;
  handleKey(key: TuiKeyLike): "handled" | "refresh" | "exit" | "ignored";
}

export function buildTuiSurfaceLines(
  model: TuiSurfaceModel,
  options: TuiRenderOptions = {},
): TuiSurfaceLine[] {
  const interaction = options.interaction ?? createInitialTuiInteractionState(model);
  const lines: TuiSurfaceLine[] = [
    {
      text: `${model.title} - ${model.renderer} ${model.layout.mode} surface`,
      tone: "title",
    },
    {
      text: `Route: ${routeLine(model, interaction)}`,
      tone: "title",
    },
    {
      text: `Focus: ${describeTuiFocusTarget(interaction.focus, model)}`,
      tone: "preview",
    },
    {
      text: `State: ${interaction.notice}`,
      tone: "preview",
    },
    {
      text: "Authority: daemon/client/protocol state only; no TUI-only task truth.",
      tone: "muted",
    },
    {
      text: `Workspace: ${model.activeWorkspace.label}`,
      tone: model.activeWorkspace.status === "ready" ? "ready" : "needs-action",
    },
    {
      text: `Path: ${model.activeWorkspace.cwd ?? "Connect a host or register this workspace"}`,
      tone: "muted",
    },
    ...formatRecoveryLines(model),
    blankLine(),
    { text: "Status", tone: "title" },
    ...model.statusChips.map(formatStatusChip),
    blankLine(),
    { text: "Navigation", tone: "title" },
    ...model.navigation.map((item) => formatNavigationItem(item, interaction)),
    blankLine(),
    { text: "Composer", tone: "title" },
    ...formatComposerControls(interaction),
    blankLine(),
    { text: "Interaction", tone: "title" },
    ...buildTuiInteractionHints(interaction, model).map((hint) => ({
      text: `- ${hint.label}: ${hint.value}`,
      tone: "preview" as const,
    })),
    blankLine(),
    { text: "Task Control Plane", tone: "title" },
    ...model.taskSlots.map((slot) => ({
      text: `${slot.title}: ${slot.value}`,
      tone: slot.tone,
    })),
    blankLine(),
    {
      text: "Authority: daemon/client/protocol state only; no TUI-only task truth.",
      tone: "muted",
    },
    {
      text: "Keys: Tab/arrows focus, Enter open, Esc back, R refresh, M/C/L controls, Q or Ctrl+C exit.",
      tone: "muted",
    },
  ];

  return lines;
}

export function mountTuiSurface(
  renderer: CliRenderer,
  model: TuiSurfaceModel,
  options: TuiRenderOptions = {},
): TuiSurfaceMount {
  let currentModel = model;
  let interaction = options.interaction ?? createInitialTuiInteractionState(model);
  renderer.root.add(
    Box(
      {
        id: "thoth-tui-root",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        backgroundColor: "#151310",
      },
      Text({
        id: "thoth-tui-frame",
        content: buildTuiSurfaceLines(currentModel, { interaction })
          .map((line) => line.text)
          .join("\n"),
        fg: colorForTone("muted"),
        selectable: true,
      }),
    ),
  );

  const frame = renderer.root.getRenderable("thoth-tui-frame") as
    | {
        content: string;
      }
    | undefined;

  function update(nextInteraction: TuiInteractionState): void {
    interaction = nextInteraction;
    if (frame) {
      frame.content = buildTuiSurfaceLines(currentModel, { interaction })
        .map((line) => line.text)
        .join("\n");
    }
    renderer.requestRender();
  }

  function updateModel(nextModel: TuiSurfaceModel, nextInteraction = interaction): void {
    currentModel = nextModel;
    update(nextInteraction);
  }

  return {
    getInteraction: () => interaction,
    getModel: () => currentModel,
    update,
    updateModel,
    handleKey: (key) => {
      const intent = mapTuiKeyToIntent(key);
      if (intent.type === "none") {
        return "ignored";
      }
      if (intent.type === "refresh") {
        return "refresh";
      }
      if (intent.type === "exit") {
        return "exit";
      }
      update(applyTuiInteractionAction(interaction, intent.action, currentModel));
      return "handled";
    },
  };
}

function formatRecoveryLines(model: TuiSurfaceModel): TuiSurfaceLine[] {
  const disconnected =
    model.statusChips.find((chip) => chip.label === "Host")?.tone === "unavailable";
  if (!disconnected && !model.refresh.error) {
    return [];
  }
  return [
    {
      text: `Refresh: ${model.refresh.value}`,
      tone: model.refresh.tone,
    },
    ...(model.refresh.error
      ? [
          {
            text: `Refresh error: ${model.refresh.error}`,
            tone: "needs-action" as const,
          },
        ]
      : []),
    {
      text: "Recovery: start Thoth daemon on 127.0.0.1:6688 or pair a fresh relay offer, then press R.",
      tone: "needs-action",
    },
  ];
}

function formatStatusChip(chip: TuiStatusChip): TuiSurfaceLine {
  return {
    text: `- ${chip.label}: ${chip.value}`,
    tone: chip.tone,
  };
}

function formatNavigationItem(item: TuiNavItem, interaction: TuiInteractionState): TuiSurfaceLine {
  const focused = isFocused(interaction.focus, { kind: "nav", route: item.id }) ? ">" : " ";
  const active = interaction.activeRoute === item.id ? "*" : " ";
  return {
    text: `${focused}${active} ${item.label}: ${item.badge} | ${item.description}`,
    tone: item.tone,
  };
}

function formatComposerControls(interaction: TuiInteractionState): TuiSurfaceLine[] {
  const controls: Array<{ id: TuiComposerControlId; label: string; value: string }> = [
    { id: "attach", label: "+", value: "Images/files <10MB" },
    { id: "provider", label: "Provider", value: "Select model first" },
    { id: "mode", label: "Mode", value: modeLabel(interaction.composer.mode) },
    { id: "clarify", label: "Clarify", value: clarifyLabel(interaction.composer.clarify) },
    {
      id: "loop",
      label: "Loop",
      value: isLoopControlEnabled(interaction)
        ? loopLabel(interaction.composer.loop)
        : "Off in Quick",
    },
  ];

  return [
    {
      text: "+ Images/files <10MB | Provider | Mode Quick/Loop | Clarify | Loop",
      tone: "preview",
    },
    ...controls.map((control): TuiSurfaceLine => {
      const focused = isFocused(interaction.focus, { kind: "composer-control", id: control.id })
        ? ">"
        : " ";
      return {
        text: `${focused} ${control.label}: ${control.value}`,
        tone:
          control.id === "loop" && !isLoopControlEnabled(interaction) ? "unavailable" : "preview",
      };
    }),
  ];
}

function routeLine(model: TuiSurfaceModel, interaction: TuiInteractionState): string {
  const activeItem = model.navigation.find((item) => item.id === interaction.activeRoute);
  if (!activeItem) {
    return interaction.activeRoute;
  }
  return `${activeItem.label} (${activeItem.badge})`;
}

function isFocused(focus: TuiFocusTarget, target: TuiFocusTarget): boolean {
  if (focus.kind !== target.kind) {
    return false;
  }
  if (focus.kind === "nav" && target.kind === "nav") {
    return focus.route === target.route;
  }
  if (focus.kind === "composer-control" && target.kind === "composer-control") {
    return focus.id === target.id;
  }
  return false;
}

function blankLine(): TuiSurfaceLine {
  return { text: "", tone: "muted" };
}

function colorForTone(tone: TuiSurfaceLine["tone"]): string {
  switch (tone) {
    case "title":
      return "#F6D36B";
    case "ready":
      return "#8FD694";
    case "needs-action":
      return "#F97068";
    case "preview":
      return "#9DD9D2";
    case "running":
      return "#F4A259";
    case "unavailable":
      return "#C8B6A6";
    case "muted":
      return "#B7B0A4";
  }
}
