import { Type } from 'typebox'
import { NonBlankString } from '../../shared/schemas.js'

/** Minor units, always. A fractional amount is a bug upstream, not something to round here. */
const Money = Type.Integer({ minimum: 0 })

/** `HH:MM`, 24-hour. */
const TimeOfDay = Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' })

/**
 * `code` is optional and generated when absent. It identifies an extra across renames and
 * reprices, which is a job for the machine — the owner supplies a label, not an identifier.
 */
const AddonInput = Type.Object(
  {
    code: Type.Optional(NonBlankString({ maxLength: 64 })),
    label: NonBlankString({ maxLength: 200 }),
    default_price: Money,
  },
  { additionalProperties: false },
)

export const CreateHouseBody = Type.Object(
  {
    engine_resource_id: Type.String({ format: 'uuid' }),
    name: NonBlankString({ maxLength: 200 }),
    price_per_night: Money,
    checkout_time: Type.Optional(TimeOfDay),
    addons: Type.Optional(Type.Array(AddonInput)),
  },
  { additionalProperties: false },
)

export const UpdateHouseBody = Type.Object(
  {
    name: Type.Optional(NonBlankString({ maxLength: 200 })),
    price_per_night: Type.Optional(Money),
    checkout_time: Type.Optional(TimeOfDay),
    addons: Type.Optional(Type.Array(AddonInput)),
  },
  { additionalProperties: false },
)

export const HouseParams = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)
