import { useMemo } from "react";
import { Image, type ImageSourcePropType, type ImageStyle, type StyleProp } from "react-native";

export type ThothInventoryIconName =
  | "brand-mark"
  | "thoth-seal"
  | "avatar-light"
  | "attach"
  | "add-image"
  | "upload-file"
  | "provider-loadout"
  | "model-brain"
  | "permission-shield"
  | "thinking-strength"
  | "quick-mode"
  | "loop-mode"
  | "dive-dive-dive"
  | "try-try-try"
  | "draft"
  | "clarifying"
  | "contract-frozen"
  | "planning"
  | "executing"
  | "reviewing"
  | "evidence"
  | "waiting-user"
  | "accepted"
  | "failed"
  | "stopped"
  | "continue-loop"
  | "add-workspace"
  | "empty-workspace"
  | "open-workspace"
  | "workspace-connected"
  | "no-provider"
  | "local-thoth"
  | "remote-relay"
  | "pair-device"
  | "pairing-expired"
  | "connection-health"
  | "relay-offline"
  | "reconnect"
  | "copy-link"
  | "tasks-nav"
  | "providers-nav"
  | "connections-nav"
  | "evidence-center"
  | "general-settings"
  | "appearance"
  | "diagnostics"
  | "about-thoth";

/* eslint-disable @typescript-eslint/no-require-imports */
const THOTH_INVENTORY_IMAGES: Record<ThothInventoryIconName, ImageSourcePropType> = {
  "brand-mark": require("../../../assets/icons/arcade-inventory/brand/brand-mark.png"),
  "thoth-seal": require("../../../assets/icons/arcade-inventory/brand/thoth-seal.png"),
  "avatar-light": require("../../../assets/icons/arcade-inventory/brand/avatar-light.png"),
  attach: require("../../../assets/icons/arcade-inventory/composer/attach.png"),
  "add-image": require("../../../assets/icons/arcade-inventory/composer/add-image.png"),
  "upload-file": require("../../../assets/icons/arcade-inventory/composer/upload-file.png"),
  "provider-loadout": require("../../../assets/icons/arcade-inventory/composer/provider-loadout.png"),
  "model-brain": require("../../../assets/icons/arcade-inventory/composer/model-brain.png"),
  "permission-shield": require("../../../assets/icons/arcade-inventory/composer/permission-shield.png"),
  "thinking-strength": require("../../../assets/icons/arcade-inventory/composer/thinking-strength.png"),
  "quick-mode": require("../../../assets/icons/arcade-inventory/mode-clarify-loop/quick-mode.png"),
  "loop-mode": require("../../../assets/icons/arcade-inventory/mode-clarify-loop/loop-mode.png"),
  "dive-dive-dive": require("../../../assets/icons/arcade-inventory/mode-clarify-loop/dive-dive-dive.png"),
  "try-try-try": require("../../../assets/icons/arcade-inventory/mode-clarify-loop/try-try-try.png"),
  draft: require("../../../assets/icons/arcade-inventory/task/draft.png"),
  clarifying: require("../../../assets/icons/arcade-inventory/task/clarifying.png"),
  "contract-frozen": require("../../../assets/icons/arcade-inventory/task/contract-frozen.png"),
  planning: require("../../../assets/icons/arcade-inventory/task/planning.png"),
  executing: require("../../../assets/icons/arcade-inventory/task/executing.png"),
  reviewing: require("../../../assets/icons/arcade-inventory/task/reviewing.png"),
  evidence: require("../../../assets/icons/arcade-inventory/task/evidence.png"),
  "waiting-user": require("../../../assets/icons/arcade-inventory/task/waiting-user.png"),
  accepted: require("../../../assets/icons/arcade-inventory/task/accepted.png"),
  failed: require("../../../assets/icons/arcade-inventory/task/failed.png"),
  stopped: require("../../../assets/icons/arcade-inventory/task/stopped.png"),
  "continue-loop": require("../../../assets/icons/arcade-inventory/task/continue-loop.png"),
  "add-workspace": require("../../../assets/icons/arcade-inventory/workspace-connection/add-workspace.png"),
  "empty-workspace": require("../../../assets/icons/arcade-inventory/workspace-connection/empty-workspace.png"),
  "open-workspace": require("../../../assets/icons/arcade-inventory/workspace-connection/open-workspace.png"),
  "workspace-connected": require("../../../assets/icons/arcade-inventory/workspace-connection/workspace-connected.png"),
  "no-provider": require("../../../assets/icons/arcade-inventory/workspace-connection/no-provider.png"),
  "local-thoth": require("../../../assets/icons/arcade-inventory/workspace-connection/local-thoth.png"),
  "remote-relay": require("../../../assets/icons/arcade-inventory/workspace-connection/remote-relay.png"),
  "pair-device": require("../../../assets/icons/arcade-inventory/workspace-connection/pair-device.png"),
  "pairing-expired": require("../../../assets/icons/arcade-inventory/workspace-connection/pairing-expired.png"),
  "connection-health": require("../../../assets/icons/arcade-inventory/workspace-connection/connection-health.png"),
  "relay-offline": require("../../../assets/icons/arcade-inventory/workspace-connection/relay-offline.png"),
  reconnect: require("../../../assets/icons/arcade-inventory/workspace-connection/reconnect.png"),
  "copy-link": require("../../../assets/icons/arcade-inventory/workspace-connection/copy-link.png"),
  "tasks-nav": require("../../../assets/icons/arcade-inventory/navigation-settings/tasks-nav.png"),
  "providers-nav": require("../../../assets/icons/arcade-inventory/navigation-settings/providers-nav.png"),
  "connections-nav": require("../../../assets/icons/arcade-inventory/navigation-settings/connections-nav.png"),
  "evidence-center": require("../../../assets/icons/arcade-inventory/navigation-settings/evidence-center.png"),
  "general-settings": require("../../../assets/icons/arcade-inventory/navigation-settings/general-settings.png"),
  appearance: require("../../../assets/icons/arcade-inventory/navigation-settings/appearance.png"),
  diagnostics: require("../../../assets/icons/arcade-inventory/navigation-settings/diagnostics.png"),
  "about-thoth": require("../../../assets/icons/arcade-inventory/navigation-settings/about-thoth.png"),
};
/* eslint-enable @typescript-eslint/no-require-imports */

interface ThothInventoryIconProps {
  name: ThothInventoryIconName;
  size?: number;
  style?: StyleProp<ImageStyle>;
}

export function ThothInventoryIcon({ name, size = 24, style }: ThothInventoryIconProps) {
  const imageStyle = useMemo(() => [{ width: size, height: size }, style], [size, style]);
  return <Image source={THOTH_INVENTORY_IMAGES[name]} style={imageStyle} resizeMode="contain" />;
}
