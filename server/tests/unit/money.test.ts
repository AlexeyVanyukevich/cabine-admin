import { describe, expect, it } from 'vitest'
import { balanceFor, totalFor } from '../../src/shared/money.js'

describe('totalFor', () => {
  it('multiplies nights and adds the extras', () => {
    expect(
      totalFor({
        pricePerNight: 30000,
        nights: 2,
        addons: [{ code: 'sauna', label: 'Баня', price: 5000 }],
      }),
    ).toBe(65000)
  })

  it('handles no extras', () => {
    expect(totalFor({ pricePerNight: 30000, nights: 3, addons: [] })).toBe(90000)
  })

  it('stays an integer — no rounding, ever', () => {
    const total = totalFor({ pricePerNight: 33333, nights: 3, addons: [] })
    expect(Number.isInteger(total)).toBe(true)
    expect(total).toBe(99999)
  })

  it.each([
    ['a fractional price', { pricePerNight: 300.5, nights: 1, addons: [] }],
    ['a fractional night count', { pricePerNight: 300, nights: 1.5, addons: [] }],
    ['a negative price', { pricePerNight: -1, nights: 1, addons: [] }],
    ['no nights', { pricePerNight: 300, nights: 0, addons: [] }],
  ])('refuses %s', (_name, input) => {
    expect(() => totalFor(input)).toThrow()
  })
})

describe('balanceFor', () => {
  it('is what is still owed', () => {
    expect(balanceFor(65000, 20000)).toBe(45000)
  })

  it('is zero when settled', () => {
    expect(balanceFor(65000, 65000)).toBe(0)
  })

  // An overpayment is real — a guest rounds up, or cancels after paying. Showing it as a
  // negative balance is honest; clamping to zero would hide money the owner may owe back.
  it('goes negative on an overpayment rather than clamping', () => {
    expect(balanceFor(65000, 70000)).toBe(-5000)
  })
})
