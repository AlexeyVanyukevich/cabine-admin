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
   * The load-bearing test. Every amount in this project is an integer in minor units, and
   * both `toMinor` on the web and every stored integer assume that minor unit is a hundredth.
   * Adding JPY (0 decimals) or KWD (3) to the table would silently make every price in the
   * database mean something else. This fails the moment someone tries.
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

  /**
   * JPY is a real ISO 4217 code, which is the point: a shape check on the string would let it
   * through, and it has no minor unit at all.
   */
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
