import { expect, test, type Page } from '@playwright/test'
import {
  appUrl,
  bookViaPage,
  monthStart,
  resetAppDb,
  seedHouse,
  setOwnerPassword,
} from './helpers.js'

const PASSWORD = 'correct horse battery staple'
const HOUSE = 'Дом у озера'

const DAY_MS = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const addDays = (date: string, days: number) => iso(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)

const MONTH = monthStart(3)

/**
 * Each case names its own day, rather than drawing from a shared counter. Playwright
 * re-evaluates the module, so a module-level counter silently restarts and two tests book the
 * same night — which the engine, keeping its bookings for the whole run, then refuses.
 */
function stay(dayOffset: number, nights = 2) {
  const checkIn = addDays(MONTH, dayOffset)
  return { checkIn, checkOut: addDays(checkIn, nights) }
}

test.beforeEach(async () => {
  await resetAppDb()
  await setOwnerPassword(PASSWORD)
})

/** MONTH is three months out, so the calendar needs walking to it. */
async function goToMonth(page: Page): Promise<void> {
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole('button', { name: 'Следующий месяц' }).click()
  }
}

async function signIn(page: Page): Promise<void> {
  await page.goto(appUrl('/login'))
  await page.getByLabel('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: 'Календарь' })).toBeVisible()
}

test.describe('Дома', () => {
  test('says how to add the first house rather than showing an empty screen', async ({ page }) => {
    await signIn(page)
    await page.getByRole('link', { name: 'Дома' }).click()

    await expect(page.getByText('Пока нет домов')).toBeVisible()
    await expect(page.getByText('./run house:add')).toBeVisible()
  })

  test('adds an extra, and it becomes bookable on the calendar', async ({ page }) => {
    await seedHouse(HOUSE)
    await signIn(page)
    await page.getByRole('link', { name: 'Дома' }).click()

    // The house is seeded with Баня; the owner adds a second extra.
    await page.getByRole('button', { name: 'Добавить услугу' }).click()
    await page.getByLabel('Название услуги').last().fill('Купель')
    await page.getByLabel('Цена услуги').last().fill('700')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Сохранено')).toBeVisible()

    // A code was never typed; the server generated one, and the booking form uses it.
    await page.getByRole('link', { name: 'Календарь' }).click()
    const { checkIn } = stay(3)
    await goToMonth(page)
    await page
      .locator(`[data-testid="night-cell"][data-date="${checkIn}"][data-house="${HOUSE}"]`)
      .click()

    await expect(page.getByLabel('Купель')).toBeVisible()
  })

  test('shows check-in as fixed and check-out as editable', async ({ page }) => {
    await seedHouse(HOUSE)
    await signIn(page)
    await page.getByRole('link', { name: 'Дома' }).click()

    // Check-in comes from the engine and has no control; check-out is ours to change.
    await expect(page.getByText(/Заезд\s+\d{2}:\d{2}/)).toBeVisible()
    await page.getByLabel('Выезд').fill('12:00')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Сохранено')).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Выезд')).toHaveValue('12:00')
  })

  test('repricing a night leaves an existing booking alone', async ({ page }) => {
    const houseId = await seedHouse(HOUSE)
    await signIn(page)

    const { checkIn, checkOut } = stay(7, 2)
    await bookViaPage(page, {
      house_id: houseId,
      check_in: checkIn,
      check_out: checkOut,
      guest: { name: 'Иван', phone: '+79123456789' },
      price_per_night: 30000,
      addons: [],
      deposit: 0,
    })

    await page.getByRole('link', { name: 'Дома' }).click()
    await page.getByLabel('Цена за ночь, ₽').fill('900')
    await page.getByRole('button', { name: 'Сохранить' }).click()
    await expect(page.getByText('Сохранено')).toBeVisible()

    // The booking keeps the price it was sold at: 2 × 300, not 2 × 900.
    await page.getByRole('link', { name: 'Гости' }).click()
    await page.getByRole('button', { name: /Иван/ }).click()
    // The stay itself, not the "unpaid" summary — both happen to read 600 ₽ here.
    await expect(page.locator('.stays__total')).toHaveText('600 ₽')
  })
})

