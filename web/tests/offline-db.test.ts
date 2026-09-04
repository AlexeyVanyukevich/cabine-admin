import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('returns intents in capture order, which is the order sync replays them in', async () => {
    // Ids sort the opposite way to capturedAt, and none of the three is written in either
    // order — so a dropped `.sort()`, or one that sorts by id instead of capturedAt, fails
    // this assertion instead of passing it by coincidence.
    const earliest: Intent = { ...INTENT, id: 'cccccccc-1111-4111-8111-cccccccccccc', capturedAt: '2026-09-01T00:00:00.000Z' }
    const middle: Intent = { ...INTENT, id: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', capturedAt: '2026-09-02T00:00:00.000Z' }
    const latest: Intent = { ...INTENT, id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', capturedAt: '2026-09-03T00:00:00.000Z' }

    await putIntent(middle)
    await putIntent(latest)
    await putIntent(earliest)

    expect(await allIntents()).toEqual([earliest, middle, latest])
  })
})

describe('recovering from a failed open', () => {
  it('retries on the next call instead of staying broken for the life of the page', async () => {
    // A private factory, swapped in only for this test: no connection any other test already
    // opened can block what comes next, the way a leaked connection against the shared
    // `indexedDB` would.
    const realIndexedDB = indexedDB
    const isolated = new IDBFactory()
    globalThis.indexedDB = isolated as unknown as IDBFactory

    try {
      // Bump the stored version out from under the module's fixed VERSION (1) by opening it
      // directly first, so the module's next open is rejected with a genuine, asynchronous
      // IndexedDB error — the same class of one-off failure a blocked upgrade or a quota error
      // would produce, not a contrived stand-in for one.
      const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = isolated.open('cabins-offline', 2)
        request.onupgradeneeded = () => {}
        request.onsuccess = () => resolve(request.result as unknown as IDBDatabase)
        request.onerror = () => reject(request.error)
      })

      vi.resetModules()
      const fresh = await import('../src/offline/db')

      await expect(fresh.putCache('x', 1)).rejects.toThrow()

      // Clear the condition that caused the failure, the way a real one eventually clears
      // (the blocking tab closes, quota frees up).
      blocker.close()
      await new Promise<void>((resolve, reject) => {
        const request = isolated.deleteDatabase('cabins-offline')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })

      // If the rejected open were still cached, this would throw the same stale error again.
      await fresh.putCache('x', 1)
      expect((await fresh.readCache('x'))?.value).toBe(1)
    } finally {
      globalThis.indexedDB = realIndexedDB
      vi.resetModules()
    }
  })
})
