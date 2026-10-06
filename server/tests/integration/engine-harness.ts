import { startEngine as startPinnedEngine } from '@alexeyvanyukevich/booking-engine-testing'
import { createHouseResource } from '../../src/engine/house-resource.js'

export interface EngineHandle {
  url: string
  apiKey: string
  /**
   * The wider key the houses are seeded with. Never handed to the app, which runs on `apiKey`
   * alone; only test setup uses it, to create a house's resource.
   */
  adminKey: string
  /** Two day-based houses, open every day of the week, one checking in at 15:00, one at 14:00. */
  resourceIds: string[]
  stop: () => Promise<void>
}

/**
 * A suite sends one key far more requests a minute than the owner ever could. At the engine's
 * own limit it would be throttled for being a test suite, not for anything the code under test
 * did, so the limit is lifted beyond anything a run reaches.
 */
const RATE_LIMIT_PER_MINUTE = 100_000

/**
 * The engine's own test helper starts the release pinned in `server/package.json`: its
 * database, its migrations, one tenant holding a key per preset, and the API, on a private
 * network. Nothing here is stubbed — the defects worth catching live at the seam with the
 * engine.
 */
export async function startEngine(): Promise<EngineHandle> {
  const engine = await startPinnedEngine({
    keys: ['site_backend', 'back_office'],
    tenant: 'cabins-admin tests',
    rateLimitPerMinute: RATE_LIMIT_PER_MINUTE,
  })

  try {
    const { site_backend: apiKey, back_office: adminKey } = engine.keys
    if (apiKey === undefined || adminKey === undefined) {
      throw new Error('The engine did not issue both a site_backend and a back_office key')
    }
    const resourceIds = await seedHouses(engine.url, adminKey)
    return { url: engine.url, apiKey, adminKey, resourceIds, stop: () => engine.stop() }
  } catch (error) {
    await engine.stop()
    throw error
  }
}

/**
 * `site_backend` cannot create resources, so the houses are seeded with a second, wider key
 * that the app never sees — tests must exercise the same authority production has.
 *
 * The shape comes from `createHouseResource`, the same function the setup command uses, so
 * the houses these tests run against are the houses production creates.
 *
 * The two deliberately differ in check-in time. A single anchor everywhere would let a
 * hardcoded 15:00 slip in unnoticed, and the calendar would be wrong for one house only.
 */
async function seedHouses(engineUrl: string, adminKey: string): Promise<string[]> {
  return [
    await createHouseResource(engineUrl, adminKey, {
      timezone: 'Europe/Warsaw',
      checkInTime: '15:00',
    }),
    await createHouseResource(engineUrl, adminKey, {
      timezone: 'Europe/Warsaw',
      checkInTime: '14:00',
    }),
  ]
}
