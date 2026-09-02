import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js'
import { ValidationError } from '../../shared/errors.js'

/** Where a number with no country code of its own is assumed to come from. */
const HOME = 'BY'

/**
 * The neighbour sharing the trunk prefix. `8 029 …` and `8 912 …` are written identically and
 * only the length of what follows tells them apart, so both readings are tried.
 */
const NEIGHBOUR = 'RU'

/**
 * The phone is the guest's identity, so `8 029 …`, `29 …` and `+375 29 …` must reduce to one
 * value — otherwise the same person accumulates two histories and the owner sees neither in
 * full. The result is always E.164.
 *
 * Parsing is left to libphonenumber, which carries every country's trunk prefixes, lengths and
 * formats. Hand-written rules cannot tell a local number from a foreign one typed without a
 * plus, and the ways they get it wrong are silent: a mangled number is a guest who can never
 * be found again.
 */
export function normalisePhone(raw: string): string {
  // `00` is the international dial-out prefix and stands where the plus would be. The parser
  // reads it as part of the national number, so it is rewritten before parsing rather than
  // after.
  const text = raw.trim().replace(/^00(?=\d)/, '+')

  const readings = [
    parsePhoneNumberFromString(text, HOME),
    parsePhoneNumberFromString(text, NEIGHBOUR),
    // Nothing local fits: the leading digits may be a country code that was typed without its
    // plus. Skipped when one is already there, which would make this reading a duplicate.
    text.startsWith('+') ? undefined : parsePhoneNumberFromString(`+${text}`),
  ].filter((reading): reading is PhoneNumber => reading !== undefined)

  // Validity picks between the readings, but does not decide whether the number is usable.
  // libphonenumber's data trails the operators, so a number in a range it has not learnt yet
  // is well-shaped and merely unvouched-for — and refusing to save the booking at all is the
  // worse of the two errors.
  const chosen =
    readings.find((reading) => reading.isValid()) ??
    readings.find((reading) => reading.isPossible())

  if (chosen === undefined) {
    throw new ValidationError(`Not a phone number: ${JSON.stringify(raw)}`)
  }
  return chosen.number
}