test.describe('Валюта', () => {
  test('relabels the prices without converting the numbers', async ({ page }) => {
    await seedHouse(HOUSE)
    await signIn(page)
    await page.getByRole('link', { name: 'Дома' }).click()

    await expect(page.getByLabel('Цена за ночь, ₽')).toHaveValue('300')

    await page.getByLabel('Валюта').selectOption('BYN')

    // The same number. Nothing is converted, so the owner is told to check the prices.
    await expect(page.getByLabel('Цена за ночь, Br')).toHaveValue('300')
    await expect(page.getByText('Суммы не пересчитываются')).toBeVisible()
  })

  /**
   * The invariant the whole design turns on: a stay is still owed in what it was sold in after
   * the owner starts pricing in something else. Anything else shows a debt never agreed.
   */
  test('leaves a booking in the currency it was sold in', async ({ page }) => {
    const houseId = await seedHouse(HOUSE)
    await signIn(page)
    const { checkIn, checkOut } = stay(24)
    await bookViaPage(page, {
      house_id: houseId,
      check_in: checkIn,
      check_out: checkOut,
      guest: { name: 'Пётр', phone: '+79990001122' },
      price_per_night: 30000,
      addons: [],
      deposit: 0,
    })

    await page.getByRole('link', { name: 'Дома' }).click()
    await page.getByLabel('Валюта').selectOption('BYN')
    await expect(page.getByLabel('Цена за ночь, Br')).toBeVisible()

    await page.getByRole('link', { name: 'Гости' }).click()
    await page.getByRole('button', { name: /Пётр/ }).click()
    await expect(page.locator('.stays__total')).toHaveText('600 ₽')
  })
})

test.describe('Гости', () => {
  test('finds a returning guest however the number is written', async ({ page }) => {
    const houseId = await seedHouse(HOUSE)
    await signIn(page)

    const { checkIn, checkOut } = stay(11, 1)
    await bookViaPage(page, {
      house_id: houseId,
      check_in: checkIn,
      check_out: checkOut,
      guest: { name: 'Иван Петров', phone: '+7 912 345 67 89' },
      price_per_night: 30000,
      addons: [],
      deposit: 10000,
    })

    await page.getByRole('link', { name: 'Гости' }).click()
    await expect(page.getByText('Иван Петров')).toBeVisible()

    // Stored as +79123456789; searched for with the punctuation a guest would write.
    await page.getByPlaceholder('Поиск по телефону').fill('+7 (912) 345-67-89')
    await expect(page.getByText('Иван Петров')).toBeVisible()
    await expect(page.getByText('+79123456789')).toBeVisible()
  })

  test('shows past stays and what is still owed', async ({ page }) => {
    const houseId = await seedHouse(HOUSE)
    await signIn(page)

    const first = stay(15, 2)
    await bookViaPage(page, {
      house_id: houseId,
      check_in: first.checkIn,
      check_out: first.checkOut,
      guest: { name: 'Ольга', phone: '+79120001122' },
      price_per_night: 30000,
      addons: [],
      deposit: 20000,
    })

    await page.getByRole('link', { name: 'Гости' }).click()
    await page.getByRole('button', { name: /Ольга/ }).click()

    await expect(page.getByRole('dialog', { name: 'Ольга' })).toBeVisible()
    await expect(page.getByText('Проживания')).toBeVisible()
    // 2 × 300 = 600, less 200 paid.
    await expect(page.getByText('400 ₽')).toBeVisible()
  })

  test('corrects a name without creating a second guest', async ({ page }) => {
    const houseId = await seedHouse(HOUSE)
    await signIn(page)

    const { checkIn, checkOut } = stay(19, 1)
    await bookViaPage(page, {
      house_id: houseId,
      check_in: checkIn,
      check_out: checkOut,
      guest: { name: 'иван', phone: '+79123456789' },
      price_per_night: 30000,
      addons: [],
      deposit: 0,
    })

    await page.getByRole('link', { name: 'Гости' }).click()
    await page.getByRole('button', { name: /иван/ }).click()
    await page.getByLabel('Имя').fill('Иван Петров')
    await page.getByRole('button', { name: 'Сохранить' }).click()

    await expect(page.getByText('Иван Петров')).toBeVisible()
    await expect(page.locator('.guests__row')).toHaveCount(1)
  })
})
