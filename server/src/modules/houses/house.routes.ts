import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { HouseRepository } from './house.repository.js'
import { HouseService } from './house.service.js'
import { CreateHouseBody, HouseParams, UpdateHouseBody } from './house.schemas.js'

export function registerHouses(instance: FastifyInstance): void {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>()
  const service = new HouseService(new HouseRepository(app.db), app.engine)

  app.get('/api/houses', async () => service.list())

  app.post('/api/houses', { schema: { body: CreateHouseBody } }, async (request, reply) => {
    const house = await service.create(request.body)
    return reply.status(201).send(house)
  })

  app.patch(
    '/api/houses/:id',
    { schema: { params: HouseParams, body: UpdateHouseBody } },
    async (request) => service.update(request.params.id, request.body),
  )
}
