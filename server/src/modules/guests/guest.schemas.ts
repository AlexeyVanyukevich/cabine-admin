import { Type } from 'typebox'
import { NonBlankString } from '../../shared/schemas.js'

export const CreateGuestBody = Type.Object(
  {
    name: NonBlankString({ maxLength: 200 }),
    phone: NonBlankString({ maxLength: 40 }),
    note: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
)

export const UpdateGuestBody = Type.Object(
  {
    name: Type.Optional(NonBlankString({ maxLength: 200 })),
    phone: Type.Optional(NonBlankString({ maxLength: 40 })),
    note: Type.Optional(Type.Union([Type.String({ maxLength: 2000 }), Type.Null()])),
  },
  { additionalProperties: false },
)

export const GuestQuery = Type.Object(
  { phone: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })) },
  { additionalProperties: false },
)

export const GuestParams = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { additionalProperties: false },
)
