import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestInfo } from "@playwright/test";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { expect, test, type Page } from "./fixtures";
import { gotoAppShell, openSettings } from "./helpers/app";
import {
  expectAboutContent,
  expectHostProvidersCard,
  openSettingsHostSection,
  openSettingsSection,
} from "./helpers/settings";
import { getServerId } from "./helpers/server-id";
import { expectAppRoute } from "./helpers/route-assertions";

const captureDirectory = fileURLToPath(
  new URL("../../../docs/ui-review-captures/web-scorecard/", import.meta.url),
);

const forbiddenVisiblePatterns = [
  /Paseo/i,
  /127\.0\.0\.1:6767/,
  /localhost:6767/,
  /offer=/,
  /#offer=/,
  /pairingToken/,
  /thoth-relay-v3-client\./,
  /thoth\.relay\.token\./,
];

test.describe("New Thoth Web UI scorecard smoke", () => {
  test.beforeAll(() => {
    mkdirSync(captureDirectory, { recursive: true });
  });

  test("captures Home, Workspace and Settings surfaces without legacy or relay-token leakage", async ({
    page,
    withWorkspace,
  }, testInfo) => {
    test.setTimeout(360_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.setViewportSize({ width: 1440, height: 960 });
    await gotoAppShell(page);
    await expectAppRoute(page, buildOpenProjectRoute(), { timeout: 30_000 });
    await expect(page.getByText("One Thoth", { exact: true })).toBeVisible();
    await expect(page.getByText("Task control plane", { exact: true })).toBeVisible();
    await expect(page.getByText("Needs a registered workspace", { exact: true })).toBeVisible();
    await expect(page.getByText("Select a model first", { exact: true })).toBeVisible();
    await expect(page.getByText("Fresh pairing supported", { exact: true })).toBeVisible();
    await expect(page.getByText("Preview surface", { exact: true })).toBeVisible();
    await expect(page.getByTestId("open-project-submit")).toBeVisible();
    await expect(page.getByTestId("open-project-import-session")).toBeVisible();
    await expect(page.getByTestId("open-project-setup-providers")).toBeVisible();
    await expectHealthySurface(page);
    await capture(page, testInfo, "web-home-desktop.png");

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAppShell(page);
    await expectAppRoute(page, buildOpenProjectRoute(), { timeout: 30_000 });
    await expect(page.getByText("One Thoth", { exact: true })).toBeVisible();
    await expect(page.getByText("Task control plane", { exact: true })).toBeVisible();
    await expect(page.getByTestId("open-project-submit")).toBeVisible();
    await expectHealthySurface(page);
    await capture(page, testInfo, "web-home-mobile.png");

    await page.setViewportSize({ width: 1440, height: 960 });
    const workspace = await withWorkspace({ prefix: "thoth-web-scorecard-" });
    await workspace.navigateTo();
    await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
    await expect(page.getByTestId("workspace-thoth-surface-preview")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("One Thoth workspace", { exact: true })).toBeVisible();
    await expect(page.getByText("Active task", { exact: true })).toBeVisible();
    await expect(page.getByText("No frozen task yet", { exact: true })).toBeVisible();
    await expect(page.getByText("Contract", { exact: true })).toBeVisible();
    await expect(page.getByText("Needs Clarify session", { exact: true })).toBeVisible();
    await expect(page.getByText("Evidence", { exact: true })).toBeVisible();
    await expect(page.getByText("Review receipts will land here", { exact: true })).toBeVisible();
    await expectThothComposerControls(page);
    await exerciseComposerControls(page);
    await expect(page.getByText("Needs provider before execution", { exact: true })).toBeVisible();
    await expectHealthySurface(page);
    await capture(page, testInfo, "web-workspace-composer.png");

    await openSettings(page);
    await openSettingsSection(page, "about");
    await expectAboutContent(page);
    await expectHealthySurface(page);
    await capture(page, testInfo, "web-settings-about.png");

    const serverId = getServerId();
    await expectHostProvidersCard(page, serverId);
    await expect(page.getByTestId("host-page-providers-card")).toBeVisible();
    await expectHealthySurface(page);
    await capture(page, testInfo, "web-settings-providers.png");

    await openSettingsHostSection(page, serverId, "connections");
    await expect(page.getByTestId("host-page-connections-card")).toBeVisible();
    await expectHealthySurface(page);
    await capture(page, testInfo, "web-settings-connections.png");

    for (let index = 0; index < 4; index += 1) {
      await page.setViewportSize({ width: 1440, height: 960 });
      await openSettingsHostSection(page, serverId, index % 2 === 0 ? "providers" : "connections");
      await expectHealthySurface(page);
      await page.getByTestId("settings-back-to-workspace").click();
      await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
      await expectThothComposerControls(page);
      await page.getByTestId("thoth-control-mode").click();
      await page.getByTestId("thoth-control-clarify").click();
      if (index % 2 === 1) {
        await page.setViewportSize({ width: 390, height: 844 });
      } else {
        await page.setViewportSize({ width: 1440, height: 960 });
      }
      await expectHealthySurface(page);
      await openSettings(page);
    }

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

async function expectThothComposerControls(page: Page) {
  const controls = page.getByTestId("thoth-composer-controls");
  await expect(controls).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("thoth-control-attach")).toContainText("Images/files <10MB");
  await expect(page.getByTestId("thoth-control-provider")).toContainText("Provider");
  await expect(page.getByTestId("thoth-control-provider")).toContainText("Select model first");
  await expect(page.getByTestId("thoth-control-mode")).toContainText("Mode");
  await expect(page.getByTestId("thoth-control-clarify")).toContainText("Clarify");
  await expect(page.getByTestId("thoth-control-loop")).toContainText("Loop");
  await expect(page.getByText("Needs provider before execution", { exact: true })).toBeVisible();
}

async function exerciseComposerControls(page: Page) {
  await page.getByTestId("thoth-control-mode").click();
  await expect(page.getByTestId("thoth-control-mode")).toContainText("Loop");
  await expect(page.getByTestId("thoth-control-loop")).toContainText("Auto");
  await page.getByTestId("thoth-control-clarify").click();
  await expect(page.getByTestId("thoth-control-clarify")).toContainText("Don't Ask");
  await page.getByTestId("thoth-control-loop").click();
  await expect(page.getByTestId("thoth-control-loop")).toContainText("Single Pass");
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
    .toBeGreaterThan(80);

  const visibleText = await page.locator("body").innerText();
  for (const pattern of forbiddenVisiblePatterns) {
    expect(visibleText).not.toMatch(pattern);
  }
  expect(page.url()).not.toMatch(/6767|offer=|#offer=|pairingToken/);
}
