import { describe, expect, it, vi } from "vitest";
import type { AgentAttachment, GitHubSearchItem } from "@thoth/protocol/messages";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import type { StreamItem } from "@/types/stream";
import {
  applyWorkspaceSecretaryModelToStream,
  cancelComposerAgent,
  dispatchComposerAgentMessage,
  dispatchWorkspaceSecretaryAnswer,
  dispatchWorkspaceSecretaryCancel,
  dispatchWorkspaceSecretaryMessage,
  hydrateWorkspaceSecretaryProviderTimeline,
  editQueuedComposerMessage,
  findGithubItemByOption,
  isAttachmentSelectedForGithubItem,
  openComposerAttachment,
  pickAndPersistImages,
  queueComposerMessage,
  removeWorkspaceSecretaryModelItemsFromStream,
  removeComposerAttachmentAtIndex,
  sendQueuedComposerMessageNow,
  toggleGithubAttachment,
  toggleGithubAttachmentFromPicker,
  type AgentStreamWriter,
  type AttachmentPersister,
  type ComposerCancelClient,
  type ComposerSendClient,
  type QueueWriter,
  type QueuedComposerMessage,
} from "./actions";
import type {
  ThothCleanUiModel,
  WorkspaceSecretaryResponsePayload,
  WorkspaceSecretaryTurnActionPayload,
} from "@thoth/protocol/workspace-secretary/rpc-schemas";

const imageMetadata: AttachmentMetadata = {
  id: "img-1",
  mimeType: "image/png",
  storageType: "web-indexeddb",
  storageKey: "img-1",
  fileName: "img-1.png",
  byteSize: 42,
  createdAt: 1,
};

const issueItem: GitHubSearchItem = {
  kind: "issue",
  number: 101,
  title: "Fix composer attachments",
  url: "https://github.com/acme/thoth/issues/101",
  state: "open",
  body: "Issue body",
  labels: ["composer"],
  baseRefName: null,
  headRefName: null,
};

const prItem: GitHubSearchItem = {
  kind: "pr",
  number: 202,
  title: "Refactor composer attachments",
  url: "https://github.com/acme/thoth/pull/202",
  state: "open",
  body: "PR body",
  labels: ["composer"],
  baseRefName: "main",
  headRefName: "composer-attachments",
};

function imageWithId(id: string): AttachmentMetadata {
  return { ...imageMetadata, id, storageKey: id, fileName: `${id}.png` };
}

function reviewWorkspaceAttachment(
  body: string,
): Extract<WorkspaceComposerAttachment, { kind: "review" }> {
  const attachment: Extract<AgentAttachment, { type: "review" }> = {
    type: "review",
    mimeType: "application/thoth-review",
    cwd: "/repo",
    mode: "uncommitted",
    baseRef: null,
    comments: [
      {
        filePath: "src/example.ts",
        side: "new",
        lineNumber: 41,
        body,
        context: {
          hunkHeader: "@@ -40,2 +40,2 @@",
          targetLine: {
            oldLineNumber: null,
            newLineNumber: 41,
            type: "add",
            content: "const value = newValue;",
          },
          lines: [
            {
              oldLineNumber: null,
              newLineNumber: 41,
              type: "add",
              content: "const value = newValue;",
            },
          ],
        },
      },
    ],
  };
  return {
    kind: "review",
    reviewDraftKey: `review:${body}`,
    commentCount: 1,
    attachment,
  };
}

function browserElementWorkspaceAttachment(): Extract<
  WorkspaceComposerAttachment,
  { kind: "browser_element" }
> {
  return {
    kind: "browser_element",
    attachment: {
      url: "https://example.com/page",
      selector: "button.primary",
      tag: "button",
      text: "Save",
      outerHTML: '<button class="primary">Save</button>',
      computedStyles: { display: "flex" },
      boundingRect: { x: 1, y: 2, width: 80, height: 32 },
      reactSource: null,
      parentChain: ["form.settings"],
      children: [],
      formatted: '<browser-element url="https://example.com/page">button.primary</browser-element>',
    },
  };
}

function createFakePersister(): AttachmentPersister & {
  blobCalls: Array<{ blob: Blob; mimeType: string; fileName: string | null }>;
  fileUriCalls: Array<{ uri: string; mimeType: string; fileName: string | null }>;
  deletedBatches: AttachmentMetadata[][];
} {
  const blobCalls: Array<{ blob: Blob; mimeType: string; fileName: string | null }> = [];
  const fileUriCalls: Array<{ uri: string; mimeType: string; fileName: string | null }> = [];
  const deletedBatches: AttachmentMetadata[][] = [];
  return {
    blobCalls,
    fileUriCalls,
    deletedBatches,
    persistFromBlob: async ({ blob, mimeType, fileName }) => {
      blobCalls.push({ blob, mimeType, fileName });
      return { ...imageMetadata, id: `blob-${blobCalls.length}` };
    },
    persistFromFileUri: async ({ uri, mimeType, fileName }) => {
      fileUriCalls.push({ uri, mimeType, fileName });
      return { ...imageMetadata, id: `uri-${fileUriCalls.length}` };
    },
    deleteAttachments: (metadata) => {
      deletedBatches.push(metadata);
    },
  };
}

interface FakeSendCall {
  agentId: string;
  text: string;
  options: {
    messageId: string;
    images: Array<{ data: string; mimeType: string }>;
    attachments: AgentAttachment[];
  };
}

function createFakeSendClient(
  options: { rejection?: Error } = {},
): ComposerSendClient & { calls: FakeSendCall[] } {
  const calls: FakeSendCall[] = [];
  return {
    calls,
    sendAgentMessage: async (agentId, text, opts) => {
      calls.push({ agentId, text, options: opts });
      if (options.rejection) {
        throw options.rejection;
      }
    },
    uploadFile: async () => ({ requestId: "test", file: null, error: null }),
  };
}

