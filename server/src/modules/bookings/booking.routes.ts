import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { GuestRepository } from '../guests/guest.repository.js'
import { GuestService } from '../guests/guest.service.js'
import { HouseRepository } from '../houses/house.repository.js'
import { HouseService } from '../houses/house.service.js'
import { SettingsRepository } from '../settings/settings.repository.js'
import { SettingsService } from '../settings/settings.service.js'
import { BookingRepository } from './booking.repository.js'
import { BookingService } from './booking.service.js'
import {
  BookingParams,
  CalendarQuery,
  CreateBookingBody,
  RescheduleBody,
  UpdateBookingBody,
} from './booking.schemas.js'

/**
 * No route here catches engine failures. `registerErrorHandler` translates them centrally,
 * so an unreachable engine cannot become a 500 in whichever route forgot to wrap itself —
 * and for the calendar that difference is "we cannot tell you" versus "everything is free".
 */
/**
 * Built the same way wherever it is needed, so the guests routes and the bookings routes
 * cannot end up with services wired differently.
 */
export function createBookingService(app: FastifyInstance): BookingService {
  const houses = new HouseService(new HouseRepository(app.db), app.engine)
  const guests = new GuestService(new GuestRepository(app.db))
  const settings = new SettingsService(new SettingsRepository(app.db))
  return new BookingService(new BookingRepository(app.db), houses, guests, app.engine, settings)
}

export function registerBookings(instance: FastifyInstance): void {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>()
  const service = createBookingService(app)

  app.post('/api/bookings', { schema: { body: CreateBookingBody } }, async (request, reply) =>
    reply.status(201).send(await service.create(request.body)),
  )

  app.get('/api/bookings/:id', { schema: { params: BookingParams } }, async (request) =>
    service.byId(request.params.id),
  )

  app.get('/api/calendar', { schema: { querystring: CalendarQuery } }, async (request) =>
    service.calendar(request.query.from, request.query.to),
  )

  app.post(
    '/api/bookings/:id/reschedule',
    { schema: { params: BookingParams, body: RescheduleBody } },
    async (request) =>
      service.reschedule(request.params.id, request.body.check_in, request.body.check_out),
  )

  app.post('/api/bookings/:id/cancel', { schema: { params: BookingParams } }, async (request) =>
    service.cancel(request.params.id),
  )

  app.patch(
    '/api/bookings/:id',
    { schema: { params: BookingParams, body: UpdateBookingBody } },
    async (request) => service.amend(request.params.id, request.body),
  )
}
