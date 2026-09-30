import { expect, test, type Page } from '@playwright/test'
import { appUrl, monthStart, resetAppDb, seedHouse, setOwnerPassword } from './helpers.js'

const PASSWORD = 'correct horse battery staple'
const HOUSE = 'Дом у озера'

const DAY_MS = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addDays = (date: string, days: number) => iso(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)

/** The month after this one: one click away, and empty of anything the other specs booked. */
const MONTH = monthStart(1)

/**
 * `resetAppDb` clears this project's tables, but the engine keeps its bookings for the whole
 * run, so each case names days of its own inside that month.
 *
 * The offset is explicit rather than drawn from a counter: Playwright re-evaluates the
 * module, so module-level mutable state silently restarts and two cases book the same night.
 */
function stay(dayOffset: number, nights = 2) {
  const checkIn = addDays(MONTH, dayOffset)
  return { checkIn, checkOut: addDays(checkIn, nights), month: MONTH.slice(0, 7) }
}

test.beforeEach(async () => {
  await resetAppDb()
  await setOwnerPassword(PASSWORD)
  await seedHouse(HOUSE)
})

async function signIn(page: Page): Promise<void> {
  await page.goto(appUrl('/login'))
  await page.getByLabel('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: /Календарь/ })).toBeVisible()
}

/** Moves the calendar to the month the fixture books in. */
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

/** A press on the first night and a release on the last: a drag, as a mouse makes it. */
async function pickNights(page: Page, checkIn: string, lastNight: string): Promise<void> {
  await night(page, checkIn).hover()
  await page.mouse.down()
  await night(page, lastNight).hover()
  await page.mouse.up()
}

/** A one-night stay: its night is both the first and the last one picked. */
async function pickOneNight(page: Page, date: string): Promise<void> {
  await night(page, date).click()
  await night(page, date).click()
}

test('picks free nights and books them', async ({ page }) => {
  const { checkIn, month } = stay(3)
  await signIn(page)
  await goToMonth(page, month)

  const second = addDays(checkIn, 1)
  await pickNights(page, checkIn, second)

  await expect(page.getByRole('dialog', { name: 'Новая бронь' })).toBeVisible()

  // Pinned below the scrolling body rather than inside it, so a long form cannot carry the
  // controls off the screen. It still submits the form, which it is no longer nested in.
  await expect(
    page.locator('.sheet__foot').getByRole('button', { name: 'Сохранить' }),
  ).toBeVisible()
  await expect(page.locator('.sheet__body').getByRole('button', { name: 'Сохранить' })).toHaveCount(
    0,
  )

  await page.getByLabel('Имя').fill('Иван')
  await page.getByLabel('Телефон').fill('+7 912 345 67 89')
  await page.getByLabel('Баня').check()
  await page.getByLabel('Аванс, ₽').fill('200')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // 2 × 300 + 50 = 650, less a 200 deposit.
  const bar = page.getByTestId('booking-bar').filter({ hasText: 'Иван' })
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('450')
})

// The property the whole rendering rests on, verified in a browser.
test('two stays meet on a departure date without overlapping', async ({ page }) => {
  const { checkIn, checkOut, month } = stay(8)
  await signIn(page)
  await goToMonth(page, month)

  const second = addDays(checkIn, 1)
  await pickNights(page, checkIn, second)
  await page.getByLabel('Имя').fill('Иван')
  await page.getByLabel('Телефон').fill('+7 912 345 67 89')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByTestId('booking-bar').filter({ hasText: 'Иван' })).toBeVisible()

  // The departure date is free, because the first guest leaves that morning.
  await expect(night(page, checkOut)).toHaveAttribute('data-available', 'true')
  await pickOneNight(page, checkOut)
  await expect(page.getByRole('dialog', { name: 'Новая бронь' })).toBeVisible()
})

