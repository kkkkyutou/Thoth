/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeControls } from "./runtime-controls";

const { patchConfigMock, toastErrorMock, configState, theme } = vi.hoisted(() => ({
  patchConfigMock: vi.fn(async () => undefined),
  toastErrorMock: vi.fn(),
  configState: {
    current: {
      workspaceSecretary: {
        mode: "loop",
        clarifyStrength: "dive",
        loopStrength: "balanced",
      },
    },
  },
  theme: {
    spacing: { 1: 4, 2: 8 },
    borderRadius: { "2xl": 999 },
    fontSize: { sm: 13 },
    fontWeight: { normal: "400" },
    iconSize: { md: 16 },
    opacity: { 50: 0.5 },
    colors: {
      foreground: "#fff",
      foregroundMuted: "#aaa",
      surface0: "#000",
      surface2: "#222",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("lucide-react-native", () => ({
  ChevronLeft: () => React.createElement("span", { "data-icon": "ChevronLeft" }),
  ChevronRight: () => React.createElement("span", { "data-icon": "ChevronRight" }),
  GitBranch: () => React.createElement("span", { "data-icon": "GitBranch" }),
  SearchCheck: () => React.createElement("span", { "data-icon": "SearchCheck" }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values?.value ? `${key}:${values.value}` : key,
  }),
}));

vi.mock("@/hooks/use-daemon-config", () => ({
  useDaemonConfig: () => ({
    config: configState.current,
    patchConfig: patchConfigMock,
  }),
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => ({ error: toastErrorMock }),
}));

vi.mock("@/utils/error-messages", () => ({
  toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock("@/components/ui/dropdown-trigger", () => ({
  DropdownTrigger: React.forwardRef<
    HTMLButtonElement,
    React.PropsWithChildren<Record<string, unknown>>
  >(function DropdownTrigger({ children, onPress, disabled, testID, accessibilityLabel }, ref) {
    return React.createElement(
      "button",
      {
        ref,
        disabled: Boolean(disabled),
        "data-testid": testID,
        "aria-label": accessibilityLabel,
        onClick: onPress as React.MouseEventHandler<HTMLButtonElement>,
      },
      children,
    );
  }),
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children),
  DropdownMenuContent: ({ children, testID }: React.PropsWithChildren<{ testID?: string }>) =>
    React.createElement("div", { "data-testid": testID }, children),
  DropdownMenuLabel: ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
    selected,
    testID,
  }: React.PropsWithChildren<{
    onSelect?: () => void;
    disabled?: boolean;
    selected?: boolean;
    testID?: string;
  }>) =>
    React.createElement(
      "button",
      {
        "data-testid": testID,
        disabled: Boolean(disabled),
        "aria-selected": selected ? "true" : "false",
        onClick: onSelect,
      },
      children,
    ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
  TooltipTrigger: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
  TooltipContent: ({ children }: React.PropsWithChildren) =>
    React.createElement("div", null, children),
}));

vi.hoisted(() => {
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  configState.current = {
    workspaceSecretary: {
      mode: "loop",
      clarifyStrength: "dive",
      loopStrength: "balanced",
    },
  };
});

describe("RuntimeControls", () => {
  it("renders persisted Thoth clarify and mode controls", () => {
    render(<RuntimeControls serverId="server-1" />);

    expect(screen.getByTestId("thoth-clarify-control").textContent).toContain("Dive");
    expect(screen.getByTestId("thoth-mode-control").textContent).toContain("Balanced");
    expect(screen.getByTestId("thoth-mode-control").textContent).not.toContain("Async");
    expect(screen.getByTestId("thoth-clarify-menu-dive").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("thoth-mode-menu-loop").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("thoth-mode-menu-quick").textContent).toContain("Quick (Live)");
    expect(screen.getByTestId("thoth-mode-menu-loop").textContent).toContain("Loop (Async)");
    fireEvent.click(screen.getByTestId("thoth-mode-menu-loop"));
    expect(screen.getByTestId("thoth-mode-menu-back").textContent).toBe("Loop");
    expect(screen.getByTestId("thoth-mode-menu-loop-balanced").textContent).toBe("Balanced");
    expect(screen.getByTestId("thoth-mode-menu-loop-balanced").textContent).not.toContain("Async");
  });

  it("defaults loop mode to Single when no loop strength is persisted", () => {
    delete (configState.current.workspaceSecretary as { loopStrength?: string }).loopStrength;

    render(<RuntimeControls serverId="server-1" />);

    expect(screen.getByTestId("thoth-mode-control").textContent).toContain("Single");
    expect(screen.getByTestId("thoth-mode-control").textContent).not.toContain("Async");
  });

  it("renders Quick as a short selected label without Live detail", () => {
    configState.current.workspaceSecretary.mode = "quick";

    render(<RuntimeControls serverId="server-1" />);

    expect(screen.getByTestId("thoth-mode-control").textContent).toContain("Quick");
    expect(screen.getByTestId("thoth-mode-control").textContent).not.toContain("Live");
    expect(screen.getByTestId("thoth-mode-menu-quick").textContent).toContain("Quick (Live)");
  });

  it("patches only typed workspaceSecretary control fields", async () => {
    render(<RuntimeControls serverId="server-1" />);

    fireEvent.click(screen.getByTestId("thoth-clarify-menu-light"));
    fireEvent.click(screen.getByTestId("thoth-mode-menu-loop"));
    fireEvent.click(screen.getByTestId("thoth-mode-menu-loop-one_plan_one_do"));
    fireEvent.click(screen.getByTestId("thoth-mode-menu-back"));
    fireEvent.click(screen.getByTestId("thoth-mode-menu-quick"));

    await waitFor(() => expect(patchConfigMock).toHaveBeenCalledTimes(3));
    expect(patchConfigMock).toHaveBeenNthCalledWith(1, {
      workspaceSecretary: { clarifyStrength: "light" },
    });
    expect(patchConfigMock).toHaveBeenNthCalledWith(2, {
      workspaceSecretary: { mode: "loop", loopStrength: "one_plan_one_do" },
    });
    expect(patchConfigMock).toHaveBeenNthCalledWith(3, {
      workspaceSecretary: { mode: "quick" },
    });
  });

  it("renders Infinite with the laser label in the menu and chip", () => {
    configState.current.workspaceSecretary.loopStrength = "run_until_stopped";

    render(<RuntimeControls serverId="server-1" />);

    expect(screen.getByTestId("thoth-mode-control").textContent).toContain("Infinite");
    expect(screen.getByTestId("thoth-mode-control").textContent).not.toContain("Async");
    fireEvent.click(screen.getByTestId("thoth-mode-menu-loop"));
    expect(screen.getByTestId("thoth-mode-menu-loop-run_until_stopped").textContent).toBe(
      "Infinite",
    );
    expect(screen.getByTestId("thoth-mode-menu-loop-run_until_stopped").textContent).not.toContain(
      "Async",
    );
  });

  it("blocks writes without a real host connection", () => {
    render(<RuntimeControls serverId={null} />);

    fireEvent.click(screen.getByTestId("thoth-clarify-menu-light"));
    fireEvent.click(screen.getByTestId("thoth-mode-menu-quick"));

    expect(patchConfigMock).not.toHaveBeenCalled();
  });
});
