import { describe, expect, it } from 'vitest'
import { currencyOf, money, owedByCurrency, toMajor, toMinor } from '../src/money'

const RUB = { code: 'RUB', symbol: '₽' }
const BYN = { code: 'BYN', symbol: 'Br' }
const EUR = { code: 'EUR', symbol: '€' }

describe('money', () => {
  it('renders minor units with the symbol it is given', () => {
    expect(money(65000, RUB)).toBe('650 ₽')
  })

  /**
   * The whole point of the feature: the same integer, a different symbol. Nothing converts —
   * 65000 is 650 of whatever the booking was agreed in.
   */
  it('renders the same amount in another currency without converting it', () => {
    expect(money(65000, BYN)).toBe('650 Br')
  })

  it('keeps the kopecks when there are any', () => {
    expect(money(65050, RUB)).toBe('650,5 ₽')
  })

  // Russian grouping regardless of the currency: the interface is in Russian, and a euro
  // price should not suddenly read as 1,234.
  it('groups thousands the Russian way whatever the currency', () => {
    expect(money(123456750, EUR)).toBe('1 234 567,5 €')
  })

  it('shows a dash when there is no amount — an orphan booking has none', () => {
    expect(money(null, RUB)).toBe('—')
  })
})

describe('toMinor', () => {
  it('takes what the owner typed to integer minor units', () => {
    expect(toMinor('650')).toBe(650_00)
  })

  it('accepts the comma a Russian keyboard produces', () => {
    expect(toMinor('650,5')).toBe(650_50)
  })

  it('rounds once, here, so no total is ever computed from a fraction', () => {
    expect(toMinor('0.005')).toBe(1)
    expect(Number.isInteger(toMinor('33.333'))).toBe(true)
  })

  it.each([
    ['letters', 'много'],
    ['a negative amount', '-1'],
    ['nothing usable', '—'],
  ])('refuses %s', (_name, input) => {
    expect(toMinor(input)).toBeNaN()
  })
})

describe('toMajor', () => {
  it('fills the input with what the owner would type', () => {
    expect(toMajor(65000)).toBe('650')
  })

  it('is empty when there is nothing to edit', () => {
    expect(toMajor(null)).toBe('')
  })
})

describe('owedByCurrency', () => {
  it('adds up what is still owed', () => {
    expect(
      owedByCurrency([
        { balance: 20000, currency: 'RUB' },
        { balance: 5000, currency: 'RUB' },
      ]),
    ).toEqual([{ currency: 'RUB', owed: 25000 }])
  })

  /**
   * The reason this function exists. A guest who stayed before the switch and after it owes
   * two amounts, not one — adding them would invent a number in neither currency.
   */
  it('keeps currencies apart instead of adding them together', () => {
    expect(
      owedByCurrency([
        { balance: 20000, currency: 'RUB' },
        { balance: 5000, currency: 'BYN' },
      ]),
    ).toEqual([
      { currency: 'RUB', owed: 20000 },
      { currency: 'BYN', owed: 5000 },
    ])
  })

  it('does not let an overpaid stay cancel out a debt', () => {
    expect(
      owedByCurrency([
        { balance: -10000, currency: 'RUB' },
        { balance: 5000, currency: 'RUB' },
      ]),
    ).toEqual([{ currency: 'RUB', owed: 5000 }])
  })

  it('leaves out a currency that is square', () => {
    expect(
      owedByCurrency([
        { balance: 0, currency: 'RUB' },
        { balance: 5000, currency: 'BYN' },
      ]),
    ).toEqual([{ currency: 'BYN', owed: 5000 }])
  })

  // An orphan has no amounts here at all — there is nothing to owe and nothing to name it in.
  it('skips a booking this project knows nothing about', () => {
    expect(owedByCurrency([{ balance: null, currency: null }])).toEqual([])
  })

  it('is empty when nothing is owed', () => {
    expect(owedByCurrency([])).toEqual([])
  })
})

describe('currencyOf', () => {
  const offered = [RUB, BYN]

  it('finds how to render a code', () => {
    expect(currencyOf('BYN', offered).symbol).toBe('Br')
  })

  /**
   * A booking snapshotted in a currency later dropped from the list still has to render.
   * «650 RUB» is unlovely; a symbol borrowed from some other currency would be a lie.
   */
  it('falls back to the code itself rather than borrow another symbol', () => {
    expect(currencyOf('SEK', offered).symbol).toBe('SEK')
  })

  // Prices render before the settings request lands. The code is honest in the meantime.
  it('does not need the list to have arrived yet', () => {
    expect(currencyOf('RUB', undefined).symbol).toBe('RUB')
  })

  it('has nothing to show for an orphan, which has no amounts anyway', () => {
    expect(currencyOf(null, offered).symbol).toBe('')
  })
})
