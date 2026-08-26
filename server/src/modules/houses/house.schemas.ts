import { Type } from 'typebox'
import { NonBlankString } from '../../shared/schemas.js'

/** Minor units, always. A fractional amount is a bug upstream, not something to round here. */
const Money = Type.Integer({ minimum: 0 })

const AddonInput = Type.Object(
  {
    code: NonBlankString({ maxLength: 64 }),
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
    addons: Type.Optional(Type.Array(AddonInput)),
  },
  { additionalProperties: false },
)

export const UpdateHouseBody = Type.Object(
  {
    name: Type.Optional(NonBlankString({ maxLength: 200 })),
    price_per_night: Type.Optional(Money),
    addons: Type.Optional(Type.Array(AddonInput)),
  },
  { additionalProperties: false },
)

export const HouseParams = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)
