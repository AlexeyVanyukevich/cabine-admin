import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import type { Kysely } from 'kysely'
import type { Config } from './config.js'
import type { Database } from './db/schema.js'
import type { EngineClient } from './engine/client.js'
import { registerErrorHandler } from './shared/errors.js'
import { registerAuth } from './modules/auth/auth.routes.js'
import { registerHouses } from './modules/houses/house.routes.js'
import { registerGuests } from './modules/guests/guest.routes.js'
import { registerBookings } from './modules/bookings/booking.routes.js'
import { registerSettings } from './modules/settings/settings.routes.js'

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
  registerSettings(app)
  registerHouses(app)
  registerGuests(app)
  registerBookings(app)

  await registerSpa(app)

  return app
}

/**
 * The SPA is served by the same origin as the API: one deployable, no CORS, and the session
 * cookie needs no cross-site relaxation. Unknown paths fall through to index.html so a
 * client-side route survives a reload.
 */
async function registerSpa(app: FastifyInstance): Promise<void> {
  // `src/` under tsx, `dist/src/` once compiled. Both are checked rather than guessed at,
  // because guessing wrong shows an empty page in exactly one of the two environments.
  const root = [
    resolve(import.meta.dirname, '../public'),
    resolve(import.meta.dirname, '../../public'),
  ].find((candidate) => existsSync(join(candidate, 'index.html')))

  if (root !== undefined) {
    // `index: false` would answer 403 for `/` rather than falling through to the handler
    // below, so the root is served directly and only deeper client routes take the fallback.
    await app.register(fastifyStatic, { root, index: ['index.html'] })
  } else {
    // The API-only test suites run without a build, and a missing bundle must not stop the
    // server from answering /api.
    app.log.warn('no SPA build to serve; run npm run --workspace web build')
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || root === undefined) {
      return reply.status(404).send({ error: 'not_found', message: 'Route not found' })
    }
    return reply.sendFile('index.html')
  })
}
