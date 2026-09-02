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

/** A press on the first night and a release on the last: a drag, as a thumb makes it. */
async function pickNights(page: Page, checkIn: string, lastNight: string): Promise<void> {
  await night(page, checkIn).hover()
  await page.mouse.down()
  await night(page, lastNight).hover()
  await page.mouse.up()
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
  await night(page, checkOut).click()
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

  await night(page, checkIn).click()
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

  await night(page, checkIn).click()
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
