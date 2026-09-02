/**
 * The currency the owner prices in. One list, here, served to the browser over HTTP — the web
 * workspace deliberately keeps no copy, because a second copy of a table like this drifts and
 * nothing notices until a price renders with the wrong symbol.
 *
 * Every entry must divide into the same number of minor units, because stored amounts carry no
 * scale of their own. Admitting one that does not would reinterpret every integer already in
 * the database rather than add a currency. A unit test asserts the property for each entry.
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

/** Membership, not shape: a well-formed code is not necessarily one we can store. */
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
