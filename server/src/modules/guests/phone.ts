import { ValidationError } from '../../shared/errors.js'

/**
 * The phone is the guest's identity, so `8 912 …` and `+7 912 …` must reduce to one value —
 * otherwise the same person accumulates two histories and the owner sees neither in full.
 *
 * A leading `8` is a trunk prefix rather than a country code, and the digit after it says which
 * country it stands for: `8 0…` is +375, any other `8 …` is +7. The two do not overlap, because
 * a +7 area code never starts with a zero — `8 800 …` reads as `88…` and stays where it was.
 *
 * Everything already carrying a country code keeps it.
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  const withCountry = digits.startsWith('80')
    ? `+375${digits.slice(2)}`
    : digits.startsWith('8')
      ? `+7${digits.slice(1)}`
      : digits
  const normalised = withCountry.startsWith('+') ? withCountry : `+${withCountry}`

  if (!/^\+\d{10,15}$/.test(normalised)) {
    throw new ValidationError(`Not a phone number: ${JSON.stringify(raw)}`)
  }
  return normalised
}
