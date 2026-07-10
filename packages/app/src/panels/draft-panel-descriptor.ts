import type { ComponentType } from "react";
import { i18n } from "@/i18n/i18next";
import type { PanelDescriptor, PanelIconProps } from "@/panels/panel-registry";

export function buildDraftPanelDescriptor(input: {
  isCreating: boolean;
  pendingPrompt?: string | null;
  title?: string | null;
  icon: ComponentType<PanelIconProps>;
}): PanelDescriptor {
  const { icon, isCreating, pendingPrompt } = input;
  const newAgentLabel = i18n.t("panels.draft.newAgent");
  const creatingLabel = pendingPrompt?.trim() || newAgentLabel;
  const draftTitle = resolveDraftPanelTitle(input.title, newAgentLabel);
  if (isCreating) {
    return {
      label: creatingLabel,
      subtitle: i18n.t("panels.draft.creatingAgent"),
      titleState: "ready",
      icon,
      statusBucket: "running",
    };
  }

  return {
    label: draftTitle ?? newAgentLabel,
    subtitle: draftTitle ?? newAgentLabel,
    titleState: "ready",
    icon,
    statusBucket: null,
  };
}

function resolveDraftPanelTitle(title: string | null | undefined, newAgentLabel: string) {
  const normalized = title?.trim();
  if (!normalized) {
    return null;
  }
  if (normalized === newAgentLabel || normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}
