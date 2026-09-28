import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { appUrl, monthStart, resetAppDb, seedHouse, setOwnerPassword } from './helpers.js'

const PASSWORD = 'correct horse battery staple'
const HOUSE = 'Дом у озера'

// Kept local rather than imported from `../../web/src/calendar/nights`: that file is written
// for the web workspace's bundler resolution (no extension on a relative specifier), while this
// one sits outside every workspace and follows the root's NodeNext rules, which want a `.js`
// specifier a bundler-only module doesn't have. Two lines here are cheaper than reshaping a
// tsconfig for one import.
const DAY_MS = 86_400_000
const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

// Pick an offset no other spec uses; the engine's bookings outlive resetAppDb. calendar.spec.ts
// takes 1, houses-guests.spec.ts takes 3 — 6 is free.
const MONTH = monthStart(6)

/** The month state always starts on the current month, even mid-test, so every journey below
 *  has to page forward to the fixture month before it can touch a night in it. */
async function goToMonth(page: Page, month: string): Promise<void> {
  const target = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7))
  const now = new Date()
  const current = now.getFullYear() * 12 + (now.getMonth() + 1)
  for (let step = 0; step < target - current; step += 1) {
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
  }
}

const night = (page: Page, date: string) =>
  page.locator(`[data-testid="night-cell"][data-date="${date}"][data-house="${HOUSE}"]`)

/** A press on the first night and a release on the last: a drag, as a thumb makes it. */
async function pickNights(page: Page, checkIn: string, lastNight: string): Promise<void> {
  await night(page, checkIn).hover()
  await page.mouse.down()
  await night(page, lastNight).hover()
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await resetAppDb()
  await setOwnerPassword(PASSWORD)
  await seedHouse(HOUSE, 'A')

  await page.goto(appUrl('/'))
  // The shell only precaches once the worker has activated; a request made before the worker
  // controls this page never reaches its fetch handler, so anything below that depends on the
  // worker (the calendar staying up with the network cut) would pass for the wrong reason.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)

  await page.getByLabel('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Календарь' })).toBeVisible()

  await goToMonth(page, MONTH)
})

test('a cold reload while offline still reaches the calendar and a booking can be captured', async ({
  page,
  context,
}) => {
  // The journey the whole branch exists for: the owner reopens the app standing at the houses
  // with no signal at all, not the app left open from before the signal dropped (the journey
  // above) and not signed out (offline-shell.spec.ts). Nothing here pages the calendar forward —
  // a reload always lands back on the real current month (`App.tsx` keeps no month in the URL),
  // so this deliberately stays on whatever month that is rather than steering toward `MONTH`.
  await page.waitForLoadState('networkidle')

  await context.setOffline(true)
  await page.reload()

  // `RequireSession` let this through on an unreachable `/api/me` rather than showing `Trouble`
  // — the fix this test exists to prove. A signed-out reload staying on `/login` is covered by
  // offline-shell.spec.ts.
  await expect(page.getByRole('heading', { name: 'Календарь' })).toBeVisible()
  // `ConnectionBanner`'s own "Нет сети" line depends on `navigator.onLine`, which — unlike the
  // fetches below — is not guaranteed to already read false on the very first script execution
  // of a document loaded while a context is offline; `Calendar`'s own staleness line does not
  // depend on that signal, only on the read actually having failed, so it is what a cold reload
  // can rely on to say plainly that the grid is not live.
  await expect(page.getByText(/Календарь на память, обновлён/)).toBeVisible()

  // The last night cell of whatever month this is, rather than a computed date: robust to
  // wherever "today" falls in its month, and proves the cached grid — not just the shell —
  // survived the reload.
  const lastNight = page.locator(`[data-testid="night-cell"][data-house="${HOUSE}"]`).last()
  const checkIn = await lastNight.getAttribute('data-date')
  if (checkIn === null) throw new Error('no cached night cell survived the reload')

  await lastNight.click()
  await expect(page.getByRole('dialog', { name: 'Новая бронь' })).toBeVisible()
  // Settings — the currency `NewBooking` needs to enable Save — came back from the offline
  // cache too (`web/src/settings.ts`), so the button is not stuck disabled the way it was before
  // this fix.
  await page.getByLabel('Имя').fill('Аня')
  await page.getByLabel('Телефон').fill('+375291234567')
  await expect(page.getByRole('button', { name: 'Сохранить' })).toBeEnabled()
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Proven through the tray, not `ConnectionBanner`'s top line: that line's wording keys off
  // `useOnline`'s `navigator.onLine` reading, which is a documented hint, not a fact
  // (web/src/offline/useOffline.ts), and is not guaranteed to already read false on the very
  // first script of a document that loads into an already-offline context — a pre-existing gap
  // orthogonal to this finding's session gate and settings cache. `captureOrPost`
  // (web/src/offline/capture.ts) never consults that signal — it tries the real request and
  // queues on an actual failure — so the queued booking itself is not affected by it, and the
  // tray, which lists what IndexedDB actually holds, is the reliable place to see that.
  // Clicking the same cell again opens it, exactly as `Calendar.openBooking` does for any
  // pending night.
  await lastNight.click()
  const tray = page.getByLabel('Не отправлено')
  await expect(tray.getByText('Аня')).toBeVisible()
  await expect(tray.getByText('Ждёт сети')).toBeVisible()
})

