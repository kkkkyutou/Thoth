import { describe, expect, it } from "vitest";
import {
  ClarifyRuntimePacketSchema,
  LoopRuntimePacketSchema,
  THOTH_CLARIFY_CODES,
  THOTH_LOOP_CODES,
  THOTH_RUNTIME_PACKET_FIELDS,
  ThothProviderInputEnvelopeSchema,
  ThothRuntimePacketSchema,
} from "./thoth-runtime-contract.js";

describe("thoth runtime contract", () => {
  it("keeps clarify and loop state code sets under ten entries", () => {
    expect(THOTH_CLARIFY_CODES).toHaveLength(7);
    expect(THOTH_LOOP_CODES).toHaveLength(8);
  });

  it("keeps runtime packet top-level fields compact", () => {
    expect(THOTH_RUNTIME_PACKET_FIELDS).toEqual([
      "type",
      "code",
      "session_id",
      "task_id",
      "content",
      "ui",
      "next",
      "errors",
    ]);
    expect(THOTH_RUNTIME_PACKET_FIELDS.length).toBeLessThan(10);
  });

  it("parses a direct quick clarify packet", () => {
    expect(
      ClarifyRuntimePacketSchema.parse({
        type: "clarify",
        code: "C_DIRECT",
        session_id: "sec_123",
        task_id: null,
        content: {
          message: "Hi. What should we work on in this workspace?",
          receipt: null,
        },
        ui: {
          kind: "message",
          text: "Hi. What should we work on in this workspace?",
        },
        next: "C_DIRECT",
        errors: [],
      }),
    ).toMatchObject({
      type: "clarify",
      code: "C_DIRECT",
      ui: { kind: "message" },
      next: "C_DIRECT",
    });
  });

  it("parses a two-step background task goal contract card", () => {
    const parsed = ClarifyRuntimePacketSchema.parse({
      type: "clarify",
      code: "C_GOAL_CARD",
      session_id: "sec_123",
      task_id: null,
      content: {
        title: "整理设置页账号安全区域",
        goals: [
          {
            title: "梳理当前安全入口",
            goal: "找出账号安全相关入口和分散点。",
            constraints: ["只读分析"],
            acceptance: ["列出入口、问题和归并建议"],
          },
        ],
      },
      ui: {
        kind: "goal_contract_card",
        title: "确认线性目标拆分",
      },
      next: "C_REGISTER",
      errors: [],
    });

    expect(parsed.content.goals).toHaveLength(1);
  });

  it("rejects extra runtime packet top-level fields", () => {
    expect(() =>
      ClarifyRuntimePacketSchema.parse({
        type: "clarify",
        code: "C_DIRECT",
        session_id: "sec_123",
        task_id: null,
        content: {},
        ui: { kind: "message" },
        next: "C_DIRECT",
        errors: [],
        debug: true,
      }),
    ).toThrow();
  });

  it("rejects clarify packets with loop UI kinds", () => {
    expect(() =>
      ClarifyRuntimePacketSchema.parse({
        type: "clarify",
        code: "C_DIRECT",
        session_id: "sec_123",
        task_id: null,
        content: {},
        ui: { kind: "goal_started" },
        next: "C_DIRECT",
        errors: [],
      }),
    ).toThrow();
  });

  it("requires loop cursor on active loop packets", () => {
    expect(() =>
      LoopRuntimePacketSchema.parse({
        type: "loop",
        code: "L_WORK",
        session_id: "loop_789",
        task_id: "task_456",
        content: {
          message: "正在调整安全区域的信息结构。",
        },
        ui: {
          kind: "progress",
          title: "正在执行 Goal 2",
        },
        next: "L_WORK",
        errors: [],
      }),
    ).toThrow();
  });

  it("parses loop progress with a compact goal and round cursor", () => {
    const parsed = LoopRuntimePacketSchema.parse({
      type: "loop",
      code: "L_WORK",
      session_id: "loop_789",
      task_id: "task_456",
      content: {
        cursor: { goal: 2, goals: 5, round: 1, rounds: 3 },
        message: "正在调整安全区域的信息结构。",
        evidence: [],
        changed: ["SettingsSecuritySection.tsx"],
      },
      ui: {
        kind: "progress",
        title: "正在执行 Goal 2",
      },
      next: "L_WORK",
      errors: [],
    });

    expect(parsed.content.cursor).toEqual({ goal: 2, goals: 5, round: 1, rounds: 3 });
  });

  it("rejects impossible loop cursor positions", () => {
    expect(() =>
      LoopRuntimePacketSchema.parse({
        type: "loop",
        code: "L_RETRY",
        session_id: "loop_789",
        task_id: "task_456",
        content: {
          cursor: { goal: 6, goals: 5, round: 4, rounds: 3 },
          failed: "移动宽度文本溢出。",
          change: "下一轮只修移动布局，并补移动截图。",
          avoid: ["不要只重复桌面截图验证"],
        },
        ui: {
          kind: "retry_card",
          title: "Starting round 4 / 3",
        },
        next: "L_START",
        errors: [],
      }),
    ).toThrow();
  });

  it("parses a matching clarify provider input envelope", () => {
    const parsed = ThothProviderInputEnvelopeSchema.parse({
      type: "provider_input",
      skill: "thoth.clarify",
      session_id: "sec_123",
      task_id: null,
      code: "C_DIRECT",
      controls: {
        mode: "quick",
        clarify: "none",
        loop: null,
      },
      input: "hi",
      inject: "none",
      expect: "clarify",
    });

    expect(parsed.skill).toBe("thoth.clarify");
    expect(parsed.code).toBe("C_DIRECT");
  });

  it("rejects envelopes whose skill and state code do not match", () => {
    expect(() =>
      ThothProviderInputEnvelopeSchema.parse({
        type: "provider_input",
        skill: "thoth.clarify",
        session_id: "sec_123",
        task_id: "task_456",
        code: "L_WORK",
        controls: {
          mode: "loop",
          clarify: "balanced",
          loop: "balanced",
        },
        input: "continue",
        inject: "state_refresh",
        expect: "clarify",
      }),
    ).toThrow();
  });

  it("parses either runtime packet through the union schema", () => {
    expect(
      ThothRuntimePacketSchema.parse({
        type: "loop",
        code: "L_TASK_DONE",
        session_id: "loop_789",
        task_id: "task_456",
        content: {
          summary: "所有目标已完成。",
        },
        ui: {
          kind: "task_done",
          title: "Task completed",
        },
        next: "L_TASK_DONE",
        errors: [],
      }).type,
    ).toBe("loop");
  });
});
