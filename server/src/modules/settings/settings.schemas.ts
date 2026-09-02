import { Type } from 'typebox'
import { CURRENCY_CODES } from '../../shared/currency.js'

/**
 * Built from the one list in `shared/currency.ts`, so a currency is added in a single place
 * and the route starts accepting it with no second edit to keep in step.
 *
 * A union of the codes on offer rather than a pattern on the string: a code can be well formed
 * and still be one we cannot store. The database constraint tests the shape; membership is
 * decided here, at the edge, where it can answer a bad request rather than fail.
 */
export const CurrencyCode = Type.Union(CURRENCY_CODES.map((code) => Type.Literal(code)))

export const UpdateSettingsBody = Type.Object(
  { currency: CurrencyCode },
  { additionalProperties: false },
)
