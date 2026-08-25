import type { AddonSnapshot } from '../db/schema.js'

/**
 * Every amount in this project is an integer in minor units. There is no rounding step here
 * and there must never be one: the moment a total is computed from a float, two screens
 * showing the same booking start disagreeing by a копейка.
 */
function assertMinorUnits(value: number, what: string): void {
  if (!Number.isInteger(value)) throw new Error(`${what} must be an integer in minor units`)
  if (value < 0) throw new Error(`${what} must not be negative`)
}

export function totalFor(input: {
  pricePerNight: number
  nights: number
  addons: AddonSnapshot[]
}): number {
  assertMinorUnits(input.pricePerNight, 'The nightly price')
  if (!Number.isInteger(input.nights) || input.nights < 1) {
    throw new Error('A stay must be a whole number of nights, at least one')
  }
  let total = input.pricePerNight * input.nights
  for (const addon of input.addons) {
    assertMinorUnits(addon.price, `The price of ${addon.code}`)
    total += addon.price
  }
  return total
}

/** Negative when the guest has overpaid. Not clamped — see the test that says why. */
export function balanceFor(total: number, deposit: number): number {
  assertMinorUnits(deposit, 'The deposit')
  return total - deposit
}