function createSecretaryModel(): ThothCleanUiModel {
  return {
    authority: {
      source: "provider_backed_clean_ui_model",
      schemaVerified: true,
      label: "test",
    },
    activeView: "workspace-secretary",
    secretary: {
      workspaceName: "Thoth",
      workspacePath: "/repo",
      topics: [{ id: "topic-main", title: "当前话题", status: "current", updatedLabel: "刚刚" }],
      activeTopicId: "topic-main",
      status: { kind: "ready", title: "ready", detail: "ready" },
      turns: [
        { id: "user-1", kind: "message", speaker: "user", text: "ignored duplicate user" },
        { id: "assistant-1", kind: "message", speaker: "secretary", text: "需要先确认目标。" },
      ],
      composer: {
        mode: "quick",
        clarifyStrength: "light",
        loop: null,
        authorityLabel: "codex",
        authorityReady: true,
      },
    },
    settings: {
      runtime: [],
      relay: {
        endpoint: "relay.test.thoth.seeles.ai",
        healthUrl: "https://relay.test.thoth.seeles.ai/health",
        status: "checking",
        safeSummary: "checking",
        checkedAtLabel: "now",
      },
      requiredRuntime: [],
    },
    backgroundTasks: { tasks: [] },
  };
}

function createFakeSecretaryClient(model = createSecretaryModel()) {
  const calls: Array<{
    workspaceId?: string;
    workspacePath?: string;
    topicId?: string;
    text: string;
    messageId?: string;
    images?: Array<{ data: string; mimeType: string }>;
    attachments?: unknown[];
  }> = [];
  const answerCalls: Array<{
    workspaceId?: string;
    workspacePath?: string;
    topicId?: string;
    cardId: string;
    answer: WorkspaceSecretaryTurnActionPayload;
    uiAgentId?: string;
  }> = [];
  const cancelCalls: Array<{
    workspaceId?: string;
    workspacePath?: string;
    uiAgentId?: string;
    topicId?: string;
  }> = [];
  const payload: WorkspaceSecretaryResponsePayload = {
    requestId: "fake-secretary-response",
    model,
    error: null,
  };
  return {
    calls,
    answerCalls,
    cancelCalls,
    sendWorkspaceSecretaryMessage: async (input: {
      text: string;
      messageId?: string;
      images?: Array<{ data: string; mimeType: string }>;
      attachments?: unknown[];
    }) => {
      calls.push(input);
      const existingUserTurn = model.secretary.turns.find(
        (turn): turn is Extract<SecretaryTurn, { kind: "message" }> =>
          turn.kind === "message" && turn.speaker === "user",
      );
      if (existingUserTurn) {
        existingUserTurn.text = input.text;
      } else {
        model.secretary.turns.unshift({
          id: `user-${calls.length}`,
          kind: "message",
          speaker: "user",
          text: input.text,
        });
      }
      return payload;
    },
    answerWorkspaceSecretaryClarify: async (input: (typeof answerCalls)[number]) => {
      answerCalls.push(input);
      return payload;
    },
    cancelWorkspaceSecretaryTurn: async (input: (typeof cancelCalls)[number]) => {
      cancelCalls.push(input);
      return payload;
    },
  };
}

interface FakeStream extends AgentStreamWriter {
  head: Map<string, StreamItem[]>;
  tail: Map<string, StreamItem[]>;
}

function createFakeStream(initialHead: Map<string, StreamItem[]> = new Map()): FakeStream {
  const fake: FakeStream = {
    head: new Map(initialHead),
    tail: new Map(),
    getTail: (agentId) => fake.tail.get(agentId),
    getHead: (agentId) => fake.head.get(agentId),
    setHead: (updater) => {
      fake.head = updater(fake.head);
    },
    setTail: (updater) => {
      fake.tail = updater(fake.tail);
    },
  };
  return fake;
}

function createFakeQueue(
  initial: Map<string, QueuedComposerMessage[]> = new Map(),
): QueueWriter & { state: Map<string, QueuedComposerMessage[]> } {
  const fake: QueueWriter & { state: Map<string, QueuedComposerMessage[]> } = {
    state: new Map(initial),
    read: (agentId) => fake.state.get(agentId) ?? [],
    write: (updater) => {
      fake.state = updater(fake.state);
    },
  };
  return fake;
}

const passthroughEncodeImages = async (images: AttachmentMetadata[]) =>
  images.map((image) => ({ data: image.id, mimeType: image.mimeType }));

describe("cancelComposerAgent", () => {
  function baseInput(): {
    client: ComposerCancelClient & { canceledIds: string[] };
    agentId: string;
    isAgentRunning: boolean;
    isCancellingAgent: boolean;
    isConnected: boolean;
  } {
    const canceledIds: string[] = [];
    return {
      client: {
        canceledIds,
        cancelAgent: async (id) => {
          canceledIds.push(id);
        },
      },
      agentId: "agent",
      isAgentRunning: true,
      isCancellingAgent: false,
      isConnected: true,
    };
  }

  it("issues a cancel and reports true when the agent is running, connected, and not already canceling", () => {
    const input = baseInput();
    const result = cancelComposerAgent(input);
    expect(result).toBe(true);
    expect(input.client.canceledIds).toEqual(["agent"]);
  });

  it("does nothing when the agent is not running", () => {
    const input = baseInput();
    const result = cancelComposerAgent({ ...input, isAgentRunning: false });
    expect(result).toBe(false);
    expect(input.client.canceledIds).toEqual([]);
  });

  it("does nothing when the agent is already being canceled", () => {
    const input = baseInput();
    const result = cancelComposerAgent({ ...input, isCancellingAgent: true });
    expect(result).toBe(false);
    expect(input.client.canceledIds).toEqual([]);
  });

  it("does nothing when disconnected or the client is null", () => {
    const input = baseInput();
    expect(cancelComposerAgent({ ...input, isConnected: false })).toBe(false);
    expect(cancelComposerAgent({ ...input, client: null })).toBe(false);
    expect(input.client.canceledIds).toEqual([]);
  });
});

