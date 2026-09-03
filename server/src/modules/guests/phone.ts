import { parsePhoneNumberFromString, type PhoneNumber } from 'libphonenumber-js'
import { InvalidPhoneError } from '../../shared/errors.js'

/** Where a number carrying no country code of its own is taken to come from. */
const HOME = 'BY'

/**
 * The neighbour sharing the trunk prefix. The two write it identically and only the length of
 * what follows tells them apart, so both readings are tried before either is chosen.
 */
const NEIGHBOUR = 'RU'

/**
 * The phone is the guest's identity, so every spelling of one number must reduce to a single
 * value — otherwise the same person accumulates two histories and the owner sees neither in
 * full. The result is always E.164.
 *
 * Parsing is left to libphonenumber, which carries every country's trunk prefixes, lengths and
 * formats. Hand-written rules cannot tell a domestic number from a foreign one typed without a
 * plus, and the ways they get it wrong are silent: a mangled number is a guest who can never
 * be found again.
 */
export function normalisePhone(raw: string): string {
  // The international dial-out prefix stands where the plus would. The parser reads it as part
  // of the national number, so it is rewritten before parsing rather than after.
  const text = raw.trim().replace(/^00(?=\d)/, '+')

  const readings = [
    parsePhoneNumberFromString(text, HOME),
    parsePhoneNumberFromString(text, NEIGHBOUR),
    // No domestic reading fits: the leading digits may be a country code typed without its
    // plus. Skipped when one is already there, which would make this reading a duplicate.
    text.startsWith('+') ? undefined : parsePhoneNumberFromString(`+${text}`),
  ].filter((reading): reading is PhoneNumber => reading !== undefined)

  // Validity picks between the readings; it does not decide whether the number is usable.
  // libphonenumber's data trails the operators, so a number in a range it has not learnt yet
  // is well-shaped and merely unvouched-for — and refusing to save the booking at all is the
  // worse of the two errors. Where both countries could claim a number, the home one is taken,
  // which only ever arises on service ranges a guest is not reached on.
  const chosen =
    readings.find((reading) => reading.isValid()) ??
    readings.find((reading) => reading.isPossible())

  if (chosen === undefined) {
    throw new InvalidPhoneError(`Not a phone number: ${JSON.stringify(raw)}`)
  }
  return chosen.number
}
