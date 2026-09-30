import { expect, test } from '@playwright/test'
import { appUrl, resetAppDb, seedHouse, setOwnerPassword } from './helpers.js'

const PASSWORD = 'correct horse battery staple'

test.beforeEach(async () => {
  await resetAppDb()
  await setOwnerPassword(PASSWORD)
})

test('the app shell still renders with the network cut', async ({ page, context }) => {
  await page.goto(appUrl('/'))

  // The shell is only precached once the worker has activated; without this the reload below
  // races registration and fails intermittently rather than meaningfully.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await context.setOffline(true)
  await page.reload()

  // The login screen is part of the shell, so it renders from the cache with no server.
  await expect(page.getByLabel('Пароль')).toBeVisible()
})

test('the worker precaches the web app manifest', async ({ page }) => {
  await page.goto(appUrl('/'))
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  // Asked of the cache rather than watched on the wire: a headless browser never requests the
  // manifest, so an offline reload would pass whether or not it could be served. The worker
  // controls the page only after install, and install is when it precaches. `ignoreSearch`
  // because Workbox keys an unhashed file by a revision parameter.
  const cached = await page.evaluate(async () => {
    const hit = await caches.match('/manifest.json', { ignoreSearch: true })
    return hit !== undefined
  })
  expect(cached).toBe(true)
})

test('an API call is never served from the cache', async ({ page, context }) => {
  await seedHouse()
  await page.goto(appUrl('/'))

  // Signing in must happen only once the worker controls this page: a request made before
  // that point never reaches the worker's fetch handler at all, and the assertion below would
  // pass for the wrong reason, exactly as it did when this test only checked an offline fetch.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await page.getByLabel('Пароль').fill(PASSWORD)
  const calendarLoaded = page.waitForResponse(
    (response) => response.url().includes('/api/calendar') && response.status() === 200,
  )
  await page.getByRole('button', { name: 'Войти' }).click()
  await calendarLoaded

  // `caches.match` searches every Cache Storage entry the origin owns, and `ignoreSearch`
  // makes the `from`/`to` query string irrelevant. `NetworkOnly` never writes a response into
  // any cache, so this must come back empty. A cached `/api/calendar` answered as fresh is the
  // "everything is free" failure the fourth invariant forbids, and is exactly what this
  // assertion would catch under a weaker handler such as `CacheFirst`.
  const cached = await page.evaluate(async () => {
    const hit = await caches.match('/api/calendar', { ignoreSearch: true })
    return hit !== undefined
  })
  expect(cached).toBe(false)

  // Secondary check, kept from the original test: offline, the same endpoint throws rather
  // than answering from whatever the primary check above already proved is not cached.
  await context.setOffline(true)
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
