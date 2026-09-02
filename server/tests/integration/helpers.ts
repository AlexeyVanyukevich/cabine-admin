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
  // Not truncated: the settings row is seeded by the migration and only ever updated, so
  // emptying the table would leave the app with no settings at all — a state it cannot reach
  // in production and should not have to handle in tests.
  await sql`update settings set currency = 'RUB'`.execute(getTestDb())
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
    // High enough that a suite signing in on nearly every case does not race the limit.
    // `auth.test.ts` builds its own app with a low one to prove the limit still bites.
    loginAttemptsPerMinute: 1_000,
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
