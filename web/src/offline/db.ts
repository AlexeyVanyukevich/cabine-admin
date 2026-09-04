import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Intent } from './intents'

/**
 * Everything the owner captured but has not yet sent, plus the last good read of what they
 * captured it against.
 *
 * IndexedDB rather than `localStorage`: the intents are structured, the cache can hold a whole
 * month of two houses, and `localStorage` is synchronous, string-only, and dropped under
 * storage pressure without telling anyone. Losing a queued booking loses a booking that exists
 * nowhere else.
 */
export interface CacheEntry<T> {
  value: T
  /** ISO 8601. What the staleness notice renders. */
  fetchedAt: string
}

interface Stores extends DBSchema {
  cache: { key: string; value: CacheEntry<unknown> }
  intents: { key: string; value: Intent }
}

const NAME = 'cabins-offline'
const VERSION = 1

let open: Promise<IDBPDatabase<Stores>> | undefined

function db(): Promise<IDBPDatabase<Stores>> {
  open ??= openDB<Stores>(NAME, VERSION, {
    upgrade(database) {
      database.createObjectStore('cache')
      database.createObjectStore('intents', { keyPath: 'id' })
    },
  }).catch((cause: unknown) => {
    // A rejected promise left in `open` would disable the queue for the life of the page, and
    // the queue holds bookings that exist nowhere else. Drop it so the next call retries.
    open = undefined
    throw cause
  })
  return open
}

export async function putCache<T>(key: string, value: T): Promise<void> {
  await (await db()).put('cache', { value, fetchedAt: new Date().toISOString() }, key)
}

export async function readCache<T>(key: string): Promise<CacheEntry<T> | undefined> {
  return (await (await db()).get('cache', key)) as CacheEntry<T> | undefined
}

export async function putIntent(intent: Intent): Promise<void> {
  await (await db()).put('intents', intent)
}

/** Capture order, which is the order sync replays them in. */
export async function allIntents(): Promise<Intent[]> {
  const stored = await (await db()).getAll('intents')
  return stored.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
}

export async function dropIntent(id: string): Promise<void> {
  await (await db()).delete('intents', id)
}

/** Test seam only. Production never deletes the database. */
export async function resetForTests(): Promise<void> {
  const database = await db()
  await database.clear('cache')
  await database.clear('intents')
}
