import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { allIntents, dropIntent, putCache, putIntent, readCache, resetForTests } from '../src/offline/db'
import type { Intent } from '../src/offline/intents'

const INTENT: Intent = {
  id: '11111111-1111-4111-8111-111111111111',
  bookingId: null,
  op: 'create',
  capturedAt: '2026-09-04T10:00:00.000Z',
  currency: 'RUB',
  attempted: false,
  state: 'pending',
  payload: {
    house_id: '22222222-2222-4222-8222-222222222222',
    check_in: '2026-10-01',
    check_out: '2026-10-03',
    guest: { name: 'Аня', phone: '+375291234567' },
    price_per_night: 30000,
    addons: [],
    deposit: 0,
  },
}

beforeEach(async () => {
  await resetForTests()
})

describe('the cache store', () => {
  it('stamps what it stores with the time it was fetched', async () => {
    await putCache('calendar:2026-10-01:2026-11-01', { houses: [], bookings: [] })
    const entry = await readCache<{ houses: unknown[] }>('calendar:2026-10-01:2026-11-01')

    expect(entry?.value).toEqual({ houses: [], bookings: [] })
    // The stamp is what the staleness notice renders; without it the grid would have no way
    // to say how old it is, which is the whole basis for showing it at all.
    expect(entry?.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('replaces an entry wholesale rather than merging into it', async () => {
    await putCache('houses', [{ id: 'a' }, { id: 'b' }])
    await putCache('houses', [{ id: 'c' }])

    // A merge would resurrect a house the server has since deleted.
    expect((await readCache<unknown[]>('houses'))?.value).toEqual([{ id: 'c' }])
  })

  it('answers undefined for a key never written', async () => {
    expect(await readCache('nothing')).toBeUndefined()
  })
})

describe('the intent store', () => {
  it('round-trips an intent', async () => {
    await putIntent(INTENT)
    expect(await allIntents()).toEqual([INTENT])
  })

  it('keys by id, so saving twice updates rather than duplicates', async () => {
    await putIntent(INTENT)
    await putIntent({ ...INTENT, state: 'conflict' })

    const stored = await allIntents()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.state).toBe('conflict')
  })

  it('drops one by id', async () => {
    await putIntent(INTENT)
    await dropIntent(INTENT.id)
    expect(await allIntents()).toEqual([])
  })
})
