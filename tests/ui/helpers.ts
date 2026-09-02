import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { hash } from '@node-rs/argon2'
import pg from 'pg'

interface Runtime {
  baseURL: string
  databaseUrl: string
  houseA: string
  houseB: string
}

let cached: Runtime | undefined

export function runtime(): Runtime {
  cached ??= JSON.parse(
    readFileSync(resolve(import.meta.dirname, '.runtime.json'), 'utf8'),
  ) as Runtime
  return cached
}

export function appUrl(path: string): string {
  return `${runtime().baseURL}${path}`
}

/**
 * The first day of the month `offset` months from now, as `YYYY-MM-DD`.
 *
 * Built with `Date.UTC` so December rolls into January — adding to the month number and
 * padding it produces "2026-13-01", which renders no nights at all and fails only in
 * December. Each spec file takes a different offset, because `resetAppDb` clears this
 * project's tables while the engine keeps its bookings for the whole run: two files booking
 * the same dates would collide on whichever ran second.
 */
export function monthStart(offset: number): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
    .toISOString()
    .slice(0, 10)
}

async function withDb<T>(work: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: runtime().databaseUrl })
  await client.connect()
  try {
    return await work(client)
  } finally {
    await client.end()
  }
}

/** Only this project's tables. The engine keeps its own bookings, exactly as in production. */
export async function resetAppDb(): Promise<void> {
  await withDb(async (client) => {
    await client.query(
      'truncate table booking_details, guests, house_addon_prices, houses, sessions, owners restart identity cascade',
    )
    // Not truncated: the settings row is seeded by the migration and only ever updated. It is
    // put back to the default so a spec that changes it cannot leak into the next one.
    await client.query("update settings set currency = 'RUB'")
  })
}

export async function setOwnerPassword(password: string): Promise<void> {
  const passwordHash = await hash(password)
  await withDb((client) =>
    client.query('insert into owners (label, password_hash) values ($1, $2)', [
      'The owner',
      passwordHash,
    ]),
  )
}

/**
 * Posts through the page's own `fetch` rather than Playwright's request context, which does
 * not carry the session cookie here and answers 401. This runs inside the browser, so it uses
 * exactly the session the user is signed in with.
 */
export async function bookViaPage(
  page: { evaluate: <A, R>(fn: (arg: A) => R, arg: A) => Promise<R> },
  payload: Record<string, unknown>,
): Promise<string> {
  return page.evaluate(async (body: Record<string, unknown>) => {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
    return ((await response.json()) as { id: string }).id
  }, payload)
}

/** `which` picks one of the harness's two engine resources; a house owns its resource alone. */
export async function seedHouse(name = 'Дом у озера', which: 'A' | 'B' = 'A'): Promise<string> {
  return withDb(async (client) => {
    const house = await client.query<{ id: string }>(
      'insert into houses (engine_resource_id, name, price_per_night) values ($1, $2, $3) returning id',
      [which === 'A' ? runtime().houseA : runtime().houseB, name, 30000],
    )
    const id = house.rows[0]!.id
    await client.query(
      'insert into house_addon_prices (house_id, code, label, default_price) values ($1, $2, $3, $4)',
      [id, 'sauna', 'Баня', 5000],
    )
    return id
  })
}
