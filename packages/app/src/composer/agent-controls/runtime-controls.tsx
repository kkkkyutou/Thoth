import { forwardRef, memo, useCallback, useMemo, type ReactElement } from "react";
import {
  Text,
  type PressableStateCallbackType,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { GitBranch, SearchCheck } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useToast } from "@/contexts/toast-context";
import { toErrorMessage } from "@/utils/error-messages";
import type {
  ThothRuntimeClarifyStrength,
  ThothRuntimeMode,
} from "@thoth/protocol/thoth-runtime-contract";

type ClarifyStrength = Exclude<ThothRuntimeClarifyStrength, "deep">;

const CLARIFY_OPTIONS: Array<{ id: ClarifyStrength; label: string }> = [
  { id: "none", label: "Direct" },
  { id: "light", label: "Light" },
  { id: "balanced", label: "Balanced" },
  { id: "dive", label: "Dive" },
  { id: "auto", label: "Auto" },
];

const MODE_OPTIONS: Array<{ id: ThothRuntimeMode; label: string }> = [
  { id: "quick", label: "Quick" },
  { id: "loop", label: "Loop" },
];

interface RuntimeControlsProps {
  serverId: string | null;
  disabled?: boolean;
}

function getClarifyLabel(value: ClarifyStrength): string {
  return CLARIFY_OPTIONS.find((option) => option.id === value)?.label ?? "Balanced";
}

function getModeLabel(value: ThothRuntimeMode): string {
  return MODE_OPTIONS.find((option) => option.id === value)?.label ?? "Quick";
}

function makeChipStyle(
  disabled: boolean,
  open: boolean,
): (state: PressableStateCallbackType) => StyleProp<ViewStyle> {
  return ({ pressed, hovered }) => [
    styles.chip,
    hovered && styles.chipHovered,
    (pressed || open) && styles.chipPressed,
    disabled && styles.chipDisabled,
  ];
}

export const RuntimeControls = memo(function RuntimeControls({
  serverId,
  disabled = false,
}: RuntimeControlsProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const toast = useToast();
  const { config, patchConfig } = useDaemonConfig(serverId);

  const clarify = (config?.workspaceSecretary?.clarifyStrength ?? "balanced") as ClarifyStrength;
  const mode = (config?.workspaceSecretary?.mode ?? "quick") as ThothRuntimeMode;
  const controlDisabled = disabled || !serverId;

  const persistClarify = useCallback(
    async (clarifyStrength: ClarifyStrength) => {
      try {
        await patchConfig({ workspaceSecretary: { clarifyStrength } });
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    },
    [patchConfig, toast],
  );

  const persistMode = useCallback(
    async (nextMode: ThothRuntimeMode) => {
      try {
        await patchConfig({ workspaceSecretary: { mode: nextMode } });
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    },
    [patchConfig, toast],
  );

  const clarifyLabel = getClarifyLabel(clarify);
  const modeLabel = getModeLabel(mode);

  const clarifyTrigger = useMemo(
    () => (
      <RuntimeControlTrigger
        icon={<SearchCheck size={theme.iconSize.md} color={theme.colors.foregroundMuted} />}
        prefix="Clarify"
        label={clarifyLabel}
        disabled={controlDisabled}
        accessibilityLabel={t("agentControls.runtime.clarify.selectWithValue", {
          value: clarifyLabel,
        })}
        testID="thoth-clarify-control"
      />
    ),
    [clarifyLabel, controlDisabled, t, theme.colors.foregroundMuted, theme.iconSize.md],
  );

  const modeTrigger = useMemo(
    () => (
      <RuntimeControlTrigger
        icon={<GitBranch size={theme.iconSize.md} color={theme.colors.foregroundMuted} />}
        prefix="Mode"
        label={modeLabel}
        disabled={controlDisabled}
        accessibilityLabel={t("agentControls.runtime.mode.selectWithValue", { value: modeLabel })}
        testID="thoth-mode-control"
      />
    ),
    [controlDisabled, modeLabel, t, theme.colors.foregroundMuted, theme.iconSize.md],
  );

  return (
    <>
      <RuntimeControlMenu
        trigger={modeTrigger}
        tooltip={t("agentControls.runtime.mode.tooltip")}
        options={MODE_OPTIONS}
        selected={mode}
        disabled={controlDisabled}
        onSelect={persistMode}
        testID="thoth-mode-menu"
      />
      <RuntimeControlMenu
        trigger={clarifyTrigger}
        tooltip={t("agentControls.runtime.clarify.tooltip")}
        options={CLARIFY_OPTIONS}
        selected={clarify}
        disabled={controlDisabled}
        onSelect={persistClarify}
        testID="thoth-clarify-menu"
      />
    </>
  );
});

const RuntimeControlTrigger = forwardRef<
  View,
  {
    icon: ReactElement;
    prefix: string;
    label: string;
    disabled: boolean;
    accessibilityLabel: string;
    testID: string;
  }
>(function RuntimeControlTrigger(
  { icon, prefix, label, disabled, accessibilityLabel, testID },
  ref,
) {
  return (
    <DropdownTrigger
      ref={ref}
      disabled={disabled}
      style={makeChipStyle(disabled, false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {icon}
      <Text style={styles.chipPrefix}>{prefix}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </DropdownTrigger>
  );
});

function RuntimeControlMenu<T extends string>({
  trigger,
  tooltip,
  options,
  selected,
  disabled,
  onSelect,
  testID,
}: {
  trigger: ReactElement;
  tooltip: string;
  options: Array<{ id: T; label: string }>;
  selected: T;
  disabled: boolean;
  onSelect: (value: T) => void | Promise<void>;
  testID: string;
}) {
  const handleSelect = useCallback(
    (id: T) => {
      if (disabled || id === selected) return;
      void onSelect(id);
    },
    [disabled, onSelect, selected],
  );

  return (
    <DropdownMenu>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          {trigger}
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{tooltip}</Text>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="start" width={180} testID={testID}>
        {options.map((option) => (
          <DropdownMenuItem
            key={option.id}
            selected={option.id === selected}
            onSelect={() => handleSelect(option.id)}
            disabled={disabled}
            testID={`${testID}-${option.id}`}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "transparent",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius["2xl"],
  },
  chipHovered: {
    backgroundColor: theme.colors.surface2,
  },
  chipPressed: {
    backgroundColor: theme.colors.surface0,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
  chipPrefix: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
}));
