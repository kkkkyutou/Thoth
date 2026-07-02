import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { View, Text, Pressable } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useRouter } from "expo-router";
import { ThothLogo } from "@/components/icons/thoth-logo";
import {
  ThothInventoryIcon,
  type ThothInventoryIconName,
} from "@/components/icons/thoth-inventory-icon";
import { CommunityLinks } from "@/components/community-links";
import { MenuHeader } from "@/components/headers/menu-header";
import { useOpenProjectPicker } from "@/hooks/use-open-project-picker";
import { useHostChooser } from "@/hosts/host-chooser";
import { usePanelStore } from "@/stores/panel-store";
import {
  useIsCompactFormFactor,
  HEADER_INNER_HEIGHT,
  HEADER_INNER_HEIGHT_MOBILE,
  HEADER_TOP_PADDING_MOBILE,
} from "@/constants/layout";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { buildHostAgentDetailRoute, buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { ImportSessionSheet } from "@/components/import-session-sheet";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useOpenProject } from "@/hooks/use-open-project";
import type { Href } from "expo-router";

export function OpenProjectScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const openDesktopAgentList = usePanelStore((s) => s.openDesktopAgentList);
  const openProjectPicker = useOpenProjectPicker();
  const chooseHost = useHostChooser();
  const localServerId = useLocalDaemonServerId();
  const [importServerId, setImportServerId] = useState<string | null>(null);
  const importClient = useHostRuntimeClient(importServerId ?? "");
  const openImportedProject = useOpenProject(importServerId);
  const [isPairDeviceOpen, setIsPairDeviceOpen] = useState(false);
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);

  const isCompactLayout = useIsCompactFormFactor();

  useEffect(() => {
    if (!isCompactLayout) {
      openDesktopAgentList();
    }
  }, [isCompactLayout, openDesktopAgentList]);

  const handleOpenPicker = useCallback(() => {
    void openProjectPicker();
  }, [openProjectPicker]);

  const handleOpenPairDevice = useCallback(() => setIsPairDeviceOpen(true), []);
  const handleClosePairDevice = useCallback(() => setIsPairDeviceOpen(false), []);

  const handleOpenImportSession = useCallback(() => {
    chooseHost({
      title: "Import from host",
      onChooseHost: (serverId) => {
        setImportServerId(serverId);
        setIsImportSheetOpen(true);
      },
    });
  }, [chooseHost]);
  const handleCloseImportSession = useCallback(() => setIsImportSheetOpen(false), []);

  const handleImported = useCallback(
    (agent: { id: string; cwd: string }) => {
      if (!importServerId) return;
      void (async () => {
        const result = await openImportedProject(agent.cwd);
        if (result.ok) {
          router.push(buildHostAgentDetailRoute(importServerId, agent.id) as Href);
        }
      })();
    },
    [importServerId, openImportedProject, router],
  );

  const handleOpenProviders = useCallback(() => {
    chooseHost({
      title: "Choose host",
      onChooseHost: (serverId) => {
        router.push(buildSettingsHostSectionRoute(serverId, "providers"));
      },
    });
  }, [chooseHost, router]);

  return (
    <View style={styles.container}>
      <MenuHeader borderless />
      <View style={styles.content}>
        <TitlebarDragRegion />
        <View style={styles.logo}>
          <ThothLogo size={52} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>One Thoth</Text>
          <Text style={styles.title}>Task control plane</Text>
          <Text style={styles.subtitle}>
            A calm workspace for turning intent into provider-backed loops, evidence and recovery.
          </Text>
        </View>
        <View style={styles.surfaceStrip}>
          <SurfaceStatus
            iconName="workspace-connected"
            label="Workspace"
            value="Needs a registered workspace"
          />
          <SurfaceStatus iconName="no-provider" label="Provider" value="Select a model first" />
          <SurfaceStatus iconName="remote-relay" label="Relay" value="Fresh pairing supported" />
          <SurfaceStatus iconName="evidence-center" label="Review" value="Preview surface" />
        </View>
        <View style={styles.tiles}>
          <HomeTile
            iconName="add-workspace"
            title={t("openProject.tiles.addProject.title")}
            description={t("openProject.tiles.addProject.description")}
            onPress={handleOpenPicker}
            testID="open-project-submit"
            accent
          />
          <HomeTile
            iconName="evidence"
            title={t("openProject.tiles.importSession.title")}
            description={t("openProject.tiles.importSession.description")}
            onPress={handleOpenImportSession}
            testID="open-project-import-session"
          />
          <HomeTile
            iconName="provider-loadout"
            title={t("openProject.tiles.setupProviders.title")}
            description={t("openProject.tiles.setupProviders.description")}
            onPress={handleOpenProviders}
            testID="open-project-setup-providers"
          />
          {localServerId ? (
            <HomeTile
              iconName="pair-device"
              title={t("openProject.tiles.pairDevice.title")}
              description={t("openProject.tiles.pairDevice.description")}
              onPress={handleOpenPairDevice}
              testID="open-project-pair-device"
            />
          ) : null}
        </View>
      </View>
      <View style={styles.communityRow}>
        <CommunityLinks />
      </View>
      <PairDeviceModal
        visible={isPairDeviceOpen}
        onClose={handleClosePairDevice}
        testID="open-project-pair-device-modal"
      />
      <ImportSessionSheet
        visible={isImportSheetOpen}
        client={importClient}
        serverId={importServerId}
        onClose={handleCloseImportSession}
        onImported={handleImported}
      />
    </View>
  );
}

