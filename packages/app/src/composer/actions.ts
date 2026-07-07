import type { GitHubSearchItem } from "@thoth/protocol/messages";
import type {
  SecretaryTurn,
  ThothCleanUiModel,
  ThothComposerModel,
  WorkspaceSecretaryResponsePayload,
  WorkspaceSecretaryTurnActionPayload,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
} from "@/attachments/types";
import {
  isWorkspaceAttachment,
  userAttachmentsOnly,
} from "@/attachments/workspace-attachment-utils";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import {
  appendOptimisticUserMessageToStream,
  buildOptimisticUserMessage,
  generateMessageId,
  type StreamItem,
  type UserMessageItem,
} from "@/types/stream";
import type { PickedImageAttachmentInput } from "@/hooks/image-attachment-picker";
import { i18n } from "@/i18n/i18next";

export interface QueuedComposerMessage {
  id: string;
  text: string;
  attachments: ComposerAttachment[];
}

export interface AttachmentPersister {
  persistFromBlob: (input: {
    blob: Blob;
    mimeType: string;
    fileName: string | null;
  }) => Promise<AttachmentMetadata>;
  persistFromFileUri: (input: {
    uri: string;
    mimeType: string;
    fileName: string | null;
  }) => Promise<AttachmentMetadata>;
  deleteAttachments: (metadata: AttachmentMetadata[]) => Promise<void> | void;
}

export interface ComposerSendClient {
  sendAgentMessage: (
    agentId: string,
    text: string,
    options: {
      messageId: string;
      images: Array<{ data: string; mimeType: string }>;
      attachments: ReturnType<typeof splitComposerAttachmentsForSubmit>["attachments"];
    },
  ) => Promise<void>;
  uploadFile: (input: { fileName: string; mimeType: string; bytes: Uint8Array }) => Promise<{
    requestId: string;
    file: {
      type: "uploaded_file";
      id: string;
      fileName: string;
      mimeType: string;
      size: number;
      path: string;
    } | null;
    error: string | null;
  }>;
}

export interface WorkspaceSecretarySendClient {
  sendWorkspaceSecretaryMessage: (input: {
    text: string;
    composer: ThothComposerModel;
    uiAgentId?: string;
    messageId?: string;
    images?: Array<{ data: string; mimeType: string }>;
    attachments?: ReturnType<typeof splitComposerAttachmentsForSubmit>["attachments"];
  }) => Promise<WorkspaceSecretaryResponsePayload>;
  answerWorkspaceSecretaryClarify: (input: {
    cardId: string;
    answer: WorkspaceSecretaryTurnActionPayload;
    uiAgentId?: string;
  }) => Promise<WorkspaceSecretaryResponsePayload>;
}

export interface ComposerCancelClient {
  cancelAgent: (agentId: string) => Promise<void> | void;
}

export interface AgentStreamWriter {
  getTail: (agentId: string) => StreamItem[] | undefined;
  getHead: (agentId: string) => StreamItem[] | undefined;
  setHead: (updater: (prev: Map<string, StreamItem[]>) => Map<string, StreamItem[]>) => void;
  setTail: (updater: (prev: Map<string, StreamItem[]>) => Map<string, StreamItem[]>) => void;
}

export interface QueueWriter {
  read: (agentId: string) => QueuedComposerMessage[];
  write: (
    updater: (prev: Map<string, QueuedComposerMessage[]>) => Map<string, QueuedComposerMessage[]>,
  ) => void;
}

export async function pickAndPersistImages(input: {
  pickImages: () => Promise<PickedImageAttachmentInput[] | null>;
  persister: Pick<AttachmentPersister, "persistFromBlob" | "persistFromFileUri">;
}): Promise<AttachmentMetadata[]> {
  const result = await input.pickImages();
  if (!result?.length) return [];
  return await Promise.all(
    result.map(async (picked) => {
      const fileName = picked.fileName ?? null;
      const mimeType = picked.mimeType || "image/jpeg";
      if (picked.source.kind === "blob") {
        return await input.persister.persistFromBlob({
          blob: picked.source.blob,
          mimeType,
          fileName,
        });
      }
      return await input.persister.persistFromFileUri({
        uri: picked.source.uri,
        mimeType,
        fileName,
      });
    }),
  );
}

