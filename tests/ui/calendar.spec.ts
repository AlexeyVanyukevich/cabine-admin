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
    await page.getByRole('status').getByRole('button', { name: 'Отмена' }).tap()
    await expect(page.getByRole('status')).toBeHidden()
    await expect(night(page, checkIn)).not.toHaveClass(/timeline__cell--picked/)
  })
})