function SurfaceStatus({
  iconName,
  label,
  value,
}: {
  iconName: ThothInventoryIconName;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.surfaceStatus}>
      <ThothInventoryIcon name={iconName} size={30} />
      <View style={styles.surfaceStatusText}>
        <Text style={styles.surfaceStatusLabel}>{label}</Text>
        <Text style={styles.surfaceStatusValue}>{value}</Text>
      </View>
    </View>
  );
}

interface HomeTileProps {
  iconName: ThothInventoryIconName;
  title: string;
  description: string;
  onPress: () => void;
  testID?: string;
  accent?: boolean;
}

function HomeTile({ iconName, title, description, onPress, testID, accent }: HomeTileProps) {
  const [hovered, setHovered] = useState(false);
  const handleHoverIn = useCallback(() => setHovered(true), []);
  const handleHoverOut = useCallback(() => setHovered(false), []);

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.tile,
      accent && styles.tileAccent,
      hovered && styles.tileHovered,
      pressed && styles.tilePressed,
    ],
    [accent, hovered],
  );

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      testID={testID}
      style={pressableStyle}
    >
      <ThothInventoryIcon name={iconName} size={34} />
      <View style={styles.tileText}>
        <Text style={styles.tileTitle}>{title}</Text>
        <Text style={styles.tileDescription}>{description}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    userSelect: "none",
  },
  content: {
    position: "relative",
    flex: 1,
    justifyContent: { xs: "flex-start", md: "center" },
    alignItems: "center",
    gap: 0,
    padding: theme.spacing[6],
    paddingTop: { xs: theme.spacing[12], md: theme.spacing[6] },
    paddingBottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[6],
      md: HEADER_INNER_HEIGHT + theme.spacing[6],
    },
  },
  logo: {
    marginBottom: theme.spacing[3],
  },
  heroCopy: {
    alignItems: "center",
    width: "100%",
    maxWidth: 620,
    gap: theme.spacing[2],
  },
  eyebrow: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
    textTransform: "uppercase",
  },
  title: {
    color: theme.colors.foreground,
    fontSize: { xs: theme.fontSize.xl, md: theme.fontSize["2xl"] },
    fontWeight: theme.fontWeight.semibold,
    textAlign: "center",
  },
  subtitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 520,
  },
  surfaceStrip: {
    width: "100%",
    maxWidth: 688,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[6],
  },
  surfaceStatus: {
    width: { xs: "100%", sm: 330, md: 166 },
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  surfaceStatusText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  surfaceStatusLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  surfaceStatusValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
    lineHeight: 16,
  },
  tiles: {
    marginTop: theme.spacing[6],
    width: "100%",
    maxWidth: 688,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: theme.spacing[3],
  },
  tile: {
    width: { xs: "100%", md: 334 },
    minHeight: { xs: 0, md: 118 },
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    gap: theme.spacing[3],
  },
  tileAccent: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  tileHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  tilePressed: {
    opacity: 0.85,
  },
  tileText: {
    gap: theme.spacing[1],
  },
  tileTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
  },
  tileDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 18,
  },
  communityRow: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: {
      xs: HEADER_INNER_HEIGHT_MOBILE + HEADER_TOP_PADDING_MOBILE + theme.spacing[2],
      md: HEADER_INNER_HEIGHT + theme.spacing[2],
    },
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 0,
  },
}));
