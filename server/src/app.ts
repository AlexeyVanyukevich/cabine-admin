import Fastify, { type FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { Kysely } from 'kysely'
import type { Config } from './config.js'
import type { Database } from './db/schema.js'
import type { EngineClient } from './engine/client.js'
import { registerErrorHandler } from './shared/errors.js'
import { registerAuth } from './modules/auth/auth.routes.js'

export interface AppDeps {
  config: Config
  db: Kysely<Database>
  engine: EngineClient
}

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>
    config: Config
    engine: EngineClient
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
      // The engine key travels in this header on every outbound call; a logged request from
      // a debugging session would outlive the key it belongs to.
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>()

  app.decorate('db', deps.db)
  app.decorate('config', deps.config)
  app.decorate('engine', deps.engine)
  registerErrorHandler(app)

  app.get('/api/health', { config: { public: true } }, async () => ({ status: 'ok' }))

  await registerAuth(app)

  return app
}
