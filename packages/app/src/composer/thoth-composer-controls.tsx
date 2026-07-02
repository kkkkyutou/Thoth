import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  ThothInventoryIcon,
  type ThothInventoryIconName,
} from "@/components/icons/thoth-inventory-icon";

type ThothMode = "quick" | "loop";
type ClarifyLevel = "auto" | "dont-ask" | "light" | "balanced" | "deep";
type LoopLevel = "auto" | "single" | "light" | "balanced" | "try";

const CLARIFY_LEVELS: Array<{ id: ClarifyLevel; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "dont-ask", label: "Don't Ask" },
  { id: "light", label: "Light" },
  { id: "balanced", label: "Balanced" },
  { id: "deep", label: "Dive Dive Dive" },
];

const LOOP_LEVELS: Array<{ id: LoopLevel; label: string }> = [
  { id: "auto", label: "Auto" },
  { id: "single", label: "Single Pass" },
  { id: "light", label: "Light" },
  { id: "balanced", label: "Balanced" },
  { id: "try", label: "Try Try Try" },
];

function getNextIndex<T>(items: readonly T[], currentIndex: number): number {
  return (currentIndex + 1) % items.length;
}

function getPressableStateStyle({
  hovered,
  pressed,
  disabled,
}: PressableStateCallbackType & { hovered?: boolean; disabled?: boolean }) {
  return [
    styles.controlButton,
    hovered ? styles.controlButtonHovered : undefined,
    pressed ? styles.controlButtonPressed : undefined,
    disabled ? styles.controlButtonDisabled : undefined,
  ];
}

interface ControlChipProps {
  label: string;
  value: string;
  icon: ThothInventoryIconName;
  disabled?: boolean;
  accent?: boolean;
  onPress?: () => void;
  testID?: string;
}

function ControlChip({ label, value, icon, disabled, accent, onPress, testID }: ControlChipProps) {
  const iconStyle = useMemo(
    () => [styles.controlIcon, disabled ? styles.controlIconDisabled : null],
    [disabled],
  );
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}: ${value}`}
      accessibilityState={disabled ? { disabled: true } : undefined}
      disabled={disabled || !onPress}
      onPress={onPress}
      style={(state) => getPressableStateStyle({ ...state, disabled })}
    >
      <ThothInventoryIcon name={icon} size={22} style={iconStyle} />
      <View style={styles.controlTextGroup}>
        <Text style={styles.controlLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text
          style={[styles.controlValue, accent ? styles.controlValueAccent : null]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {value}
        </Text>
      </View>
    </Pressable>
  );
}

interface ThothComposerControlsProps {
  providerLabel: string;
  providerReady: boolean;
}

export function ThothComposerControls({
  providerLabel,
  providerReady,
}: ThothComposerControlsProps) {
  const [mode, setMode] = useState<ThothMode>("quick");
  const [clarifyIndex, setClarifyIndex] = useState(0);
  const [loopIndex, setLoopIndex] = useState(0);

  const clarify = CLARIFY_LEVELS[clarifyIndex];
  const loop = LOOP_LEVELS[loopIndex];
  const isLoopMode = mode === "loop";

  const toggleMode = useCallback(() => {
    setMode((current) => (current === "quick" ? "loop" : "quick"));
  }, []);

  const cycleClarify = useCallback(() => {
    setClarifyIndex((current) => getNextIndex(CLARIFY_LEVELS, current));
  }, []);

  const cycleLoop = useCallback(() => {
    setLoopIndex((current) => getNextIndex(LOOP_LEVELS, current));
  }, []);

  const providerValue = providerReady ? providerLabel : "Select model first";
  const modeValue = isLoopMode ? "Loop" : "Quick";
  const loopValue = isLoopMode ? loop.label : "Off in Quick";
  const statusText = isLoopMode ? "Loop task runtime preview" : "Quick keeps current provider path";

  return (
    <View style={styles.container} testID="thoth-composer-controls">
      <View style={styles.rail}>
        <ControlChip
          label="+"
          value="Images/files <10MB"
          icon="attach"
          testID="thoth-control-attach"
        />
        <ControlChip
          label="Provider"
          value={providerValue}
          icon={providerReady ? "provider-loadout" : "no-provider"}
          disabled={!providerReady}
          testID="thoth-control-provider"
        />
        <ControlChip
          label="Mode"
          value={modeValue}
          icon={isLoopMode ? "loop-mode" : "quick-mode"}
          onPress={toggleMode}
          testID="thoth-control-mode"
        />
        <ControlChip
          label="Clarify"
          value={clarify.label}
          icon={clarify.id === "deep" ? "dive-dive-dive" : "clarifying"}
          onPress={cycleClarify}
          testID="thoth-control-clarify"
        />
        <ControlChip
          label="Loop"
          value={loopValue}
          icon={loop.id === "try" ? "try-try-try" : "continue-loop"}
          disabled={!isLoopMode}
          accent={isLoopMode && loop.id === "try"}
          onPress={cycleLoop}
          testID="thoth-control-loop"
        />
      </View>
      <View style={styles.statusRow}>
        <View
          style={[styles.statusDot, providerReady ? styles.statusDotReady : styles.statusDotMuted]}
        />
        <Text style={styles.statusText} numberOfLines={1}>
          {providerReady ? statusText : "Needs provider before execution"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[2],
  },
  rail: {
    flexDirection: "row",
    alignItems: "stretch",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  controlButton: {
    minHeight: 42,
    minWidth: 118,
    maxWidth: 188,
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  controlButtonHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  controlButtonPressed: {
    opacity: 0.86,
  },
  controlButtonDisabled: {
    opacity: 0.58,
  },
  controlIcon: {
    flexShrink: 0,
  },
  controlIconDisabled: {
    opacity: 0.72,
  },
  controlTextGroup: {
    minWidth: 0,
    flex: 1,
  },
  controlLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: Math.round(theme.fontSize.xs * 1.25),
  },
  controlValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: Math.round(theme.fontSize.sm * 1.25),
    fontWeight: theme.fontWeight.semibold,
  },
  controlValueAccent: {
    color: theme.colors.destructive,
  },
  statusRow: {
    minHeight: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  statusDotReady: {
    backgroundColor: theme.colors.success,
  },
  statusDotMuted: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusText: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
}));
