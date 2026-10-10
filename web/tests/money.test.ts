import { describe, expect, it } from 'vitest'
import { currencyOf, money, owedByCurrency, toMajor, toMinor } from '../src/money'

const RUB = { code: 'RUB', symbol: '₽' }
const BYN = { code: 'BYN', symbol: 'Br' }
const EUR = { code: 'EUR', symbol: '€' }

const MONEY: Array<{
  name: string
  amount: number | null
  currency: { code: string; symbol: string }
  expected: string
}> = [
  {
    name: 'renders minor units with the symbol it is given',
    amount: 65000,
    currency: RUB,
    expected: '650 ₽',
  },
  // The whole point of the feature: the same stored number, a different symbol. Nothing
  // converts.
  {
    name: 'renders the same amount in another currency without converting it',
    amount: 65000,
    currency: BYN,
    expected: '650 Br',
  },
  {
    name: 'keeps the kopecks when there are any',
    amount: 65050,
    currency: RUB,
    expected: '650,5 ₽',
  },
  // One grouping regardless of the currency: the interface is in one language, and changing
  // the symbol should not change how the number itself is written.
  {
    name: 'groups thousands the Russian way whatever the currency',
    amount: 123456750,
    currency: EUR,
    // The groups are split by no-break spaces, which a retyped space would not match.
    expected: '1\u00a0234\u00a0567,5 €',
  },
  {
    name: 'shows a dash when there is no amount — an orphan booking has none',
    amount: null,
    currency: RUB,
    expected: '—',
  },
]

describe('money', () => {
  it.each(MONEY)('$name', ({ amount, currency, expected }) => {
    expect(money(amount, currency)).toBe(expected)
  })
})

const ACCEPTED: Array<{ name: string; typed: string; expected: number }> = [
  { name: 'takes what the owner typed to integer minor units', typed: '650', expected: 650_00 },
  { name: 'accepts the comma a Russian keyboard produces', typed: '650,5', expected: 650_50 },
  {
    name: 'rounds once, here, so no total is ever computed from a fraction',
    typed: '0.005',
    expected: 1,
  },
]

const REFUSED: Array<{ name: string; typed: string }> = [
  { name: 'letters', typed: 'много' },
  { name: 'a negative amount', typed: '-1' },
  { name: 'nothing usable', typed: '—' },
]

describe('toMinor', () => {
  it.each(ACCEPTED)('$name', ({ typed, expected }) => {
    expect(toMinor(typed)).toBe(expected)
  })

  // A property rather than a value: whatever was typed, what comes back is whole.
  it('never hands back a fraction of a minor unit', () => {
    expect(Number.isInteger(toMinor('33.333'))).toBe(true)
  })

  it.each(REFUSED)('refuses $name', ({ typed }) => {
    expect(toMinor(typed)).toBeNaN()
  })
})

const MAJOR: Array<{ name: string; amount: number | null; expected: string }> = [
  { name: 'fills the input with what the owner would type', amount: 65000, expected: '650' },
  { name: 'is empty when there is nothing to edit', amount: null, expected: '' },
]

describe('toMajor', () => {
  it.each(MAJOR)('$name', ({ amount, expected }) => {
    expect(toMajor(amount)).toBe(expected)
  })
})

type Owed = Parameters<typeof owedByCurrency>[0]

const OWED: Array<{ name: string; bookings: Owed; expected: ReturnType<typeof owedByCurrency> }> = [
  {
    name: 'adds up what is still owed',
    bookings: [
      { balance: 20000, currency: 'RUB' },
      { balance: 5000, currency: 'RUB' },
    ],
    expected: [{ currency: 'RUB', owed: 25000 }],
  },
  // The reason this function exists. A guest who stayed either side of a change owes two
  // amounts, not one — adding them would invent a number in neither currency.
  {
    name: 'keeps currencies apart instead of adding them together',
    bookings: [
      { balance: 20000, currency: 'RUB' },
      { balance: 5000, currency: 'BYN' },
    ],
    expected: [
      { currency: 'RUB', owed: 20000 },
      { currency: 'BYN', owed: 5000 },
    ],
  },
  {
    name: 'does not let an overpaid stay cancel out a debt',
    bookings: [
      { balance: -10000, currency: 'RUB' },
      { balance: 5000, currency: 'RUB' },
    ],
    expected: [{ currency: 'RUB', owed: 5000 }],
  },
  {
    name: 'leaves out a currency that is square',
    bookings: [
      { balance: 0, currency: 'RUB' },
      { balance: 5000, currency: 'BYN' },
    ],
    expected: [{ currency: 'BYN', owed: 5000 }],
  },
  // An orphan has no amounts here at all — there is nothing to owe and nothing to name it in.
  {
    name: 'skips a booking this project knows nothing about',
    bookings: [{ balance: null, currency: null }],
    expected: [],
  },
  { name: 'is empty when nothing is owed', bookings: [], expected: [] },
]

describe('owedByCurrency', () => {
  it.each(OWED)('$name', ({ bookings, expected }) => {
    expect(owedByCurrency(bookings)).toEqual(expected)
  })
})

const OFFERED = [RUB, BYN]

const SYMBOLS: Array<{
  name: string
  code: string | null
  offered: Array<{ code: string; symbol: string }> | undefined
  expected: string
}> = [
  { name: 'finds how to render a code', code: 'BYN', offered: OFFERED, expected: 'Br' },
  // A booking snapshotted in a currency later dropped from the list still has to render.
  // Showing the bare code is unlovely; a symbol borrowed from another currency would be a lie.
  {
    name: 'falls back to the code itself rather than borrow another symbol',
    code: 'SEK',
    offered: OFFERED,
    expected: 'SEK',
  },
  // Prices render before the settings request lands. The code is honest in the meantime.
  {
    name: 'does not need the list to have arrived yet',
    code: 'RUB',
    offered: undefined,
    expected: 'RUB',
  },
  {
    name: 'has nothing to show for an orphan, which has no amounts anyway',
    code: null,
    offered: OFFERED,
    expected: '',
  },
]

describe('currencyOf', () => {
  it.each(SYMBOLS)('$name', ({ code, offered, expected }) => {
    expect(currencyOf(code, offered).symbol).toBe(expected)
  })
})
