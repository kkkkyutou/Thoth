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
    },
  };
});

describe("RuntimeControls", () => {
  it("renders persisted Thoth clarify and mode controls", () => {
    render(<RuntimeControls serverId="server-1" />);

    expect(screen.getByTestId("thoth-clarify-control").textContent).toContain("Dive");
    expect(screen.getByTestId("thoth-mode-control").textContent).toContain("Loop");
    expect(screen.getByTestId("thoth-clarify-menu-dive").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByTestId("thoth-mode-menu-loop").getAttribute("aria-selected")).toBe("true");
  });

  it("patches only typed workspaceSecretary control fields", async () => {
    render(<RuntimeControls serverId="server-1" />);

    fireEvent.click(screen.getByTestId("thoth-clarify-menu-light"));
    fireEvent.click(screen.getByTestId("thoth-mode-menu-quick"));

    await waitFor(() => expect(patchConfigMock).toHaveBeenCalledTimes(2));
    expect(patchConfigMock).toHaveBeenNthCalledWith(1, {
      workspaceSecretary: { clarifyStrength: "light" },
    });
    expect(patchConfigMock).toHaveBeenNthCalledWith(2, {
      workspaceSecretary: { mode: "quick" },
    });
  });

  it("blocks writes without a real host connection", () => {
    render(<RuntimeControls serverId={null} />);

    fireEvent.click(screen.getByTestId("thoth-clarify-menu-light"));
    fireEvent.click(screen.getByTestId("thoth-mode-menu-quick"));

    expect(patchConfigMock).not.toHaveBeenCalled();
  });
});