describe("pickAndPersistImages", () => {
  it("returns [] when the picker yields nothing", async () => {
    const persister = createFakePersister();
    const result = await pickAndPersistImages({
      pickImages: async () => null,
      persister,
    });
    expect(result).toEqual([]);
    expect(persister.blobCalls).toEqual([]);
    expect(persister.fileUriCalls).toEqual([]);
  });

  it("persists blob sources via persistFromBlob with the picked mime type and file name", async () => {
    const persister = createFakePersister();
    const blob = new Blob(["image"]);
    const result = await pickAndPersistImages({
      pickImages: async () => [
        { source: { kind: "blob", blob }, mimeType: "image/png", fileName: "img-1.png" },
      ],
      persister,
    });
    expect(persister.blobCalls).toEqual([{ blob, mimeType: "image/png", fileName: "img-1.png" }]);
    expect(result.map((m) => m.id)).toEqual(["blob-1"]);
  });

  it("persists file_uri sources via persistFromFileUri", async () => {
    const persister = createFakePersister();
    const result = await pickAndPersistImages({
      pickImages: async () => [
        { source: { kind: "file_uri", uri: "/tmp/x.jpg" }, mimeType: null, fileName: null },
      ],
      persister,
    });
    expect(persister.fileUriCalls).toEqual([
      { uri: "/tmp/x.jpg", mimeType: "image/jpeg", fileName: null },
    ]);
    expect(result).toHaveLength(1);
  });
});

describe("dispatchComposerAgentMessage", () => {
  it("sends text + image data + structured attachments and appends user_message to the tail when head is empty", async () => {
    const client = createFakeSendClient();
    const stream = createFakeStream();
    const image = imageWithId("img-2");

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "send attachments",
      attachments: [
        { kind: "image", metadata: image },
        { kind: "github_pr", item: prItem },
      ],
      encodeImages: passthroughEncodeImages,
      stream,
    });

    expect(client.calls).toHaveLength(1);
    const [call] = client.calls;
    expect(call.agentId).toBe("agent");
    expect(call.text).toBe("send attachments");
    expect(call.options.images).toEqual([{ data: image.id, mimeType: image.mimeType }]);
    expect(call.options.attachments).toEqual([
      {
        type: "github_pr",
        mimeType: "application/github-pr",
        number: 202,
        title: "Refactor composer attachments",
        url: "https://github.com/acme/thoth/pull/202",
        body: "PR body",
        baseRefName: "main",
        headRefName: "composer-attachments",
      },
    ]);

    expect(stream.head.get("agent")).toBeUndefined();
    const tail = stream.tail.get("agent");
    expect(tail).toHaveLength(1);
    const userMessage = tail?.[0] as Extract<StreamItem, { kind: "user_message" }>;
    expect(userMessage.kind).toBe("user_message");
    expect(userMessage.text).toBe("send attachments");
    expect(userMessage.images).toEqual([image]);
    expect(userMessage.attachments).toEqual(call.options.attachments);
    expect(userMessage.id).toBe(call.options.messageId);
    expect(userMessage.optimistic).toBe(true);
  });

  it("appends to the existing head when one is present", async () => {
    const existingItem: StreamItem = {
      kind: "user_message",
      id: "prior",
      text: "prior",
      timestamp: new Date(0),
    };
    const stream = createFakeStream(new Map([["agent", [existingItem]]]));
    const client = createFakeSendClient();

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "next message",
      attachments: [],
      encodeImages: passthroughEncodeImages,
      stream,
    });

    expect(stream.head.get("agent")).toHaveLength(2);
    expect(stream.tail.get("agent")).toBeUndefined();
  });

  it("submits empty wire arrays when no attachments are provided", async () => {
    const client = createFakeSendClient();
    const stream = createFakeStream();

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "plain message",
      attachments: [],
      encodeImages: passthroughEncodeImages,
      stream,
    });

    expect(client.calls[0]?.options).toMatchObject({
      images: [],
      attachments: [],
    });
  });

  it("serializes workspace review attachments through the structured attachment path", async () => {
    const client = createFakeSendClient();
    const stream = createFakeStream();
    const review = reviewWorkspaceAttachment("Please simplify this.");

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "review this",
      attachments: [review],
      encodeImages: passthroughEncodeImages,
      stream,
    });

    expect(client.calls[0]?.options.attachments).toEqual([review.attachment]);
    expect(client.calls[0]?.options.images).toEqual([]);
  });

  it("serializes browser_element workspace attachments as text attachments at the wire boundary", async () => {
    const client = createFakeSendClient();
    const stream = createFakeStream();
    const browserElement = browserElementWorkspaceAttachment();

    await dispatchComposerAgentMessage({
      client,
      agentId: "agent",
      text: "inspect element",
      attachments: [browserElement],
      encodeImages: passthroughEncodeImages,
      stream,
    });

    expect(client.calls[0]?.options.attachments).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        title: "Browser element · button",
        text: browserElement.attachment.formatted,
      },
    ]);
  });
});

