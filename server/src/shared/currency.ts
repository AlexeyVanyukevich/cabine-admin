/**
 * The currency the owner prices in. One list, here, served to the browser over HTTP — the web
 * workspace deliberately keeps no copy, because a second copy of a table like this drifts and
 * nothing notices until a price renders with the wrong symbol.
 *
 * Every entry must divide into exactly 100 minor units. That is not a coincidence to be
 * relaxed later: every stored amount is an integer of hundredths, and `toMinor` on the web
 * multiplies by 100 on the way in. Admitting JPY, which has no minor unit, would not add a
 * currency — it would silently reinterpret every integer already in the database. A unit test
 * asserts the property against `Intl` for each entry, so adding a bad one fails the suite.
 */
export interface Currency {
  /** ISO 4217 alpha-3. */
  code: string
  symbol: string
}

export const CURRENCIES = [
  { code: 'RUB', symbol: '₽' },
  { code: 'BYN', symbol: 'Br' },
  { code: 'EUR', symbol: '€' },
  { code: 'USD', symbol: '$' },
] as const satisfies readonly Currency[]

/** Narrow, so the route schema and the service cannot disagree about what is on offer. */
export type CurrencyCode = (typeof CURRENCIES)[number]['code']

/** What every price in the database is already denominated in. */
export const DEFAULT_CURRENCY_CODE: CurrencyCode = 'RUB'

export const CURRENCY_CODES: readonly CurrencyCode[] = CURRENCIES.map((currency) => currency.code)

/**
 * Membership, not shape. A `^[A-Z]{3}$` test would accept JPY and every other code we cannot
 * store, which is exactly the failure this guards.
 */
export function isCurrencyCode(value: string): value is CurrencyCode {
  return CURRENCIES.some((currency) => currency.code === value)
}

/**
 * Throws a plain `Error` rather than a `ValidationError`: requests are already filtered by the
 * TypeBox enum at the route, so the only way to reach this with an unknown code is a row in
 * the database that should not exist. That is a bug, not a bad request.
 */
export function currencyFor(code: string): Currency {
  const currency = CURRENCIES.find((entry) => entry.code === code)
  if (currency === undefined) throw new Error(`${code} is not a currency this project supports`)
  return currency
}
