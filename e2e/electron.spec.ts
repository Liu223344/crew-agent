import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

test('packaged Bossy launches with a sandboxed renderer and bilingual navigation', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'bossy-e2e-'))
  const electronApp = await electron.launch({
    executablePath: resolve('release/mac-arm64/Bossy.app/Contents/MacOS/Bossy'),
    args: [`--user-data-dir=${userData}`]
  })
  try {
    const page = await electronApp.firstWindow()
    await expect(page).toHaveTitle('Bossy')
    await expect(page.locator('.page-header h1')).toBeVisible()
    const security = await page.evaluate(() => ({
      requireType: typeof (globalThis as { require?: unknown }).require,
      hasBossyApi: typeof window.bossy?.getSnapshot === 'function'
    }))
    expect(security).toEqual({ requireType: 'undefined', hasBossyApi: true })

    await page.locator('.nav-button').nth(3).click()
    await expect(page.locator('.provider-editor')).toBeVisible()
    await page.locator('.preference-form label').filter({ hasText: /界面语言|Language/ }).locator('select').selectOption('en')
    await page.getByRole('button', { name: /保存偏好与价格|Save preferences and pricing/ }).click()
    await expect(page.locator('.page-header h1')).toHaveText('Models & settings')
    await page.getByRole('button', { name: 'Team tree' }).click()
    await expect(page.locator('.page-header h1')).toHaveText('Team tree')
  } finally {
    await electronApp.close()
    await rm(userData, { recursive: true, force: true })
  }
})