describe("dispatchWorkspaceSecretaryMessage", () => {
  it("reconciles canonical authority cards without retaining cards from another topic", () => {
    const model = createSecretaryModel();
    model.secretary.turns = [
      {
        id: "turn-current-card",
        kind: "clarify_card",
        card: {
          id: "current-card",
          roundLabel: "Clarify 1",
          title: "当前话题卡片",
          whyNow: "当前话题需要确认。",
          continuesClarify: true,
          submitted: false,
          card: {
            question_id: "question-current",
            title: "当前话题卡片",
            behavior_tree_node: "current",
            why_now: "当前话题需要确认。",
            questions: [
              {
                id: "scope",
                question: "当前范围？",
                choices: [{ id: "one", label: "当前", description: "当前话题" }],
              },
            ],
          },
        },
      },
    ];
    const staleCard: StreamItem = {
      kind: "clarify_card",
      id: "clarify_stale-card",
      timestamp: new Date(1),
      card: {
        ...model.secretary.turns[0]!.card,
        id: "stale-card",
        title: "旧话题卡片",
      },
    };
    const runningTool: StreamItem = {
      kind: "tool_call",
      id: "agent_tool_shell-1",
      timestamp: new Date(2),
      payload: {
        source: "agent",
        data: {
          provider: "codex",
          callId: "shell-1",
          name: "Shell",
          status: "running",
          error: null,
          detail: { type: "shell", command: "npm test", cwd: "/repo" },
        },
      },
    };
    const stream = createFakeStream();
    stream.tail.set("agent", [staleCard, runningTool]);

    applyWorkspaceSecretaryModelToStream("agent", model, stream);

    const tail = stream.tail.get("agent") ?? [];
    expect(tail.filter((item) => item.kind === "clarify_card").map((item) => item.id)).toEqual([
      "clarify_current-card",
    ]);
    expect(tail).toContainEqual(runningTool);
  });

  it("settles retained running timeline items when the user cancels a secretary turn", () => {
    const model = createSecretaryModel();
    const runningTool: StreamItem = {
      kind: "tool_call",
      id: "agent_tool_shell-cancel",
      timestamp: new Date(2),
      payload: {
        source: "agent",
        data: {
          provider: "codex",
          callId: "shell-cancel",
          name: "Shell",
          status: "running",
          error: null,
          detail: { type: "shell", command: "npm test", cwd: "/repo" },
        },
      },
    };
    const runningThought: StreamItem = {
      kind: "thought",
      id: "thought-cancel",
      text: "正在分析",
      status: "loading",
      timestamp: new Date(2),
    };
    const stream = createFakeStream();
    stream.tail.set("agent", [runningTool, runningThought]);

    applyWorkspaceSecretaryModelToStream("agent", model, stream, {
      settleRunningItems: true,
    });

    const tail = stream.tail.get("agent") ?? [];
    const settledTool = tail.find((item) => item.id === runningTool.id);
    const settledThought = tail.find((item) => item.id === runningThought.id);
    expect(settledTool).toMatchObject({
      kind: "tool_call",
      payload: { data: { status: "canceled" } },
    });
    expect(settledThought).toMatchObject({ kind: "thought", status: "ready" });
  });

  it("flushes Plan+Exec head items into history before a cancel model can replace the timeline", () => {
    const model = createSecretaryModel();
    const planText: StreamItem = {
      kind: "assistant_message",
      id: "plan-exec-message",
      messageId: "plan-exec-message",
      text: "我会先检查现有渲染管线。",
      timestamp: new Date(101),
    };
    const planThought: StreamItem = {
      kind: "thought",
      id: "plan-exec-thought",
      text: "正在比较可复用的实现入口。",
      status: "loading",
      timestamp: new Date(102),
    };
    const runningTool: StreamItem = {
      kind: "tool_call",
      id: "agent_tool_plan-exec-shell",
      timestamp: new Date(103),
      payload: {
        source: "agent",
        data: {
          provider: "codex",
          callId: "plan-exec-shell",
          name: "Shell",
          status: "running",
          error: null,
          detail: { type: "shell", command: "rg --files", cwd: "/repo" },
        },
      },
    };
    const durableUser: StreamItem = {
      kind: "user_message",
      id: "secretary_user_user-1",
      text: "实现一个渲染器",
      timestamp: new Date(100),
    };
    const stream = createFakeStream(new Map([["agent", [planText, planThought, runningTool]]]));
    stream.tail.set("agent", [durableUser]);

    applyWorkspaceSecretaryModelToStream("agent", model, stream, {
      settleRunningItems: true,
    });

    const tail = stream.tail.get("agent") ?? [];
    expect(stream.head.get("agent")).toBeUndefined();
    expect(tail.map((item) => item.id)).toEqual(
      expect.arrayContaining([planText.id, planThought.id, runningTool.id]),
    );
    expect(tail.find((item) => item.id === planText.id)).toMatchObject({
      kind: "assistant_message",
      text: planText.text,
    });
    expect(tail.find((item) => item.id === planThought.id)).toMatchObject({
      kind: "thought",
      status: "ready",
    });
    expect(tail.find((item) => item.id === runningTool.id)).toMatchObject({
      kind: "tool_call",
      payload: { data: { status: "canceled" } },
    });
    expect(tail.find((item) => item.id === durableUser.id)?.timestamp.getTime()).toBe(100);
  });

  it("restores a legacy wrapped user prompt at its original position with a different provider id", () => {
    const model = createSecretaryModel();
    model.secretary.turns = [
      {
        id: "user-persisted",
        kind: "message",
        speaker: "user",
        text: "实现一个渲染器",
        messageId: "user-message-1",
      },
      {
        id: "goal-card-persisted",
        kind: "goal_card",
        card: {
          id: "goals-1",
          roundLabel: "Goals",
          title: "线性目标",
          goals: [
            {
              id: "g1",
              order: 1,
              title: "实现渲染核心",
              goal: "完成核心渲染路径。",
              constraints: ["保持当前接口。"],
              acceptance: ["核心测试通过。"],
            },
          ],
          provenanceSummary: "基于确认的任务。",
          submitted: true,
          submittedSummary: "已确认前台执行。",
        },
      },
    ];
    const stream = createFakeStream();

    hydrateWorkspaceSecretaryProviderTimeline({
      agentId: "secretary-draft",
      model,
      entries: [
        {
          provider: "opencode",
          timestamp: "2026-07-12T16:00:00.000Z",
          item: {
            type: "user_message",
            messageId: "provider-native-wrapper-id",
            text: [
              "Thoth structured Workspace Secretary turn.",
              "",
              "Runtime context follows.",
              "",
              JSON.stringify({
                type: "workspace_secretary_runtime_context",
                user_input: "实现一个渲染器",
              }),
            ].join("\n"),
          },
        },
        {
          provider: "opencode",
          timestamp: "2026-07-12T16:00:01.000Z",
          item: {
            type: "assistant_message",
            messageId: "plan-exec-message",
            text: "先检查现有渲染路径。",
          },
        },
        {
          provider: "opencode",
          timestamp: "2026-07-12T16:00:02.000Z",
          item: {
            type: "goal_card",
            card: { ...model.secretary.turns[1]!.card, submitted: false },
          },
        },
        {
          provider: "opencode",
          timestamp: "2026-07-12T16:00:03.000Z",
          item: {
            type: "user_message",
            text: "You are the Thoth Quick foreground Plan+Exec agent.",
          },
        },
        {
          provider: "codex",
          timestamp: "2026-07-12T16:00:04.000Z",
          item: {
            type: "tool_call",
            callId: "shell-1",
            name: "Shell",
            status: "completed",
            error: null,
            detail: { type: "shell", command: "rg --files", cwd: "/repo" },
          },
        },
      ],
      stream,
    });

    const tail = stream.tail.get("secretary-draft") ?? [];
    expect(tail.map((item) => item.kind)).toEqual([
      "user_message",
      "assistant_message",
      "goal_card",
      "tool_call",
    ]);
    expect(tail[0]).toMatchObject({
      id: "user-message-1",
      text: "实现一个渲染器",
    });
    expect(tail.find((item) => item.kind === "goal_card")).toMatchObject({
      card: { submitted: true, submittedSummary: "已确认前台执行。" },
    });
    expect(JSON.stringify(tail)).not.toContain("Thoth structured Workspace Secretary turn");
    expect(JSON.stringify(tail)).not.toContain("Quick foreground Plan+Exec agent");
    expect(tail[0]?.timestamp.toISOString()).toBe("2026-07-12T16:00:00.000Z");
    expect(tail.at(-1)?.kind).toBe("tool_call");
  });

  it.each(["claude", "opencode", "acp.local"])(
    "uses the daemon-owned stable user message for %s instead of trusting provider replay shape",
    (provider) => {
      const model = createSecretaryModel();
      model.secretary.turns = [
        {
          id: "user-persisted",
          kind: "message",
          speaker: "user",
          text: "实现一个渲染器",
          messageId: "stable-ui-message-1",
        },
      ];
      const stream = createFakeStream();

      hydrateWorkspaceSecretaryProviderTimeline({
        agentId: "secretary-draft",
        model,
        entries: [
          {
            provider,
            timestamp: "2026-07-12T16:00:00.000Z",
            item: {
              type: "user_message",
              messageId: "stable-ui-message-1",
              text: "实现一个渲染器",
            },
          },
          {
            provider,
            timestamp: "2026-07-12T16:00:00.001Z",
            item: {
              type: "user_message",
              messageId: `${provider}-native-prompt-id`,
              text: `provider-specific serialized prompt for ${provider}`,
            },
          },
          {
            provider,
            timestamp: "2026-07-12T16:00:01.000Z",
            item: { type: "assistant_message", messageId: "assistant-1", text: "已收到。" },
          },
        ],
        stream,
      });

      const tail = stream.tail.get("secretary-draft") ?? [];
      expect(tail.map((item) => item.id)).toEqual(["stable-ui-message-1", "assistant-1"]);
      expect(JSON.stringify(tail)).not.toContain("provider-specific serialized prompt");
    },
  );

  it("keeps repeated identical user prompts in their provider chronology after hydration", () => {
    const model = createSecretaryModel();
    model.secretary.turns = [
      {
        id: "user-first",
        kind: "message",
        speaker: "user",
        text: "实现一个渲染器",
        messageId: "client-first",
      },
      {
        id: "user-second",
        kind: "message",
        speaker: "user",
        text: "实现一个渲染器",
        messageId: "client-second",
      },
    ];
    const wrapper = (nativeMessageId: string) => ({
      type: "user_message" as const,
      messageId: nativeMessageId,
      text: [
        "Thoth structured Workspace Secretary turn.",
        "",
        "Runtime context follows.",
        "",
        JSON.stringify({
          type: "workspace_secretary_runtime_context",
          user_input: "实现一个渲染器",
        }),
      ].join("\n"),
    });
    const stream = createFakeStream();

    hydrateWorkspaceSecretaryProviderTimeline({
      agentId: "secretary-draft",
      model,
      entries: [
        {
          provider: "claude",
          timestamp: "2026-07-12T16:00:00.000Z",
          item: wrapper("provider-first"),
        },
        {
          provider: "claude",
          timestamp: "2026-07-12T16:00:01.000Z",
          item: { type: "assistant_message", messageId: "assistant-first", text: "第一轮。" },
        },
        {
          provider: "acp.local",
          timestamp: "2026-07-12T16:01:00.000Z",
          item: wrapper("provider-second"),
        },
        {
          provider: "acp.local",
          timestamp: "2026-07-12T16:01:01.000Z",
          item: { type: "assistant_message", messageId: "assistant-second", text: "第二轮。" },
        },
      ],
      stream,
    });

    const tail = stream.tail.get("secretary-draft") ?? [];
    expect(tail.map((item) => item.id)).toEqual([
      "client-first",
      "assistant-first",
      "client-second",
      "assistant-second",
    ]);
    expect(tail.filter((item) => item.kind === "user_message")).toHaveLength(2);
    expect(tail.at(-1)).toMatchObject({ kind: "assistant_message", text: "第二轮。" });
  });

  it("keeps an optimistic user message until the matching canonical secretary turn arrives", () => {
    const model = createSecretaryModel();
    model.secretary.turns = [];
    const optimisticUser: StreamItem = {
      kind: "user_message",
      id: "optimistic-current",
      text: "实现随机数生成器",
      timestamp: new Date(1),
      optimistic: true,
    };
    const stream = createFakeStream(new Map([["agent", [optimisticUser]]]));

    applyWorkspaceSecretaryModelToStream("agent", model, stream);
    expect(stream.head.get("agent")).toEqual([optimisticUser]);

    model.secretary.turns = [
      {
        id: "user-canonical",
        kind: "message",
        speaker: "user",
        text: "实现随机数生成器",
      },
    ];
    applyWorkspaceSecretaryModelToStream("agent", model, stream);

    expect(stream.head.get("agent")).toBeUndefined();
    expect(stream.tail.get("agent")).toMatchObject([
      {
        kind: "user_message",
        id: "secretary_user_user-canonical",
        text: "实现随机数生成器",
      },
    ]);
  });

  it("removes only items projected by a mismatched topic snapshot", () => {
    const staleModel = createSecretaryModel();
    staleModel.secretary.turns = [
      {
        id: "stale-turn",
        kind: "clarify_card",
        card: {
          id: "stale-card",
          roundLabel: "Clarify 1",
          title: "旧话题卡片",
          whyNow: "旧话题。",
          continuesClarify: true,
          submitted: false,
          card: {
            question_id: "stale-question",
            title: "旧话题卡片",
            behavior_tree_node: "stale",
            why_now: "旧话题。",
            questions: [
              {
                id: "stale-scope",
                question: "旧范围？",
                choices: [{ id: "old", label: "旧", description: "旧话题" }],
              },
            ],
          },
        },
      },
    ];
    const currentCard: StreamItem = {
      kind: "clarify_card",
      id: "clarify_current-card",
      timestamp: new Date(2),
      card: {
        ...(
          staleModel.secretary.turns[0] as Extract<
            (typeof staleModel.secretary.turns)[number],
            { kind: "clarify_card" }
          >
        ).card,
        id: "current-card",
        title: "当前话题卡片",
      },
    };
    const staleCard: StreamItem = {
      kind: "clarify_card",
      id: "clarify_stale-card",
      timestamp: new Date(1),
      card: (
        staleModel.secretary.turns[0] as Extract<
          (typeof staleModel.secretary.turns)[number],
          { kind: "clarify_card" }
        >
      ).card,
    };
    const stream = createFakeStream();
    stream.tail.set("agent", [staleCard, currentCard]);

    removeWorkspaceSecretaryModelItemsFromStream("agent", staleModel, stream);

    expect(stream.tail.get("agent")?.map((item) => item.id)).toEqual(["clarify_current-card"]);
  });

  it("sends text, images, and structured attachments through Workspace Secretary and merges clean turns", async () => {
    const client = createFakeSecretaryClient();
    const stream = createFakeStream();
    const image = imageWithId("img-secretary");

    await dispatchWorkspaceSecretaryMessage({
      client,
      agentId: "agent",
      workspaceId: "workspace-1",
      workspacePath: "/workspace/thoth",
      topicId: "topic-main",
      text: "clarify this",
      attachments: [
        { kind: "image", metadata: image },
        { kind: "github_pr", item: prItem },
      ],
      composer: {
        mode: "quick",
        clarifyStrength: "light",
        loop: null,
        authorityLabel: "codex",
        authorityReady: true,
      },
      encodeImages: passthroughEncodeImages,
      stream,
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      workspaceId: "workspace-1",
      workspacePath: "/workspace/thoth",
      topicId: "topic-main",
      text: "clarify this",
      images: [{ data: image.id, mimeType: image.mimeType }],
      attachments: [
        expect.objectContaining({
          type: "github_pr",
          number: 202,
        }),
      ],
    });
    expect(client.calls[0]?.messageId).toBeTruthy();
    const tail = stream.tail.get("agent") ?? [];
    expect(tail.map((item) => item.kind)).toEqual(["user_message", "assistant_message"]);
    expect((tail[1] as Extract<StreamItem, { kind: "assistant_message" }>).text).toBe(
      "需要先确认目标。",
    );
  });

  it("does not use Workspace Secretary liveEvents as the realtime timeline source", async () => {
    const model = createSecretaryModel();
    model.secretary.turns = [];
    model.secretary.deprecatedLiveEvents = [
      {
        id: "evt-start",
        kind: "provider_turn_started",
        title: "真实 provider 回合已开始",
        detail: "正在处理用户输入。",
        status: "running",
      },
      {
        id: "evt-tool",
        kind: "provider_tool",
        title: "provider 正在调用工具",
        detail: "npm test",
        status: "running",
      },
      {
        id: "evt-draft",
        kind: "secretary_reply_delta",
        title: "秘书正在起草回复",
        detail: "我正在检查边界。",
        status: "running",
      },
    ];
    const client = createFakeSecretaryClient(model);
    const stream = createFakeStream();

    await dispatchWorkspaceSecretaryMessage({
      client,
      agentId: "agent",
      text: "clarify this",
      attachments: [],
      composer: {
        mode: "quick",
        clarifyStrength: "dive",
        loop: null,
        authorityLabel: "codex",
        authorityReady: true,
      },
      encodeImages: passthroughEncodeImages,
      stream,
    });

    expect(stream.tail.get("agent")?.map((item) => item.kind)).toEqual(["user_message"]);
  });

  it("preserves live AgentTimeline head items when merging Workspace Secretary clean turns", async () => {
    const client = createFakeSecretaryClient();
    const runningTool: StreamItem = {
      kind: "tool_call",
      id: "agent_tool_shell-1",
      timestamp: new Date(1),
      payload: {
        source: "agent",
        data: {
          provider: "codex",
          callId: "shell-1",
          name: "CodexBash",
          status: "running",
          error: null,
          detail: {
            type: "shell",
            command: "npm test",
            cwd: "/repo",
          },
        },
      },
    };
    const liveAssistant: StreamItem = {
      kind: "assistant_message",
      id: "assistant-live",
      messageId: "assistant-live",
      text: "continuing",
      timestamp: new Date(2),
    };
    const stream = createFakeStream(new Map([["agent", [runningTool, liveAssistant]]]));

    await dispatchWorkspaceSecretaryMessage({
      client,
      agentId: "agent",
      text: "clarify this",
      attachments: [],
      composer: {
        mode: "quick",
        clarifyStrength: "dive",
        loop: null,
        authorityLabel: "codex",
        authorityReady: true,
      },
      encodeImages: passthroughEncodeImages,
      stream,
    });

    expect(stream.head.get("agent")).toEqual([runningTool, liveAssistant]);
    expect(stream.tail.get("agent")?.map((item) => item.kind)).toEqual([
      "user_message",
      "assistant_message",
    ]);
  });

  it("cancels the Workspace Secretary provider turn with the draft ui agent id", async () => {
    const client = createFakeSecretaryClient();
    const stream = createFakeStream();

    await dispatchWorkspaceSecretaryCancel({
      client,
      agentId: "draft-secretary",
      workspaceId: "workspace-1",
      workspacePath: "/workspace/thoth",
      topicId: "topic-main",
      stream,
    });

    expect(client.cancelCalls).toEqual([
      {
        workspaceId: "workspace-1",
        workspacePath: "/workspace/thoth",
        topicId: "topic-main",
        uiAgentId: "draft-secretary",
      },
    ]);
    expect(stream.tail.get("draft-secretary")?.map((item) => item.kind)).toEqual([
      "user_message",
      "assistant_message",
    ]);
  });

  it("binds authority card answers to the originating workspace topic", async () => {
    const client = createFakeSecretaryClient();
    const stream = createFakeStream();
    const answer: WorkspaceSecretaryTurnActionPayload = {
      intent: "stop",
      question_card_id: "question-card-1",
      title: "Clarify",
      answers: [],
      raw_answer: "暂停继续询问",
    };

    await dispatchWorkspaceSecretaryAnswer({
      client,
      agentId: "draft-secretary",
      workspaceId: "workspace-1",
      workspacePath: "/workspace/thoth",
      topicId: "topic-main",
      cardId: "clarify-card-1",
      answer,
      stream,
    });

    expect(client.answerCalls).toEqual([
      {
        workspaceId: "workspace-1",
        workspacePath: "/workspace/thoth",
        topicId: "topic-main",
        uiAgentId: "draft-secretary",
        cardId: "clarify-card-1",
        answer,
      },
    ]);
  });
});