export async function uploadFileAttachments(input: {
  client: ComposerSendClient;
  files: Array<{ fileName: string; mimeType: string; bytes: Uint8Array }>;
}): Promise<Extract<ComposerAttachment, { kind: "file" }>[]> {
  const result: Extract<ComposerAttachment, { kind: "file" }>[] = [];

  for (const file of input.files) {
    const response = await input.client.uploadFile(file);
    if (response.error || !response.file) {
      throw new Error(response.error ?? "Upload failed.");
    }
    result.push({ kind: "file", attachment: response.file });
  }

  return result;
}

export function removeComposerAttachmentAtIndex<T extends ComposerAttachment>(input: {
  attachments: T[];
  index: number;
  deleteAttachments: AttachmentPersister["deleteAttachments"];
}): T[] {
  const removed = input.attachments[input.index];
  if (removed?.kind === "image") {
    void input.deleteAttachments([removed.metadata]);
  }
  return input.attachments.filter((_, i) => i !== input.index);
}

export interface CancelComposerAgentInput {
  client: ComposerCancelClient | null;
  agentId: string;
  isAgentRunning: boolean;
  isCancellingAgent: boolean;
  isConnected: boolean;
}

export function cancelComposerAgent(input: CancelComposerAgentInput): boolean {
  if (!input.isAgentRunning || input.isCancellingAgent) return false;
  if (!input.isConnected || !input.client) return false;
  void input.client.cancelAgent(input.agentId);
  return true;
}

export interface DispatchComposerAgentMessageInput {
  client: ComposerSendClient;
  agentId: string;
  text: string;
  attachments: ComposerAttachment[];
  encodeImages: (
    images: AttachmentMetadata[],
  ) => Promise<Array<{ data: string; mimeType: string }> | undefined>;
  stream: AgentStreamWriter;
}

export async function dispatchComposerAgentMessage(
  input: DispatchComposerAgentMessageInput,
): Promise<void> {
  const wirePayload = splitComposerAttachmentsForSubmit(input.attachments);
  const messageId = generateMessageId();
  const userMessage = buildOptimisticUserMessage({
    id: messageId,
    text: input.text,
    timestamp: new Date(),
    images: wirePayload.images,
    attachments: wirePayload.attachments,
  });
  appendUserMessageToStream(input.agentId, userMessage, input.stream);
  const imagesData = await input.encodeImages(wirePayload.images);
  await input.client.sendAgentMessage(input.agentId, input.text, {
    messageId,
    images: imagesData ?? [],
    attachments: wirePayload.attachments,
  });
}

export interface DispatchWorkspaceSecretaryMessageInput {
  client: WorkspaceSecretarySendClient;
  agentId: string;
  text: string;
  attachments: ComposerAttachment[];
  composer: ThothComposerModel;
  encodeImages: (
    images: AttachmentMetadata[],
  ) => Promise<Array<{ data: string; mimeType: string }> | undefined>;
  stream: AgentStreamWriter;
}

export async function dispatchWorkspaceSecretaryMessage(
  input: DispatchWorkspaceSecretaryMessageInput,
): Promise<void> {
  const wirePayload = splitComposerAttachmentsForSubmit(input.attachments);
  const messageId = generateMessageId();
  const userMessage = buildOptimisticUserMessage({
    id: messageId,
    text: input.text,
    timestamp: new Date(),
    images: wirePayload.images,
    attachments: wirePayload.attachments,
  });
  appendUserMessageToStream(input.agentId, userMessage, input.stream);
  const imagesData = await input.encodeImages(wirePayload.images);
  const payload = await input.client.sendWorkspaceSecretaryMessage({
    text: input.text,
    composer: input.composer,
    uiAgentId: input.agentId,
    messageId,
    images: imagesData ?? [],
    attachments: wirePayload.attachments,
  });
  if (payload.model) {
    applyWorkspaceSecretaryModelToStream(input.agentId, payload.model, input.stream);
  }
}

export async function dispatchWorkspaceSecretaryAnswer(input: {
  client: WorkspaceSecretarySendClient;
  agentId: string;
  cardId: string;
  answer: WorkspaceSecretaryTurnActionPayload;
  stream: AgentStreamWriter;
}): Promise<void> {
  const payload = await input.client.answerWorkspaceSecretaryClarify({
    cardId: input.cardId,
    answer: input.answer,
    uiAgentId: input.agentId,
  });
  if (payload.model) {
    applyWorkspaceSecretaryModelToStream(input.agentId, payload.model, input.stream);
  }
}

