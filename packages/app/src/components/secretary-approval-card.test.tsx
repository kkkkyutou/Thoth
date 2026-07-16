/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThothApprovalGoalCardModel } from "@thoth/protocol/workspace-secretary/rpc-schemas";
import { SecretaryApprovalCard } from "./secretary-approval-card";

const { theme } = vi.hoisted(() => ({
  theme: {
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    borderWidth: { 1: 1 },
    borderRadius: { md: 6, lg: 8 },
    fontSize: { xs: 11, sm: 13, base: 15 },
    fontWeight: { semibold: "600" },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface0: "#000",
      surface1: "#111",
      border: "#444",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function goalsCard(): ThothApprovalGoalCardModel {
  return {
    id: "goals-card-1",
    roundLabel: "Goals",
    title: "线性目标",
    summary: "拆分为可验证的 milestones。",
    provenanceSummary: "来自已确认的 Task Card。",
    submitted: false,
    goals: [
      {
        id: "goal-1",
        order: 1,
        title: "核心实现",
        goal: "实现已确认的核心能力。",
        constraints: ["不扩大范围。"],
        acceptance: ["核心验收通过。"],
      },
    ],
  };
}

describe("SecretaryApprovalCard", () => {
  it("uses the card turn controls when the live composer has hot-switched", () => {
    const { rerender } = render(
      <SecretaryApprovalCard
        card={{
          ...goalsCard(),
          turnControls: {
            mode: "loop",
            clarifyStrength: "balanced",
            loop: "one_plan_one_do",
          },
        }}
        kind="goal"
        approvalMode="quick"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId("secretary-goal-accept-loop").textContent).toContain("确认注册");
    expect(screen.queryByTestId("secretary-goal-accept-quick")).toBeNull();

    rerender(
      <SecretaryApprovalCard
        card={{
          ...goalsCard(),
          turnControls: {
            mode: "quick",
            clarifyStrength: "balanced",
            loop: null,
          },
        }}
        kind="goal"
        approvalMode="loop"
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByTestId("secretary-goal-accept-quick").textContent).toContain("前台执行");
    expect(screen.queryByTestId("secretary-goal-accept-loop")).toBeNull();
  });

  it("only exposes background registration for a Loop Goals Card", async () => {
    const onSubmit = vi.fn();
    render(
      <SecretaryApprovalCard
        card={goalsCard()}
        kind="goal"
        approvalMode="loop"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByTestId("secretary-goal-accept-loop").textContent).toContain("确认注册");
    expect(screen.queryByTestId("secretary-goal-accept-quick")).toBeNull();

    fireEvent.click(screen.getByTestId("secretary-goal-accept-loop"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "accept_loop", card_id: "goals-card-1" }),
    );
  });

  it("only exposes foreground execution for a Quick Goals Card", async () => {
    const onSubmit = vi.fn();
    render(
      <SecretaryApprovalCard
        card={goalsCard()}
        kind="goal"
        approvalMode="quick"
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByTestId("secretary-goal-accept-quick").textContent).toContain("前台执行");
    expect(screen.queryByTestId("secretary-goal-accept-loop")).toBeNull();

    fireEvent.click(screen.getByTestId("secretary-goal-accept-quick"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "accept_quick", card_id: "goals-card-1" }),
    );
  });
});
