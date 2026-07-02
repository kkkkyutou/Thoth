import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {
    getFocusedWindow: () => null,
    fromWebContents: () => null,
  },
  Menu: {
    buildFromTemplate: (template: unknown) => template,
    setApplicationMenu: () => undefined,
  },
  ipcMain: {
    handle: () => undefined,
  },
}));

import { buildApplicationMenuTemplate } from "./menu";

function labels(template: ReturnType<typeof buildApplicationMenuTemplate>): string[] {
  return template.map((item) => String(item.label));
}

function submenuLabels(
  template: ReturnType<typeof buildApplicationMenuTemplate>,
  label: string,
): string[] {
  const item = template.find((entry) => entry.label === label);
  const submenu = Array.isArray(item?.submenu) ? item.submenu : [];
  return submenu.flatMap((entry) => ("label" in entry && entry.label ? [String(entry.label)] : []));
}

function submenuRoles(
  template: ReturnType<typeof buildApplicationMenuTemplate>,
  label: string,
): string[] {
  const item = template.find((entry) => entry.label === label);
  const submenu = Array.isArray(item?.submenu) ? item.submenu : [];
  return submenu.flatMap((entry) => ("role" in entry && entry.role ? [String(entry.role)] : []));
}

describe("buildApplicationMenuTemplate", () => {
  test("uses Thoth product navigation instead of a generic Electron menu shell", () => {
    const template = buildApplicationMenuTemplate({ onNewWindow: () => undefined });

    expect(labels(template)).toEqual([
      "Thoth",
      "File",
      "Workspace",
      "Task",
      "Provider",
      "View",
      "Window",
      "Help",
    ]);
    expect(labels(template)).not.toContain("Edit");
  });

  test("keeps unfinished product actions honest as disabled menu targets", () => {
    const template = buildApplicationMenuTemplate({ onNewWindow: () => undefined });

    expect(submenuLabels(template, "Workspace")).toEqual(
      expect.arrayContaining([
        "Open Workspace...",
        "Register Current Workspace",
        "Workspace Settings",
        "Context / Files",
        "Evidence Preview",
      ]),
    );
    expect(submenuLabels(template, "Task")).toEqual(
      expect.arrayContaining([
        "New Quick Conversation",
        "New Loop Task",
        "Clarify Contract",
        "Review Evidence",
        "Stop Current Loop",
      ]),
    );
    expect(submenuLabels(template, "Provider")).toEqual(
      expect.arrayContaining([
        "Provider Settings",
        "Refresh Provider Readiness",
        "Select Model",
        "Permission Mode",
      ]),
    );

    for (const section of ["Workspace", "Task", "Provider"] as const) {
      const item = template.find((entry) => entry.label === section);
      const submenu = Array.isArray(item?.submenu) ? item.submenu : [];
      for (const entry of submenu) {
        if ("label" in entry && entry.label) {
          expect(entry.enabled).toBe(false);
        }
      }
    }
  });

  test("preserves existing desktop window and view commands", () => {
    const template = buildApplicationMenuTemplate({ onNewWindow: () => undefined });

    expect(submenuLabels(template, "File")).toEqual(expect.arrayContaining(["New Window"]));
    expect(submenuLabels(template, "View")).toEqual(
      expect.arrayContaining(["Zoom In", "Zoom Out", "Actual Size", "Reload", "Force Reload"]),
    );
    expect(submenuRoles(template, "Window")).toEqual(expect.arrayContaining(["minimize", "zoom"]));
  });
});
