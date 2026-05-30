import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from '@playwright/test'

const visualMode = process.env.THOTH_DASHBOARD_DEMO_VISUAL === '1'
const outputDir = process.env.THOTH_DASHBOARD_SCREENSHOT_DIR ?? 'playwright-report/demo'

test.describe('dashboard demo visual fixture', () => {
  test.skip(!visualMode, 'THOTH_DASHBOARD_DEMO_VISUAL=1 is required')

  test('desktop cockpit renders plugin-aware demo dashboard', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1080 })
    await page.goto('/cockpit')
    await expect(page.locator('.cockpit')).toBeVisible()
    await expect(page.getByText('Loss / Metrics').first()).toBeVisible()
    await expect(page.getByText('Tool Plugins').first()).toBeVisible()
    await expect(page.getByText('Authority Graph').first()).toBeVisible()
    await expect(page.getByText('Work Item Matrix').first()).toBeVisible()
    await expect(page.getByText('Run Compare').first()).toBeVisible()
    mkdirSync(outputDir, { recursive: true })
    await page.screenshot({ path: join(outputDir, 'dashboard-demo-desktop.png'), fullPage: true })
  })

  test('mobile cockpit keeps tools and authority panels readable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1200 })
    await page.goto('/cockpit')
    await expect(page.locator('.cockpit')).toBeVisible()
    await expect(page.getByText('Thoth Demo Project').first()).toBeVisible()
    await expect(page.getByText('Loss / Metrics').first()).toBeVisible()
    await expect(page.getByText('Tool Plugins').first()).toBeVisible()
    mkdirSync(outputDir, { recursive: true })
    await page.screenshot({ path: join(outputDir, 'dashboard-demo-mobile.png'), fullPage: true })
  })
})
