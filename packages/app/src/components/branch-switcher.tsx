import { Text, View } from "react-native";
import { GitBranch } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";

interface BranchSwitcherProps {
  currentBranchName: string | null;
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string | null;
  isGitCheckout: boolean;
  testID?: string;
}

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const ThemedGitBranch = withUnistyles(GitBranch);

export function BranchSwitcher({
  currentBranchName,
  serverId: _serverId,
  workspaceId: _workspaceId,
  workspaceDirectory: _workspaceDirectory,
  isGitCheckout: _isGitCheckout,
  testID = "workspace-header-branch-switcher",
}: BranchSwitcherProps) {
  const { t } = useTranslation();

  if (!currentBranchName) {
    return null;
  }

  return (
    <View style={styles.anchor}>
      <View
        testID={testID}
        accessibilityLabel={t("branchSwitcher.currentBranch", { branchName: currentBranchName })}
        style={styles.trigger}
      >
        <ThemedGitBranch size={14} uniProps={foregroundMutedIconColorMapping} />
        <Text style={styles.branchLabel} numberOfLines={1}>
          {currentBranchName}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    flexShrink: 1,
    minWidth: 0,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minWidth: 0,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    marginLeft: -theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    flexShrink: 1,
  },
  branchLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
}));
