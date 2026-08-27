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
  await withDb((client) =>
    client.query(
      'truncate table booking_details, guests, house_addon_prices, houses, sessions, owners restart identity cascade',
    ),
  )
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