test('an occupied night cannot start a booking', async ({ page }) => {
  const { checkIn, month } = stay(13)
  await signIn(page)
  await goToMonth(page, month)

  const second = addDays(checkIn, 1)
  await pickNights(page, checkIn, second)
  await page.getByLabel('Имя').fill('Иван')
  await page.getByLabel('Телефон').fill('+7 912 345 67 89')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByTestId('booking-bar').filter({ hasText: 'Иван' })).toBeVisible()

  await expect(night(page, checkIn)).toHaveAttribute('data-available', 'false')
  await night(page, checkIn).click()
  // Tapping a taken night opens the stay that owns it, never a new-booking form.
  await expect(page.getByRole('dialog', { name: 'Новая бронь' })).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Иван' })).toBeVisible()
})

test('records a payment against a booking', async ({ page }) => {
  const { checkIn, month } = stay(18, 1)
  await signIn(page)
  await goToMonth(page, month)

  await pickOneNight(page, checkIn)
  await page.getByLabel('Имя').fill('Пётр')
  await page.getByLabel('Телефон').fill('+7 912 000 11 22')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  const bar = page.getByTestId('booking-bar').filter({ hasText: 'Пётр' })
  await expect(bar).toBeVisible()
  await expect(bar).toContainText('300')

  await bar.click()
  await page.getByLabel('Аванс, ₽').fill('300')
  await page.getByRole('button', { name: 'Сохранить' }).click()

  // Settled: the amount owed disappears from the strip.
  await expect(page.getByTestId('booking-bar').filter({ hasText: 'Пётр' })).not.toContainText('₽')
})

test('cancelling a booking frees its nights', async ({ page }) => {
  const { checkIn, month } = stay(23, 1)
  await signIn(page)
  await goToMonth(page, month)

  await pickOneNight(page, checkIn)
  await page.getByLabel('Имя').fill('Ольга')
  await page.getByLabel('Телефон').fill('+7 912 777 88 99')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByTestId('booking-bar').filter({ hasText: 'Ольга' })).toBeVisible()

  await page.getByTestId('booking-bar').filter({ hasText: 'Ольга' }).click()
  await page.getByRole('button', { name: 'Отменить бронь' }).click()
  await page.getByRole('button', { name: 'Да, отменить' }).click()

  await expect(page.getByTestId('booking-bar').filter({ hasText: 'Ольга' })).toBeHidden()
  await expect(night(page, checkIn)).toHaveAttribute('data-available', 'true')
})

