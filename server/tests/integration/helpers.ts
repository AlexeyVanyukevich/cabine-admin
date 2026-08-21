import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { createDb } from '../../src/db/client.js'

/**
 * Task 2 replaces this with the real harness: a Postgres container and a booking engine
 * running beside it. Until then the only route is `/api/health`, which touches neither, and
 * Kysely opens no connection until something queries it.
 */
export async function buildTestApp(): Promise<FastifyInstance> {
  const app = await buildApp({
    config: {
      databaseUrl: 'postgres://postgres:postgres@127.0.0.1:5434/cabins',
      engineUrl: 'http://127.0.0.1:3000',
      engineApiKey: `bk_live_${'A'.repeat(51)}`,
      engineTimeoutMs: 5_000,
      port: 0,
      sessionTtlDays: 30,
      logLevel: 'silent',
    },
    db: createDb('postgres://postgres:postgres@127.0.0.1:5434/cabins'),
  })
  await app.ready()
  return app
}
