import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { EngineError, EngineUnreachableError, isOwnerFacing } from '../../engine/errors.js'
import { AppError } from '../../shared/errors.js'
import { GuestRepository } from '../guests/guest.repository.js'
import { GuestService } from '../guests/guest.service.js'
import { HouseRepository } from '../houses/house.repository.js'
import { HouseService } from '../houses/house.service.js'
import { BookingRepository } from './booking.repository.js'
import { BookingService } from './booking.service.js'
import { BookingParams, CreateBookingBody } from './booking.schemas.js'

/** The engine could not be reached at all. Never an empty calendar — see the spec. */
export class EngineUnreachableAppError extends AppError {
  readonly statusCode = 503
  readonly code = 'engine_unreachable'
}

/** The engine answered, but with something that is not the owner's doing. */
export class EngineRejectedError extends AppError {
  readonly statusCode = 502
  readonly code = 'engine_rejected_our_key'
}

/**
 * The engine's vocabulary, translated once. Something the owner can act on keeps the engine's
 * own code and status so the interface can explain it; everything else becomes a 502 naming
 * the engine, because a defect here must never be dressed up as the owner's mistake.
 */
export function translateEngineError(error: unknown): never {
  if (error instanceof EngineUnreachableError) {
    throw new EngineUnreachableAppError('The booking engine did not answer')
  }
  if (error instanceof EngineError) {
    if (isOwnerFacing(error)) {
      throw new OwnerFacingEngineError(error.code, error.status, error.message)
    }
    if (error.status === 401) {
      throw new EngineRejectedError('The booking engine refused our key')
    }
    throw new EngineRejectedError(`The booking engine answered ${error.status}: ${error.message}`)
  }
  throw error
}

class OwnerFacingEngineError extends AppError {
  readonly statusCode: number
  readonly code: string

  constructor(code: string, statusCode: number, message: string) {
    super(message)
    this.code = code
    this.statusCode = statusCode
  }
}

export function registerBookings(instance: FastifyInstance): void {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>()

  const houses = new HouseService(new HouseRepository(app.db), app.engine)
  const guests = new GuestService(new GuestRepository(app.db))
  const service = new BookingService(new BookingRepository(app.db), houses, guests, app.engine)

  app.post('/api/bookings', { schema: { body: CreateBookingBody } }, async (request, reply) => {
    try {
      const booking = await service.create(request.body)
      return await reply.status(201).send(booking)
    } catch (error) {
      if (error instanceof AppError) throw error
      translateEngineError(error)
    }
  })

  app.get('/api/bookings/:id', { schema: { params: BookingParams } }, async (request) => {
    try {
      return await service.byId(request.params.id)
    } catch (error) {
      if (error instanceof AppError) throw error
      translateEngineError(error)
    }
  })
}