// The row a stay starts on carries its guest's name, and every row is a grid of its own. A name
// that sized its lane would shift that one row's other lanes sideways, off the clipped edge of
// the timeline, and the other house's night on that date could be neither seen nor tapped.
test('a long guest name does not push the other house off its row', async ({ page }) => {
  const { checkIn, month } = stay(0)
  await seedHouse('Второй дом', 'B')
  await signIn(page)
  await goToMonth(page, month)

  await pickNights(page, checkIn, addDays(checkIn, 1))
  await page.getByLabel('Имя').fill('Александра Константиновна Преображенская')
  await page.getByLabel('Телефон').fill('+7 912 555 66 77')
  await page.getByRole('button', { name: 'Сохранить' }).click()
  await expect(page.getByTestId('booking-bar').filter({ hasText: 'Александра' })).toBeVisible()

  const row = page.locator('.timeline__row').filter({ has: night(page, checkIn) })
  const other = (await row.locator('.timeline__cell').nth(1).boundingBox())!
  const lane = (await page.locator('.timeline__house', { hasText: 'Второй дом' }).boundingBox())!
  expect(Math.abs(other.x - lane.x)).toBeLessThan(1)
  expect(other.x + other.width).toBeLessThanOrEqual(page.viewportSize()!.width)
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true })

  // A finger cannot drag across nights: the browser keeps the touch on the night it began on.
  // The tap that finishes a stay also must not fall through to the sheet it opens and close it.
  test('tapping the first night and then the last books the stay', async ({ page }) => {
    const { checkIn, month } = stay(26)
    const lastNight = addDays(checkIn, 1)
    await signIn(page)
    await goToMonth(page, month)

    await night(page, checkIn).tap()
    await expect(page.getByRole('status')).toContainText('последнюю ночь')
    await expect(page.getByRole('dialog', { name: 'Новая бронь' })).toBeHidden()

    await night(page, lastNight).tap()
    const sheet = page.getByRole('dialog', { name: 'Новая бронь' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('2 ночи')
    // Still open once the tap has fully played out, including the click that trails it.
    await page.waitForTimeout(300)
    await expect(sheet).toBeVisible()

    await page.getByLabel('Имя').fill('Вера')
    await page.getByLabel('Телефон').fill('+7 912 333 44 55')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByTestId('booking-bar').filter({ hasText: 'Вера' })).toBeVisible()
  })

  // The bar that holds the first night appears at the bottom of the screen, which may be right
  // under the finger that tapped it — and the click trailing that tap must not press its
  // cancel button.
  test('a night tapped just above the bottom bar stays picked', async ({ page }) => {
    const { checkIn, month } = stay(15, 1)
    await seedHouse('Второй дом', 'B')
    await signIn(page)
    await goToMonth(page, month)

    const cell = page.locator(
      `[data-testid="night-cell"][data-date="${checkIn}"][data-house="Второй дом"]`,
    )
    await cell.evaluate((el) => {
      const box = el.getBoundingClientRect()
      window.scrollBy(0, box.top + box.height / 2 - (window.innerHeight - 100))
    })
    await cell.tap()
    await page.waitForTimeout(300)
    await expect(page.getByRole('status')).toContainText('последнюю ночь')
  })

  test('the first night can be let go of', async ({ page }) => {
    const { checkIn, month } = stay(21, 1)
    await signIn(page)
    await goToMonth(page, month)

    await night(page, checkIn).tap()
    // Clear of the bottom bar, whatever height that bar turns out to be.
    const bar = (await page.getByRole('status').boundingBox())!
    const nav = (await page.locator('.nav').boundingBox())!
    expect(bar.y + bar.height).toBeLessThanOrEqual(nav.y)
    await page.getByRole('status').getByRole('button', { name: 'Отмена' }).tap()
    await expect(page.getByRole('status')).toBeHidden()
    await expect(night(page, checkIn)).not.toHaveClass(/timeline__cell--picked/)
  })
})

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox()
  if (box === null) throw new Error(`${selector} is not rendered`)
  return box
}

const bottom = (box: Box) => box.y + box.height

/** Each box ends where the next begins, or above it: stacked, never drawn over one another. */
function expectStacked(boxes: Box[]): void {
  for (let i = 1; i < boxes.length; i += 1) {
    expect(bottom(boxes[i - 1]!)).toBeLessThanOrEqual(boxes[i]!.y + 0.5)
  }
}

/** Paged to the fixture month and its grid drawn: until then the page is too short to scroll. */
async function openMonth(page: Page): Promise<void> {
  await goToMonth(page, MONTH)
  await expect(
    page.locator(`[data-testid="night-cell"][data-date="${MONTH}"]`).first(),
  ).toBeVisible()
}

async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
}

/** The rows lying wholly between the house names and the bottom bar. */
async function rowsInView(page: Page): Promise<number> {
  const head = await boxOf(page, '.timeline__head')
  const nav = await boxOf(page, '.nav')
  const rows = await page.locator('.timeline__row').evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom }
    }),
  )
  return rows.filter((row) => row.top >= bottom(head) - 0.5 && row.bottom <= nav.y + 0.5).length
}

/**
 * The month and its arrows ride in the pinned title bar, so a long month scrolled to its end
 * still says which month it is and can be paged without scrolling back up. The house names sit
 * directly under that bar rather than sliding beneath it.
 */