describe("queueComposerMessage", () => {
  it("queues a trimmed message under the agent id and returns the new entry", () => {
    const queue = createFakeQueue();
    const result = queueComposerMessage({
      agentId: "agent",
      text: "  draft  ",
      attachments: [],
      queue,
    });

    expect(result.queued?.text).toBe("draft");
    expect(queue.state.get("agent")).toEqual([
      { id: result.queued?.id, text: "draft", attachments: [] },
    ]);
  });

  it("does not queue an empty message with no attachments", () => {
    const queue = createFakeQueue();
    const result = queueComposerMessage({
      agentId: "agent",
      text: "   ",
      attachments: [],
      queue,
    });
    expect(result.queued).toBeNull();
    expect(queue.state.get("agent")).toBeUndefined();
  });

  it("captures workspace review attachments at queue time alongside user attachments", () => {
    const queue = createFakeQueue();
    const review = reviewWorkspaceAttachment("Initial queued review.");
    const image = imageWithId("img-queue");
    queueComposerMessage({
      agentId: "agent",
      text: "queue this",
      attachments: [{ kind: "image", metadata: image }, review],
      queue,
    });

    expect(queue.state.get("agent")?.[0]?.attachments).toEqual([
      { kind: "image", metadata: image },
      review,
    ]);
  });
});

