import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { test, expect } from '@playwright/test'

const here = fileURLToPath(new URL('.', import.meta.url))
const runId = process.env.THOTH_SELFTEST_RUN_ID ?? ''
const taskId = process.env.THOTH_SELFTEST_TASK_ID ?? 'task-1'
const projectRoot = process.env.THOTH_SELFTEST_PROJECT_ROOT ?? resolve(here, '..', '..', '..')
const sourceRoot = process.env.THOTH_SELFTEST_SOURCE_ROOT ?? resolve(here, '..', '..', '..', '..', '..')
const pythonBin = process.env.THOTH_SELFTEST_PYTHON ?? 'python3'

test('dashboard reflects live runtime state and stop transitions', async ({ page }) => {
  test.skip(!runId, 'THOTH_SELFTEST_RUN_ID is required')

  await page.goto('/runs')
  await expect(page.locator('.runs-panel')).toContainText(runId)
  await expect(page.locator('.runs-panel')).toContainText('codex')

  await page.goto('/work')
  await page.getByText(taskId).first().click()
  const taskDetail = page.locator('.task-detail').first()
  await expect(taskDetail).toContainText(runId)
  await expect(taskDetail).toContainText('codex')

  execFileSync(
    pythonBin,
    ['-m', 'thoth.cli', 'run', '--stop', runId],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH
          ? `${sourceRoot}:${process.env.PYTHONPATH}`
          : sourceRoot,
      },
      stdio: 'ignore',
    },
  )

  await page.reload()
  await page.getByText(taskId).first().click()
  await expect(taskDetail).toContainText('stopped')
})