export function applyWorkspaceSecretaryModelToStream(
  agentId: string,
  model: ThothCleanUiModel,
  stream: AgentStreamWriter,
): void {
  const items = model.secretary.turns.flatMap(secretaryTurnToStreamItem);
  if (items.length === 0) {
    return;
  }
  stream.setTail((prev) => {
    const next = new Map(prev);
    const current = next.get(agentId) ?? [];
    next.set(agentId, mergeStreamItemsById(current, items));
    return next;
  });
  stream.setHead((prev) => {
    if (!prev.has(agentId)) {
      return prev;
    }
    const next = new Map(prev);
    next.delete(agentId);
    return next;
  });
}

function secretaryTurnToStreamItem(turn: SecretaryTurn): StreamItem[] {
  const timestamp = new Date();
  switch (turn.kind) {
    case "message":
      if (turn.speaker === "user") {
        return [];
      }
      return [
        {
          kind: "assistant_message",
          id: `secretary_message_${turn.id}`,
          messageId: turn.id,
          text: turn.text,
          timestamp,
        },
      ];
    case "clarify_card":
      return [{ kind: "clarify_card", id: `clarify_${turn.card.id}`, timestamp, card: turn.card }];
    case "task_card":
      return [{ kind: "task_card", id: `task_card_${turn.card.id}`, timestamp, card: turn.card }];
    case "goal_card":
      return [{ kind: "goal_card", id: `goal_card_${turn.card.id}`, timestamp, card: turn.card }];
    case "registered_task":
      return [
        {
          kind: "registered_task",
          id: `registered_task_${turn.task.id}`,
          timestamp,
          task: turn.task,
        },
      ];
    default:
      return [];
  }
}

function mergeStreamItemsById(current: StreamItem[], incoming: StreamItem[]): StreamItem[] {
  let next = current;
  for (const item of incoming) {
    const existingIndex = next.findIndex((entry) => entry.id === item.id);
    if (existingIndex >= 0) {
      const updated = [...next];
      updated[existingIndex] = item;
      next = updated;
      continue;
    }
    next = [...next, item];
  }
  return next;
}

function appendUserMessageToStream(
  agentId: string,
  userMessage: UserMessageItem,
  stream: AgentStreamWriter,
): void {
  const result = appendOptimisticUserMessageToStream({
    tail: stream.getTail(agentId) ?? [],
    head: stream.getHead(agentId) ?? [],
    message: userMessage,
    placement: "active-head",
  });
  if (result.changedHead) {
    stream.setHead((prev) => {
      const next = new Map(prev);
      next.set(agentId, result.head);
      return next;
    });
  }
  if (result.changedTail) {
    stream.setTail((prev) => {
      const next = new Map(prev);
      next.set(agentId, result.tail);
      return next;
    });
  }
}

export interface QueueComposerMessageInput {
  agentId: string;
  text: string;
  attachments: ComposerAttachment[];
  queue: QueueWriter;
}

export interface QueueComposerMessageResult {
  queued: QueuedComposerMessage | null;
}

export function queueComposerMessage(input: QueueComposerMessageInput): QueueComposerMessageResult {
  const trimmed = input.text.trim();
  if (!trimmed && input.attachments.length === 0) {
    return { queued: null };
  }
  const item: QueuedComposerMessage = {
    id: generateMessageId(),
    text: trimmed,
    attachments: input.attachments,
  };
  input.queue.write((prev) => {
    const next = new Map(prev);
    next.set(input.agentId, [...(prev.get(input.agentId) ?? []), item]);
    return next;
  });
  return { queued: item };
}

export interface EditQueuedComposerMessageInput {
  agentId: string;
  messageId: string;
  queue: QueueWriter;
}

export interface EditQueuedComposerMessageResult {
  text: string;
  attachments: UserComposerAttachment[];
}

export function editQueuedComposerMessage(
  input: EditQueuedComposerMessageInput,
): EditQueuedComposerMessageResult | null {
  const item = input.queue.read(input.agentId).find((q) => q.id === input.messageId);
  if (!item) return null;
  input.queue.write((prev) => {
    const next = new Map(prev);
    next.set(
      input.agentId,
      (prev.get(input.agentId) ?? []).filter((q) => q.id !== input.messageId),
    );
    return next;
  });
  return {
    text: item.text,
    attachments: userAttachmentsOnly(item.attachments),
  };
}