test('a booking taken with no signal reaches the engine when the signal returns', async ({
  page,
  context,
}) => {
  const checkIn = addDays(MONTH, 2)

  // Settled on the target month, with the settings fetch that prices the form and the night
  // itself both landed, before the network goes away — otherwise the cut can land mid-fetch,
  // with nothing cached yet for a month never visited before, and the sheet's own Save button
  // stays disabled for want of a currency that never arrived.
  await page.waitForLoadState('networkidle')
  await expect(night(page, checkIn)).toBeVisible()

  // The phone loses signal with the app already open — the ordinary case, and the one that
  // does not force a reload through a session check that has no network to answer it.
  await context.setOffline(true)

  // The grid stays up and says plainly that it is not live, rather than pretending to be.
  await expect(page.getByText('Нет сети. Календарь показан на память.')).toBeVisible()

  await night(page, checkIn).click()
  await expect(page.getByRole('dialog', { name: 'Новая бронь' })).toBeVisible()
  await page.getByLabel('Имя').fill('Аня')
  await page.getByLabel('Телефон').fill('+375291234567')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  await expect(page.getByText(/ждёт отправки|ждут отправки/)).toBeVisible()

  // Signal returns. Nothing here reloads the page — the same running app notices and sends
  // the queue on its own.
  await context.setOffline(false)

  // Nothing left unsent, and the booking is now the engine's — the calendar refetches once the
  // sync round that sent it completes, so this is the server's own answer, not an optimistic
  // guess the overlay was already showing.
  await expect(page.getByText(/ждёт отправки|ждут отправки/)).toBeHidden()
  await expect(page.getByText('Аня', { exact: true })).toBeVisible()

  const bookings = await page.evaluate(async (month: string) => {
    const response = await fetch(`/api/calendar?from=${month}&to=${month.slice(0, 8)}28`, {
      credentials: 'same-origin',
    })
    return ((await response.json()) as { bookings: Array<{ guest: { name: string } | null }> })
      .bookings
  }, MONTH)

  expect(bookings.filter((booking) => booking.guest?.name === 'Аня')).toHaveLength(1)
})

test('a night taken while offline is escalated, not silently dropped', async ({
  page,
  context,
}) => {
  const checkIn = addDays(MONTH, 10)
  const checkOut = addDays(MONTH, 12)
  const lastNight = addDays(checkOut, -1)

  // Fetched before the network is cut: this is a page-level `fetch`, unlike the
  // `context.request` call below, and the offline simulation would fail it too.
  const houseId = await page.evaluate(async () => {
    const response = await fetch('/api/houses', { credentials: 'same-origin' })
    return ((await response.json()) as Array<{ id: string }>)[0]!.id
  })

  // See the note in the first journey: settle every in-flight fetch, and confirm the nights
  // this test is about to pick are actually on screen, before cutting the network.
  await page.waitForLoadState('networkidle')
  await expect(night(page, checkIn)).toBeVisible()
  await expect(night(page, lastNight)).toBeVisible()

  await context.setOffline(true)
  await expect(page.getByText('Нет сети. Календарь показан на память.')).toBeVisible()

  await pickNights(page, checkIn, lastNight)
  await expect(page.getByRole('dialog', { name: 'Новая бронь' })).toBeVisible()
  await page.getByLabel('Имя').fill('Аня')
  await page.getByLabel('Телефон').fill('+375291234567')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByText(/ждёт отправки|ждут отправки/)).toBeVisible()

  // Someone takes the same nights behind the app's back while it is still offline. Booked
  // through `context.request`, which shares this page's session cookie but not its simulated
  // network condition, so it lands in the engine deterministically before the queued booking
  // above ever gets a chance to race it once the signal returns.
  const rival = await context.request.post(appUrl('/api/bookings'), {
    data: {
      idempotency_key: randomUUID(),
      currency: 'RUB',
      house_id: houseId,
      check_in: checkIn,
      check_out: checkOut,
      guest: { name: 'Пётр', phone: '+375291112233' },
      price_per_night: 30000,
      addons: [],
      deposit: 0,
    },
  })
  expect(rival.ok()).toBe(true)

  await context.setOffline(false)

  // Escalated to the owner, with the details kept — never silently dropped and never retried
  // into a second booking of the same nights.
  await expect(page.getByText(/требует внимания|требуют внимания/)).toBeVisible()
  await page.getByText(/требует внимания|требуют внимания/).click()
  await page.getByRole('button', { name: 'Разобраться' }).click()
  await expect(page.getByText(/Эти ночи заняли/)).toBeVisible()
  // Exact: "заняли" itself contains the substring "аня", so a loose match would pass even if
  // the guest's own name were never rendered on this screen.
  await expect(page.getByText('Аня', { exact: true })).toBeVisible()

  // And no duplicate was made: the engine holds exactly Пётр's booking, never Ани's as well.
  const bookings = await page.evaluate(async (month: string) => {
    const response = await fetch(`/api/calendar?from=${month}&to=${month.slice(0, 8)}28`, {
      credentials: 'same-origin',
    })
    return ((await response.json()) as { bookings: Array<{ guest: { name: string } | null }> })
      .bookings
  }, MONTH)

  expect(bookings.filter((booking) => booking.guest?.name === 'Аня')).toHaveLength(0)
  expect(bookings.filter((booking) => booking.guest?.name === 'Пётр')).toHaveLength(1)
})
