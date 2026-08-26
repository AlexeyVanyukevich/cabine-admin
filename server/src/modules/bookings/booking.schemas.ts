import { Type } from 'typebox'
import { NonBlankString } from '../../shared/schemas.js'

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
