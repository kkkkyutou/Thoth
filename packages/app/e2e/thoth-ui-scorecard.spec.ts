import { mkdirSync } from "node:fs";
import path from "node:path";
import type { TestInfo } from "@playwright/test";
import { expect, test, type Page } from "./fixtures";
import { buildSettingsSectionRoute } from "../src/utils/host-routes";
import { gotoAppShell } from "./helpers/app";
import { expectComposerVisible } from "./helpers/composer";
import { clickNewChat, gotoWorkspace } from "./helpers/launcher";
import { getServerId } from "./helpers/server-id";

const captureDirectory =
  process.env.THOTH_UI_REVIEW_CAPTURE_DIR ??
  "/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-paseo-surface";

const forbiddenVisiblePatterns = [
  /Paseo/i,
  /WORKSPACE SECRETARY/i,
  /Workspace Secretary/i,
  /当前需求收敛/,
  /Quick 前台/,
  /真实 provider 已连接/,
  /Quick 和 Loop 都会通过真实 provider 结果写入历史/,
  /当前秘书话题/,
  /新秘书话题/,
  /provider-backed clean UI model/i,
  /C_DIRECT|C_ASK/,
  /\bpacket\b/i,
  /\brepair\b/i,
  /\bschema\b/i,
  /raw JSON/i,
  /provider role/i,
  /request_user_input/i,
  /AskUserQuestion/i,
  /127\.0\.0\.1:6767/,
  /localhost:6767/,
  /offer=/,
  /#offer=/,
  /pairingToken/,
  /credential/i,
];

const forbiddenToyTestIds = [
  "thoth-loop2-shell",
  "workspace-secretary-view",
  "thoth-main-navigation",
  "thoth-view-background-tasks",
  "background-tasks-view",
  "secretary-new-topic",
];

test.describe("Loop-2 restored Paseo surface scorecard", () => {
  test.beforeAll(() => {
    mkdirSync(captureDirectory, { recursive: true });
  });

  test("keeps the original open-project tile surface and removes toy shell entrypoints", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 960 });
    await gotoAppShell(page);

    await expect(page.getByTestId("open-project-submit")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("open-project-import-session")).toBeVisible();
    await expect(page.getByTestId("open-project-setup-providers")).toBeVisible();
    await expect(page.getByText("Add a project", { exact: true })).toBeVisible();
    await expect(page.getByText("Task control plane", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Preview surface", { exact: true })).toHaveCount(0);
    await expectNoToyShell(page);
    await expectHealthySurface(page);
    await capture(page, testInfo, "desktop-open-project-paseo-layout.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("open-project-submit")).toBeVisible({ timeout: 10_000 });
    await expectHealthySurface(page);
    await capture(page, testInfo, "mobile-open-project-paseo-layout.png");

    expect(pageErrors).toEqual([]);
  });

  test("retains workspace composer, provider controls, attachments and settings main path", async ({
    page,
    withWorkspace,
  }, testInfo) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const workspace = await withWorkspace({ prefix: "loop2-surface-" });
    await page.setViewportSize({ width: 1440, height: 960 });
    await gotoWorkspace(page, workspace.workspaceId);
    await expect(page.getByTestId("sidebar-sessions")).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`),
    ).toBeVisible();
    await expect(
      page.getByTestId("workspace-tabs-row").filter({ visible: true }).first(),
    ).toBeVisible();
    await clickNewChat(page);
    await expectComposerVisible(page, { timeout: 30_000 });

    await expect(
      page.getByTestId("message-input-root").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("message-input-attach-button").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("combined-model-selector").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Provider", { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("thoth-clarify-control").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("thoth-mode-control").filter({ visible: true }).first(),
    ).toBeVisible();
    await page.getByTestId("thoth-clarify-control").filter({ visible: true }).first().click();
    await page.getByTestId("thoth-clarify-menu-light").click();
    await expect(
      page.getByTestId("thoth-clarify-control").filter({ visible: true }).first(),
    ).toContainText("Light");
    await page.getByTestId("thoth-mode-control").filter({ visible: true }).first().click();
    await page.getByTestId("thoth-mode-menu-loop").click();
    await expect(
      page.getByTestId("thoth-mode-control").filter({ visible: true }).first(),
    ).toContainText("Loop");
    await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible();
    await expectNoToyShell(page);
    await expectHealthySurface(page);
    await capture(page, testInfo, "desktop-workspace-composer-paseo-surface.png");
    await capture(page, testInfo, "desktop-composer-provider-clarify-mode.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoWorkspace(page, workspace.workspaceId);
    await expectComposerVisible(page, { timeout: 30_000 });
    await expect(
      page.getByTestId("message-input-root").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("thoth-clarify-control").filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByTestId("thoth-mode-control").filter({ visible: true }).first(),
    ).toBeVisible();
    await expectHealthySurface(page);
    await capture(page, testInfo, "mobile-workspace-composer-paseo-surface.png");

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(buildSettingsSectionRoute("general"));
    await expect(page.getByTestId("settings-sidebar").or(page.getByText("Settings"))).toBeVisible({
      timeout: 30_000,
    });
    await expectHealthySurface(page);
    await capture(page, testInfo, "desktop-settings-paseo-surface.png");

    expect(pageErrors).toEqual([]);
  });
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const screenshotPath = path.join(captureDirectory, name);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach(name, {
    path: screenshotPath,
    contentType: "image/png",
  });
}

async function expectNoToyShell(page: Page) {
  for (const testId of forbiddenToyTestIds) {
    await expect(page.getByTestId(testId)).toHaveCount(0);
  }
}

async function expectHealthySurface(page: Page) {
  await expect
    .poll(
      async () => {
        const text = await page
          .locator("body")
          .innerText()
          .catch(() => "");
        return text.trim().length;
      },
      { timeout: 30_000 },
    )
    .toBeGreaterThan(40);

  const visibleText = await page.locator("body").innerText();
  for (const pattern of forbiddenVisiblePatterns) {
    expect(visibleText).not.toMatch(pattern);
  }
  expect(page.url()).not.toMatch(/6767|offer=|#offer=|pairingToken/);
}
