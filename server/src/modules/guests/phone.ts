import { ValidationError } from '../../shared/errors.js'

/**
 * The phone is the guest's identity, so `8 912 …` and `+7 912 …` must reduce to one value —
 * otherwise the same person accumulates two histories and the owner sees neither in full.
 *
 * Only the Russian leading `8` is rewritten, because that is the local convention this owner
 * meets. Everything else keeps the country code it was given.
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  const withCountry = digits.startsWith('8') ? `+7${digits.slice(1)}` : digits
  const normalised = withCountry.startsWith('+') ? withCountry : `+${withCountry}`

  if (!/^\+\d{10,15}$/.test(normalised)) {
    throw new ValidationError(`Not a phone number: ${JSON.stringify(raw)}`)
  }
  return normalised
}
