import { expect, test } from '@playwright/test'
import { appUrl, resetAppDb, setOwnerPassword } from './helpers.js'

const PASSWORD = 'correct horse battery staple'

test.beforeEach(async () => {
  await resetAppDb()
  await setOwnerPassword(PASSWORD)
})

test('signs in and lands on the calendar', async ({ page }) => {
  await page.goto(appUrl('/'))
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page.getByRole('heading', { name: /Календарь/ })).toBeVisible()
})

test('says so when the password is wrong, and stays put', async ({ page }) => {
  await page.goto(appUrl('/login'))
  await page.getByLabel('Пароль').fill('nope')
  await page.getByRole('button', { name: 'Войти' }).click()

  await expect(page.getByText('Неверный пароль')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('a client-side route survives a reload', async ({ page }) => {
  await page.goto(appUrl('/login'))
  await page.getByLabel('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: /Календарь/ })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: /Календарь/ })).toBeVisible()
})

test('signing out ends the session everywhere, not just in this tab', async ({ page }) => {
  await page.goto(appUrl('/login'))
  await page.getByLabel('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: /Календарь/ })).toBeVisible()

  // Signing out lives on the Дома screen, beside the other things done rarely.
  await page.getByRole('link', { name: 'Дома' }).click()
  await page.getByRole('button', { name: 'Выйти' }).click()
  await expect(page).toHaveURL(/\/login$/)

  // The cookie is gone rather than merely ignored by this page.
  await page.goto(appUrl('/'))
  await expect(page).toHaveURL(/\/login$/)
})

// The invariant the whole architecture exists to protect.
test('the engine key is nowhere in what the browser receives', async ({ page }) => {
  const bodies: string[] = []
  page.on('response', async (response) => {
    const kind = response.request().resourceType()
    if (kind === 'document' || kind === 'script' || kind === 'stylesheet' || kind === 'xhr') {
      bodies.push(await response.text().catch(() => ''))
    }
  })

  await page.goto(appUrl('/login'))
  await page.getByLabel('Пароль').fill(PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { name: /Календарь/ })).toBeVisible()

  expect(bodies.join('\n')).not.toContain('bk_live_')
})