describe("editQueuedComposerMessage", () => {
  it("returns null and leaves the queue untouched when the message id is missing", () => {
    const queue = createFakeQueue(
      new Map([["agent", [{ id: "other", text: "other", attachments: [] }]]]),
    );
    const result = editQueuedComposerMessage({ agentId: "agent", messageId: "missing", queue });
    expect(result).toBeNull();
    expect(queue.state.get("agent")).toHaveLength(1);
  });

  it("returns the text and only user attachments, removing the queued entry", () => {
    const review = reviewWorkspaceAttachment("Queued snapshot.");
    const image = imageWithId("img-queued-edit");
    const queue = createFakeQueue(
      new Map([
        [
          "agent",
          [
            {
              id: "msg-1",
              text: "queued draft",
              attachments: [{ kind: "image", metadata: image }, review],
            },
          ],
        ],
      ]),
    );

    const result = editQueuedComposerMessage({ agentId: "agent", messageId: "msg-1", queue });
    expect(result).toEqual({
      text: "queued draft",
      attachments: [{ kind: "image", metadata: image }],
    });
    expect(queue.state.get("agent")).toEqual([]);
  });
});

describe("sendQueuedComposerMessageNow", () => {
  it("returns missing without submitting when the message id is gone", async () => {
    const queue = createFakeQueue();
    const submitted: Array<{ text: string; attachments: ComposerAttachment[] }> = [];
    const result = await sendQueuedComposerMessageNow({
      agentId: "agent",
      messageId: "msg-1",
      queue,
      submitMessage: async (input) => {
        submitted.push(input);
      },
    });
    expect(result).toEqual({ status: "missing" });
    expect(submitted).toEqual([]);
  });

  it("removes the queued entry and submits its text + attachments", async () => {
    const review = reviewWorkspaceAttachment("Queued for send.");
    const queue = createFakeQueue(
      new Map([["agent", [{ id: "msg-1", text: "send me", attachments: [review] }]]]),
    );
    const submitted: Array<{ text: string; attachments: ComposerAttachment[] }> = [];
    const result = await sendQueuedComposerMessageNow({
      agentId: "agent",
      messageId: "msg-1",
      queue,
      submitMessage: async (input) => {
        submitted.push(input);
      },
    });
    expect(result).toEqual({ status: "submitted" });
    expect(queue.state.get("agent")).toEqual([]);
    expect(submitted).toEqual([{ text: "send me", attachments: [review] }]);
  });

  it("restores the queued entry to the front and surfaces the error message on failure", async () => {
    const queue = createFakeQueue(
      new Map([
        [
          "agent",
          [
            { id: "msg-1", text: "first", attachments: [] },
            { id: "msg-2", text: "second", attachments: [] },
          ],
        ],
      ]),
    );
    const result = await sendQueuedComposerMessageNow({
      agentId: "agent",
      messageId: "msg-1",
      queue,
      submitMessage: async () => {
        throw new Error("network down");
      },
    });
    expect(result).toEqual({ status: "failed", errorMessage: "network down" });
    const state = queue.state.get("agent");
    expect(state?.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
  });
});

describe("removeComposerAttachmentAtIndex", () => {
  it("removes an image attachment and asks the persister to delete the underlying metadata", () => {
    const image = imageWithId("img-remove");
    const persister = createFakePersister();
    const next = removeComposerAttachmentAtIndex({
      attachments: [{ kind: "image", metadata: image }] satisfies UserComposerAttachment[],
      index: 0,
      deleteAttachments: persister.deleteAttachments,
    });
    expect(next).toEqual([]);
    expect(persister.deletedBatches).toEqual([[image]]);
  });

  it("removes a github attachment without scheduling any storage deletes", () => {
    const persister = createFakePersister();
    const next = removeComposerAttachmentAtIndex({
      attachments: [
        { kind: "github_issue", item: issueItem },
        { kind: "github_pr", item: prItem },
      ] satisfies UserComposerAttachment[],
      index: 0,
      deleteAttachments: persister.deleteAttachments,
    });
    expect(next).toEqual([{ kind: "github_pr", item: prItem }]);
    expect(persister.deletedBatches).toEqual([]);
  });
});

describe("openComposerAttachment", () => {
  it("opens the lightbox for image attachments", () => {
    const image = imageWithId("img-body");
    const lightboxCalls: AttachmentMetadata[] = [];
    const externalUrlCalls: string[] = [];
    openComposerAttachment({
      attachment: { kind: "image", metadata: image },
      setLightboxMetadata: (metadata) => {
        lightboxCalls.push(metadata);
      },
      openWorkspaceAttachment: () => false,
      openExternalUrl: (url) => {
        externalUrlCalls.push(url);
      },
    });
    expect(lightboxCalls).toEqual([image]);
    expect(externalUrlCalls).toEqual([]);
  });

  it("delegates workspace review attachments to the workspace opener", () => {
    const review = reviewWorkspaceAttachment("Open me.");
    const workspaceCalls: ComposerAttachment[] = [];
    openComposerAttachment({
      attachment: review,
      setLightboxMetadata: () => {
        throw new Error("unexpected lightbox call");
      },
      openWorkspaceAttachment: ({ attachment }) => {
        workspaceCalls.push(attachment);
        return true;
      },
      openExternalUrl: () => {
        throw new Error("unexpected external url call");
      },
    });
    expect(workspaceCalls).toEqual([review]);
  });

  it("opens GitHub item URLs through the external url opener", () => {
    const externalUrlCalls: string[] = [];
    openComposerAttachment({
      attachment: { kind: "github_issue", item: issueItem },
      setLightboxMetadata: () => {
        throw new Error("unexpected lightbox call");
      },
      openWorkspaceAttachment: () => false,
      openExternalUrl: (url) => {
        externalUrlCalls.push(url);
      },
    });
    expect(externalUrlCalls).toEqual([issueItem.url]);
  });
});

describe("toggleGithubAttachment", () => {
  it("appends a GitHub issue when not already attached", () => {
    const next = toggleGithubAttachment([], issueItem);
    expect(next).toEqual([{ kind: "github_issue", item: issueItem }]);
  });

  it("appends a GitHub PR when not already attached", () => {
    const next = toggleGithubAttachment([], prItem);
    expect(next).toEqual([{ kind: "github_pr", item: prItem }]);
  });

  it("removes an existing GitHub item with the same kind+number", () => {
    const next = toggleGithubAttachment([{ kind: "github_issue", item: issueItem }], issueItem);
    expect(next).toEqual([]);
  });

  it("does not affect other items with different kind or number", () => {
    const start: UserComposerAttachment[] = [
      { kind: "github_issue", item: issueItem },
      { kind: "github_pr", item: prItem },
    ];
    const otherIssue: GitHubSearchItem = { ...issueItem, number: 999 };
    const next = toggleGithubAttachment(start, otherIssue);
    expect(next).toEqual([
      { kind: "github_issue", item: issueItem },
      { kind: "github_pr", item: prItem },
      { kind: "github_issue", item: otherIssue },
    ]);
  });
});

describe("toggleGithubAttachmentFromPicker", () => {
  it("marks an existing GitHub item as removed when picker toggle removes it", () => {
    const markGithubAttachmentRemoved = vi.fn();
    const attachment: UserComposerAttachment = { kind: "github_pr", item: prItem };

    const next = toggleGithubAttachmentFromPicker({
      current: [attachment],
      item: prItem,
      markGithubAttachmentRemoved,
    });

    expect(next).toEqual([]);
    expect(markGithubAttachmentRemoved).toHaveBeenCalledTimes(1);
    expect(markGithubAttachmentRemoved).toHaveBeenCalledWith(attachment);
  });

  it("does not mark a GitHub item removed when picker toggle adds it", () => {
    const markGithubAttachmentRemoved = vi.fn();

    const next = toggleGithubAttachmentFromPicker({
      current: [],
      item: issueItem,
      markGithubAttachmentRemoved,
    });

    expect(next).toEqual([{ kind: "github_issue", item: issueItem }]);
    expect(markGithubAttachmentRemoved).not.toHaveBeenCalled();
  });
});

describe("findGithubItemByOption / isAttachmentSelectedForGithubItem", () => {
  it("locates items via their composite kind:number id", () => {
    expect(findGithubItemByOption([issueItem, prItem], "issue:101")).toBe(issueItem);
    expect(findGithubItemByOption([issueItem, prItem], "pr:202")).toBe(prItem);
    expect(findGithubItemByOption([issueItem], "pr:404")).toBeUndefined();
  });

  it("recognizes when an attachment list already contains a matching GitHub item", () => {
    const attachments: ComposerAttachment[] = [
      { kind: "image", metadata: imageWithId("img-x") },
      { kind: "github_issue", item: issueItem },
      reviewWorkspaceAttachment("ignored"),
    ];
    expect(isAttachmentSelectedForGithubItem(attachments, issueItem)).toBe(true);
    expect(isAttachmentSelectedForGithubItem(attachments, prItem)).toBe(false);
  });
});