test.describe('the pinned month', () => {
  test.use({ hasTouch: true, isMobile: true })

  test.describe('on a phone held upright', () => {
    test.use({ viewport: { width: 390, height: 844 } })

    test('the grid starts high enough to show most of the month', async ({ page }) => {
      await signIn(page)
      await openMonth(page)
      await page.evaluate(() => window.scrollTo(0, 0))

      const grid = await boxOf(page, '.timeline')
      test.info().annotations.push({ type: 'grid top', description: `${grid.y}px` })
      expect(grid.y).toBeLessThan(120)
    })

    test('the month stays in reach at the end of the month', async ({ page }) => {
      await signIn(page)
      await openMonth(page)
      await scrollToEnd(page)

      const title = page.locator('.monthbar__title')
      const previous = page.getByRole('button', { name: 'Предыдущий месяц' })
      const next = page.getByRole('button', { name: 'Следующий месяц' })
      await expect(title).toBeInViewport()
      await expect(previous).toBeInViewport()
      await expect(next).toBeInViewport()

      const chrome = await boxOf(page, '.app-chrome')
      expect(chrome.y).toBeCloseTo(0, 0)
      expectStacked([await boxOf(page, '.topbar'), await boxOf(page, '.timeline__head')])
      // Directly under the bar, not somewhere further down the page.
      expect((await boxOf(page, '.timeline__head')).y).toBeCloseTo(bottom(chrome), 0)
      await expect(page.locator('.timeline__row').last()).toBeInViewport()

      const shown = await title.textContent()
      await next.tap()
      await expect(title).not.toHaveText(shown!)
      await expect(title).toBeInViewport()
      await previous.tap()
      await expect(title).toHaveText(shown!)
    })

    test('with the network gone, the banner and the stamp stack under the month', async ({
      page,
      context,
    }) => {
      await page.goto(appUrl('/login'))
      // The worker has to control the page before the reload below, or the shell is not cached.
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
      await page.getByLabel('Пароль').fill(PASSWORD)
      await page.getByRole('button', { name: 'Войти' }).click()
      await expect(page.locator('.timeline')).toBeVisible()
      await page.waitForLoadState('networkidle')

      await context.setOffline(true)
      await page.reload()
      await expect(page.getByText(/Календарь на память, обновлён/)).toBeVisible()
      // `navigator.onLine` is not guaranteed to read false on the first script of a document
      // loaded into an offline context, and the banner keys off it. The context is offline, so
      // telling the page so is the truth, just delivered on time.
      await page.evaluate(() => window.dispatchEvent(new Event('offline')))
      await expect(page.getByText('Нет сети. Календарь показан на память.')).toBeVisible()

      await scrollToEnd(page)
      const chrome = await boxOf(page, '.app-chrome')
      expect(chrome.y).toBeCloseTo(0, 0)
      expectStacked([
        await boxOf(page, '.topbar'),
        await boxOf(page, '.conn'),
        await boxOf(page, '.app-chrome__notice'),
        await boxOf(page, '.timeline__head'),
      ])
      expect((await boxOf(page, '.timeline__head')).y).toBeCloseTo(bottom(chrome), 0)

      const title = page.locator('.monthbar__title')
      await expect(title).toBeInViewport()
      const shown = await title.textContent()
      await page.getByRole('button', { name: 'Следующий месяц' }).tap()
      await expect(title).not.toHaveText(shown!)
      await page.getByRole('button', { name: 'Предыдущий месяц' }).tap()
      await expect(title).toHaveText(shown!)
    })
  })

  test.describe('on a phone held sideways', () => {
    test.use({ viewport: { width: 844, height: 390 } })

    test('five nights show under the pinned header', async ({ page }) => {
      await signIn(page)
      await openMonth(page)
      await page.evaluate(() => window.scrollTo(0, 300))

      const rows = await rowsInView(page)
      test.info().annotations.push({ type: 'rows in view', description: String(rows) })
      expect(rows).toBeGreaterThanOrEqual(5)
    })

    // The calendar opens scrolled to today; the row must land in the band the owner can see,
    // not under the bar pinned above the house names.
    test('today opens clear of the pinned header', async ({ page }) => {
      await signIn(page)
      const today = page.locator('.timeline__row--today')
      await expect(today).toBeVisible()

      const row = (await today.boundingBox())!
      expect(row.y).toBeGreaterThanOrEqual(bottom(await boxOf(page, '.timeline__head')) - 0.5)
      expect(bottom(row)).toBeLessThanOrEqual((await boxOf(page, '.nav')).y + 0.5)
    })
  })
})
