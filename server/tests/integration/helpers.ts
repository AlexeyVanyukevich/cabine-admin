import { inject } from 'vitest'
import { sql, type Kysely } from 'kysely'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../../src/app.js'
import { createDb } from '../../src/db/client.js'
import type { Database } from '../../src/db/schema.js'
import { createEngineClient, type EngineClient } from '../../src/engine/client.js'
import type { Config } from '../../src/config.js'

let cached: Kysely<Database> | undefined

export function getTestDb(): Kysely<Database> {
  cached ??= createDb(inject('databaseUrl'))
  return cached
}

export async function closeTestDb(): Promise<void> {
  await cached?.destroy()
  cached = undefined
}

export async function resetDb(): Promise<void> {
  await sql`truncate table booking_details, guests, house_addon_prices, houses, sessions, owners restart identity cascade`.execute(
    getTestDb(),
  )
}

/**
 * Built the way `server.ts` builds it. Overriding `config` points a real client at a dead
 * port or a revoked key, so the failure comes from the client rather than from a stub told
 * what to throw; overriding `engine` is the escape hatch for a failure the real client
 * cannot be talked into producing.
 */
export async function buildTestApp(
  overrides: { config?: Partial<Config>; engine?: EngineClient } = {},
): Promise<FastifyInstance> {
  const config: Config = {
    databaseUrl: inject('databaseUrl'),
    engineUrl: inject('engineUrl'),
    engineApiKey: inject('engineApiKey'),
    engineTimeoutMs: 5_000,
    port: 0,
    sessionTtlDays: 30,
    logLevel: 'silent',
    ...overrides.config,
  }

  const app = await buildApp({
    config,
    db: getTestDb(),
    engine:
      overrides.engine ??
      createEngineClient({
        engineUrl: config.engineUrl,
        engineApiKey: config.engineApiKey,
        timeoutMs: config.engineTimeoutMs,
      }),
  })
  await app.ready()
  return app
}