export interface SendQueuedComposerMessageNowInput {
  agentId: string;
  messageId: string;
  queue: QueueWriter;
  submitMessage: (input: { text: string; attachments: ComposerAttachment[] }) => Promise<void>;
  failedToSendMessage?: string;
}

export type SendQueuedComposerMessageNowResult =
  | { status: "missing" }
  | { status: "submitted" }
  | { status: "failed"; errorMessage: string };

export async function sendQueuedComposerMessageNow(
  input: SendQueuedComposerMessageNowInput,
): Promise<SendQueuedComposerMessageNowResult> {
  const item = input.queue.read(input.agentId).find((q) => q.id === input.messageId);
  if (!item) return { status: "missing" };
  input.queue.write((prev) => {
    const next = new Map(prev);
    next.set(
      input.agentId,
      (prev.get(input.agentId) ?? []).filter((q) => q.id !== input.messageId),
    );
    return next;
  });
  try {
    await input.submitMessage({ text: item.text, attachments: item.attachments });
    return { status: "submitted" };
  } catch (error) {
    input.queue.write((prev) => {
      const next = new Map(prev);
      next.set(input.agentId, [item, ...(prev.get(input.agentId) ?? [])]);
      return next;
    });
    return {
      status: "failed",
      errorMessage:
        error instanceof Error
          ? error.message
          : (input.failedToSendMessage ?? i18n.t("composer.errors.failedToSend")),
    };
  }
}

export interface OpenComposerAttachmentInput {
  attachment: ComposerAttachment;
  setLightboxMetadata: (metadata: AttachmentMetadata) => void;
  openWorkspaceAttachment: (input: { attachment: ComposerAttachment }) => boolean;
  openExternalUrl: (url: string) => void;
}

export function openComposerAttachment(input: OpenComposerAttachmentInput): void {
  if (input.attachment.kind === "image") {
    input.setLightboxMetadata(input.attachment.metadata);
    return;
  }
  if (input.attachment.kind === "file") {
    return;
  }
  if (isWorkspaceAttachment(input.attachment)) {
    input.openWorkspaceAttachment({ attachment: input.attachment });
    return;
  }
  input.openExternalUrl(input.attachment.item.url);
}

export function buildGithubAttachment(item: GitHubSearchItem): UserComposerAttachment {
  return item.kind === "pr" ? { kind: "github_pr", item } : { kind: "github_issue", item };
}

function isGithubAttachment(
  attachment: UserComposerAttachment,
): attachment is Extract<UserComposerAttachment, { kind: "github_issue" } | { kind: "github_pr" }> {
  return attachment.kind === "github_issue" || attachment.kind === "github_pr";
}

export function toggleGithubAttachment(
  current: UserComposerAttachment[],
  item: GitHubSearchItem,
): UserComposerAttachment[] {
  const matches = (attachment: UserComposerAttachment) =>
    isGithubAttachment(attachment) &&
    attachment.item.kind === item.kind &&
    attachment.item.number === item.number;
  if (current.some(matches)) {
    return current.filter((attachment) => !matches(attachment));
  }
  return [...current, buildGithubAttachment(item)];
}

interface ToggleGithubAttachmentFromPickerInput {
  current: UserComposerAttachment[];
  item: GitHubSearchItem;
  markGithubAttachmentRemoved: (attachment: UserComposerAttachment) => void;
}

export function toggleGithubAttachmentFromPicker({
  current,
  item,
  markGithubAttachmentRemoved,
}: ToggleGithubAttachmentFromPickerInput): UserComposerAttachment[] {
  const existingAttachment = current.find(
    (attachment) =>
      isGithubAttachment(attachment) &&
      attachment.item.kind === item.kind &&
      attachment.item.number === item.number,
  );
  if (existingAttachment) {
    markGithubAttachmentRemoved(existingAttachment);
  }
  return toggleGithubAttachment(current, item);
}

export function findGithubItemByOption(
  items: readonly GitHubSearchItem[],
  optionId: string,
): GitHubSearchItem | undefined {
  return items.find((candidate) => `${candidate.kind}:${candidate.number}` === optionId);
}

export function isAttachmentSelectedForGithubItem(
  current: readonly ComposerAttachment[],
  item: GitHubSearchItem,
): boolean {
  return userAttachmentsOnly(current).some(
    (attachment) =>
      isGithubAttachment(attachment) &&
      attachment.item.kind === item.kind &&
      attachment.item.number === item.number,
  );
}
