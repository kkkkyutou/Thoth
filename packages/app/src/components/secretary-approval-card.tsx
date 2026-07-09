import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, TextInput, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type {
  SecretaryApprovalActionPayload,
  ThothApprovalGoalCardModel,
  ThothTaskCardModel,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";

type ApprovalCardModel = ThothTaskCardModel | ThothApprovalGoalCardModel;
type ApprovalSubmitter = (payload: SecretaryApprovalActionPayload) => void | Promise<void>;

interface SecretaryApprovalCardProps {
  card: ApprovalCardModel;
  kind: "task" | "goal";
  onSubmit?: ApprovalSubmitter;
}

function cardPressableStyle({
  hovered,
  pressed,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.actionButton, (hovered || pressed) && styles.actionButtonHovered];
}

export function SecretaryApprovalCard({ card, kind, onSubmit }: SecretaryApprovalCardProps) {
  const { theme } = useUnistyles();
  const readonly = card.submitted || !onSubmit;
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const title = kind === "task" ? "任务总览确认" : "Goals Card 确认";
  const acceptLoopLabel = kind === "task" ? "注册后台" : "确认注册";
  const acceptQuickLabel = kind === "task" ? "保持 Quick" : "前台执行";
  const noteTrimmed = note.trim();

  const actionsDisabled = readonly || isSubmitting;

  const submit = useCallback(
    async (intent: SecretaryApprovalActionPayload["intent"]) => {
      if (!onSubmit || readonly || isSubmitting) {
        return;
      }
      setIsSubmitting(true);
      try {
        await onSubmit({
          intent,
          card_id: card.id,
          title: card.title,
          ...(noteTrimmed ? { note: noteTrimmed } : {}),
          raw_answer:
            intent === "annotate"
              ? noteTrimmed || "请修改这张卡"
              : intent === "accept_loop"
                ? "确认注册后台任务"
                : intent === "accept_quick"
                  ? "确认按 Quick 前台执行"
                  : "取消这轮审批",
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [card.id, card.title, isSubmitting, noteTrimmed, onSubmit, readonly],
  );

  const lines = useMemo(() => {
    if (kind === "task") {
      const taskCard = card as ThothTaskCardModel;
      return [
        { label: "目标", values: [taskCard.goal] },
        { label: "约束", values: taskCard.constraints },
        { label: "验收", values: taskCard.acceptance },
      ];
    }
    const goalCard = card as ThothApprovalGoalCardModel;
    if ("goals" in goalCard) {
      return goalCard.goals
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((goal) => ({
          label: `Goal ${goal.order}`,
          values: [
            goal.title,
            goal.goal,
            `约束：${goal.constraints.join("；")}`,
            `验收：${goal.acceptance.join("；")}`,
          ],
        }));
    }
    return goalCard.pyramid.map((stage, index) => ({
      label: `Legacy Stage ${index + 1}`,
      values: [
        stage.title,
        stage.goal,
        `验收：${stage.acceptance.join("；")}`,
        ...stage.subgoals.flatMap((subgoal, subgoalIndex) => [
          `${index + 1}.${subgoalIndex + 1} ${subgoal.title}`,
          subgoal.goal,
          `验收：${subgoal.acceptance.join("；")}`,
        ]),
      ],
    }));
  }, [card, kind]);

  return (
    <View style={styles.card} testID={`secretary-${kind}-approval-card`}>
      <Text style={styles.roundLabel}>{kind === "goal" ? "Goals Card" : card.roundLabel}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.title}>{card.title}</Text>
      {"goal" in card ? null : <Text style={styles.summary}>{card.summary}</Text>}
      <Text style={styles.provenance}>{card.provenanceSummary}</Text>

      <View style={styles.sections}>
        {lines.map((section) => (
          <View key={section.label} style={styles.section}>
            <Text style={styles.sectionLabel}>{section.label}</Text>
            {section.values.map((value, index) => (
              <Text key={`${section.label}-${index}`} style={styles.sectionValue}>
                {value}
              </Text>
            ))}
          </View>
        ))}
      </View>

      {readonly ? (
        <View style={styles.readonly} testID={`secretary-${kind}-readonly`}>
          <Text style={styles.readonlyText}>{card.submittedSummary ?? "已提交"}</Text>
        </View>
      ) : (
        <>
          <TextInput
            multiline
            editable={!actionsDisabled}
            placeholder="批注修改要求"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.noteInput}
            testID={`secretary-${kind}-note`}
            value={note}
            onChangeText={setNote}
          />
          <View style={styles.actions}>
            <Pressable
              disabled={actionsDisabled}
              onPress={() => void submit("accept_quick")}
              style={cardPressableStyle}
              testID={`secretary-${kind}-accept-quick`}
            >
              <Text style={styles.actionText}>{acceptQuickLabel}</Text>
            </Pressable>
            <Pressable
              disabled={actionsDisabled}
              onPress={() => void submit("accept_loop")}
              style={cardPressableStyle}
              testID={`secretary-${kind}-accept-loop`}
            >
              <Text style={styles.actionText}>{acceptLoopLabel}</Text>
            </Pressable>
            <Pressable
              disabled={actionsDisabled || noteTrimmed.length === 0}
              onPress={() => void submit("annotate")}
              style={cardPressableStyle}
              testID={`secretary-${kind}-annotate`}
            >
              <Text style={styles.actionText}>修改</Text>
            </Pressable>
            <Pressable
              disabled={actionsDisabled}
              onPress={() => void submit("cancel")}
              style={cardPressableStyle}
              testID={`secretary-${kind}-cancel`}
            >
              <Text style={styles.actionText}>取消</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  roundLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  cardTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  summary: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  provenance: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  sections: {
    gap: theme.spacing[3],
  },
  section: {
    gap: theme.spacing[1],
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.xs,
  },
  sectionValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  noteInput: {
    minHeight: 84,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    textAlignVertical: "top",
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  actionButton: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    backgroundColor: theme.colors.surface0,
  },
  actionButtonHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
  },
  actionText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  readonly: {
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface0,
  },
  readonlyText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
