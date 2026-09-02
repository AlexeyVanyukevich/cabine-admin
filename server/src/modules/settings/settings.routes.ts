import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { SettingsRepository } from './settings.repository.js'
import { SettingsService } from './settings.service.js'
import { UpdateSettingsBody } from './settings.schemas.js'

export function registerSettings(instance: FastifyInstance): void {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>()
  const service = new SettingsService(new SettingsRepository(app.db))

  app.get('/api/settings', async () => service.read())

  app.patch('/api/settings', { schema: { body: UpdateSettingsBody } }, async (request) =>
    service.update(request.body),
  )
}
