import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { ValidationError } from '../../shared/errors.js'

/**
 * The phone is the guest's identity, so every spelling of one number must reduce to a single
 * value — otherwise the same person accumulates two histories and the owner sees neither in
 * full. The result is always E.164.
 *
 * A number carries its own country code and nothing here supplies a missing one. A trunk
 * prefix is written alike across neighbouring countries and names none of them by itself, so
 * inferring one would file a guest under a number that is not theirs — silently, and only
 * discovered when they return and cannot be found. Refusing is the honest answer, and the
 * field's placeholder shows the shape that is wanted.
 */
export function normalisePhone(raw: string): string {
  const text = raw.trim()

  // The international dial-out prefix stands exactly where the plus would. Both spell the
  // country code out, so neither has to be inferred.
  const international = text.startsWith('+') ? text : `+${text.replace(/^00(?=\d)/, '')}`

  const parsed = parsePhoneNumberFromString(international)

  // Possible, not valid: libphonenumber's data trails the operators, so a number in a range it
  // has not learnt yet is well-shaped and merely unvouched-for. Refusing to save the booking
  // at all is the worse of the two errors.
  if (parsed === undefined || !parsed.isPossible()) {
    throw new ValidationError(`Not a phone number: ${JSON.stringify(raw)}`)
  }
  return parsed.number
}
