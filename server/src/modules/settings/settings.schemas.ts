import { Type } from 'typebox'
import { CURRENCY_CODES } from '../../shared/currency.js'

/**
 * Built from the one list in `shared/currency.ts`, so a currency is added in a single place
 * and the route starts accepting it with no second edit to keep in step.
 *
 * A union of literals rather than a pattern on the string. `^[A-Z]{3}$` would accept JPY,
 * which is a real currency with no minor unit — storing a price in it would reinterpret every
 * integer in the database. The database check constraint tests the shape; membership is
 * decided here, at the edge, where it can answer 400 instead of 500.
 */
export const CurrencyCode = Type.Union(CURRENCY_CODES.map((code) => Type.Literal(code)))

export const UpdateSettingsBody = Type.Object(
  { currency: CurrencyCode },
  { additionalProperties: false },
)
