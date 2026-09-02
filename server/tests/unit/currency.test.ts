import { describe, expect, it } from 'vitest'
import {
  CURRENCIES,
  DEFAULT_CURRENCY_CODE,
  currencyFor,
  isCurrencyCode,
} from '../../src/shared/currency.js'

describe('the currency table', () => {
  it('offers the ones the owner actually prices in', () => {
    expect(CURRENCIES.map((currency) => currency.code)).toEqual(
      expect.arrayContaining(['RUB', 'BYN']),
    )
  })

  it('starts life in roubles, which is what every existing price is in', () => {
    expect(DEFAULT_CURRENCY_CODE).toBe('RUB')
    expect(isCurrencyCode(DEFAULT_CURRENCY_CODE)).toBe(true)
  })

  it('names each currency exactly once', () => {
    const codes = CURRENCIES.map((currency) => currency.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it.each(CURRENCIES.map((currency) => [currency.code, currency] as const))(
    '%s is a well-formed entry',
    (_code, currency) => {
      expect(currency.code).toMatch(/^[A-Z]{3}$/)
      expect(currency.symbol.trim()).not.toBe('')
    },
  )

  /**
   * The load-bearing test. Every amount in this project is an integer in minor units, and both
   * the web's conversion and every stored integer assume one scale for all of them. Admitting
   * a currency on another scale would silently make every price in the database mean something
   * else. This fails the moment someone tries.
   */
  it.each(CURRENCIES.map((currency) => [currency.code, currency] as const))(
    '%s divides into exactly 100 minor units',
    (_code, currency) => {
      const digits = Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: currency.code,
      }).resolvedOptions().maximumFractionDigits
      expect(digits).toBe(2)
    },
  )
})

describe('isCurrencyCode', () => {
  it('accepts a code from the table', () => {
    expect(isCurrencyCode('BYN')).toBe(true)
  })

  // A code can be a real currency, and well formed, and still be one this project cannot
  // store — which is why membership is checked rather than shape.
  it.each([
    ['a real currency we do not offer', 'JPY'],
    ['something that is not a currency', 'XYZ'],
    ['the wrong case', 'byn'],
    ['padding', ' RUB'],
    ['nothing at all', ''],
  ])('rejects %s', (_name, value) => {
    expect(isCurrencyCode(value)).toBe(false)
  })
})

describe('currencyFor', () => {
  it('hands back how to render the amount', () => {
    expect(currencyFor('BYN')).toEqual({ code: 'BYN', symbol: 'Br' })
  })

  it('refuses a code that is not on the table', () => {
    expect(() => currencyFor('JPY')).toThrow(/JPY/)
  })
})
