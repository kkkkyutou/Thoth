import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { buildDraftPanelDescriptor } from "@/panels/draft-panel-descriptor";

function TestIcon() {
  return null;
}

describe("buildDraftPanelDescriptor", () => {
  it("uses the initial prompt title and running loader bucket during create", () => {
    const descriptor = buildDraftPanelDescriptor({
      isCreating: true,
      pendingPrompt: "Build the dashboard",
      icon: TestIcon,
    });

    expect(descriptor).toMatchObject({
      label: "Build the dashboard",
      subtitle: "Creating agent",
      titleState: "ready",
      statusBucket: "running",
    });
  });

  it("falls back to the draft title for empty create prompts", () => {
    const descriptor = buildDraftPanelDescriptor({
      isCreating: true,
      pendingPrompt: "   ",
      icon: TestIcon,
    });

    expect(descriptor.label).toBe("New Agent");
  });

  it("keeps ordinary draft tabs labeled as new agents", () => {
    const descriptor = buildDraftPanelDescriptor({ isCreating: false, icon: TestIcon });

    expect(descriptor).toMatchObject({
      label: "New Agent",
      subtitle: "New Agent",
      titleState: "ready",
      statusBucket: null,
    });
  });

  it("uses a submitted Workspace Secretary draft title instead of the new-agent fallback", () => {
    const descriptor = buildDraftPanelDescriptor({
      isCreating: false,
      title: "实现高性能快速排序",
      icon: TestIcon,
    });

    expect(descriptor).toMatchObject({
      label: "实现高性能快速排序",
      subtitle: "实现高性能快速排序",
      titleState: "ready",
      statusBucket: null,
    });
  });

  it("keeps the pending create prompt above a stored draft title while creating", () => {
    const descriptor = buildDraftPanelDescriptor({
      isCreating: true,
      pendingPrompt: "Build the dashboard",
      title: "Older secretary title",
      icon: TestIcon,
    });

    expect(descriptor).toMatchObject({
      label: "Build the dashboard",
      subtitle: "Creating agent",
      statusBucket: "running",
    });
  });

  it("uses the active language for draft descriptor chrome", async () => {
    await i18n.changeLanguage("zh-CN");
    const idleDescriptor = buildDraftPanelDescriptor({
      isCreating: false,
      icon: TestIcon,
    });
    const creatingDescriptor = buildDraftPanelDescriptor({
      isCreating: true,
      pendingPrompt: "   ",
      icon: TestIcon,
    });

    expect(idleDescriptor).toMatchObject({
      label: "新建 Agent",
      subtitle: "新建 Agent",
    });
    expect(creatingDescriptor).toMatchObject({
      label: "新建 Agent",
      subtitle: "正在创建 Agent",
    });
    await i18n.changeLanguage("en");
  });
});
