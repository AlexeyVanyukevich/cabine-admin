import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { GuestRepository } from './guest.repository.js'
import { GuestService } from './guest.service.js'
import { CreateGuestBody, GuestParams, GuestQuery, UpdateGuestBody } from './guest.schemas.js'
import { createBookingService } from '../bookings/booking.routes.js'

export function registerGuests(instance: FastifyInstance): void {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>()
  const service = new GuestService(new GuestRepository(app.db))

  app.get('/api/guests', { schema: { querystring: GuestQuery } }, async (request) =>
    service.list(request.query.phone),
  )

  app.get('/api/guests/:id', { schema: { params: GuestParams } }, async (request) =>
    service.byId(request.params.id),
  )

  // Past stays. The dates live in the engine, so this is a join rather than a query — the
  // same shape the calendar uses, narrowed to one guest.
  app.get('/api/guests/:id/bookings', { schema: { params: GuestParams } }, async (request) =>
    createBookingService(app).forGuest(request.params.id),
  )

  app.post('/api/guests', { schema: { body: CreateGuestBody } }, async (request, reply) => {
    const { guest, created } = await service.findOrCreate(request.body)
    // 200 rather than 201 when the number was already known: nothing was created, and the
    // caller can tell the two apart without comparing ids.
    return reply.status(created ? 201 : 200).send(guest)
  })

  app.patch(
    '/api/guests/:id',
    { schema: { params: GuestParams, body: UpdateGuestBody } },
    async (request) => service.update(request.params.id, request.body),
  )
}
