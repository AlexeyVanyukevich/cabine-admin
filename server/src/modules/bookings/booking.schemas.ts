import { Type } from 'typebox'
import { NonBlankString } from '../../shared/schemas.js'
import { CurrencyCode } from '../settings/settings.schemas.js'

const Money = Type.Integer({ minimum: 0 })
const Date_ = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })

export const CreateBookingBody = Type.Object(
  {
    house_id: Type.String({ format: 'uuid' }),
    check_in: Date_,
    check_out: Date_,
    guest: Type.Object(
      {
        name: NonBlankString({ maxLength: 200 }),
        phone: NonBlankString({ maxLength: 40 }),
        note: Type.Optional(Type.String({ maxLength: 2000 })),
      },
      { additionalProperties: false },
    ),
    price_per_night: Money,
    // Only the code: the label and the price are copied from the house, never taken from the
    // caller, so a booking cannot be created at a price the owner never set.
    addons: Type.Optional(
      Type.Array(
        Type.Object({ code: NonBlankString({ maxLength: 64 }) }, { additionalProperties: false }),
      ),
    ),
    deposit: Type.Optional(Money),
    note: Type.Optional(Type.String({ maxLength: 2000 })),
    /**
     * Chosen by the client and forwarded to the engine, so replaying a request whose answer
     * was lost returns the booking already made rather than holding the night twice. Required:
     * there is one client, and an optional key degrades quietly into an unsafe retry.
     */
    idempotency_key: Type.String({ format: 'uuid' }),
    /**
     * What this booking was agreed in. Sent rather than read from settings because a booking
     * captured offline was priced when it was captured, and a setting changed in between must
     * not reinterpret a number already given to a guest.
     */
    currency: CurrencyCode,
  },
  { additionalProperties: false },
)

export const UpdateBookingBody = Type.Object(
  {
    deposit: Type.Optional(Money),
    note: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  },
  { additionalProperties: false },
)

export const RescheduleBody = Type.Object(
  { check_in: Date_, check_out: Date_ },
  { additionalProperties: false },
)

export const BookingParams = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)

export const CalendarQuery = Type.Object(
  { from: Date_, to: Date_ },
  { additionalProperties: false },
)
