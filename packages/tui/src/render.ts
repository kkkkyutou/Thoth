import { Box, Text, type CliRenderer } from "@opentui/core";
import type { TuiBadgeTone, TuiNavItem, TuiStatusChip, TuiSurfaceModel } from "./surface.js";

export interface TuiSurfaceLine {
  text: string;
  tone: TuiBadgeTone | "title" | "muted";
}

export function buildTuiSurfaceLines(model: TuiSurfaceModel): TuiSurfaceLine[] {
  const lines: TuiSurfaceLine[] = [
    {
      text: `${model.title} - ${model.renderer} ${model.layout.mode} surface`,
      tone: "title",
    },
    {
      text: `Workspace: ${model.activeWorkspace.label}`,
      tone: model.activeWorkspace.status === "ready" ? "ready" : "needs-action",
    },
    {
      text: `Path: ${model.activeWorkspace.cwd ?? "Connect a host or register this workspace"}`,
      tone: "muted",
    },
    blankLine(),
    { text: "Status", tone: "title" },
    ...model.statusChips.map(formatStatusChip),
    blankLine(),
    { text: "Navigation", tone: "title" },
    ...model.navigation.map(formatNavigationItem),
    blankLine(),
    { text: "Composer", tone: "title" },
    {
      text: "+ Images/files <10MB | Provider | Mode Quick/Loop | Clarify | Loop",
      tone: "preview",
    },
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
      text: "Keys: Tab focus, Enter open, Esc back, Ctrl+C exit.",
      tone: "muted",
    },
  ];

  return lines;
}

export function mountTuiSurface(renderer: CliRenderer, model: TuiSurfaceModel): void {
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
        content: buildTuiSurfaceLines(model)
          .map((line) => line.text)
          .join("\n"),
        fg: colorForTone("muted"),
        selectable: true,
      }),
    ),
  );
}

function formatStatusChip(chip: TuiStatusChip): TuiSurfaceLine {
  return {
    text: `- ${chip.label}: ${chip.value}`,
    tone: chip.tone,
  };
}

function formatNavigationItem(item: TuiNavItem): TuiSurfaceLine {
  return {
    text: `- ${item.label}: ${item.badge} | ${item.description}`,
    tone: item.tone,
  };
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
