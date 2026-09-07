import { expect, test } from '@playwright/test'
import { resetAppDb, setOwnerPassword } from './helpers'

test.beforeEach(async () => {
  await resetAppDb()
  await setOwnerPassword('correct horse battery staple')
})

test('the app shell still renders with the network cut', async ({ page, context }) => {
  await page.goto('/')

  // The shell is only precached once the worker has activated; without this the reload below
  // races registration and fails intermittently rather than meaningfully.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.reload()

  // The login screen is part of the shell, so it renders from the cache with no server.
  await expect(page.getByLabel('Пароль')).toBeVisible()
})

test('an API call is never served from the cache', async ({ page, context }) => {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await context.setOffline(true)

  // NetworkOnly means the request fails rather than answering from a cache. A cached
  // /api/calendar would be the "everything is free" failure the fourth invariant forbids.
  const status = await page.evaluate(async () => {
    try {
      const response = await fetch('/api/calendar?from=2026-09-01&to=2026-10-01')
      return response.status
    } catch {
      return 'threw'
    }
  })
  expect(status).toBe('threw')
})
