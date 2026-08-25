import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { closeTestDb, getTestDb, resetDb } from './helpers.js'

beforeEach(resetDb)
afterAll(closeTestDb)

describe('schema', () => {
  it.each(['houses', 'house_addon_prices', 'guests', 'booking_details', 'owners', 'sessions'])(
    'creates the %s table',
    async (table) => {
      const { rows } = await sql<{ count: string }>`
        select count(*)::text as count from information_schema.tables
        where table_schema = 'public' and table_name = ${table}
      `.execute(getTestDb())
      expect(rows[0]!.count).toBe('1')
    },
  )

  // The forward-compatible half of the login design: reshaping `owners` later is cheap, but
  // a sessions table without this column cannot gain it without a backfill.
  it('ties every session to an owner', async () => {
    const { rows } = await sql<{ is_nullable: string }>`
      select is_nullable from information_schema.columns
      where table_name = 'sessions' and column_name = 'owner_id'
    `.execute(getTestDb())
    expect(rows[0]?.is_nullable).toBe('NO')
  })

  // The single most important structural guarantee: no dates, no status, stored here.
  it.each(['start_time', 'end_time', 'check_in', 'check_out', 'status', 'nights', 'total'])(
    'has no %s column on booking_details',
    async (column) => {
      const { rows } = await sql<{ count: string }>`
        select count(*)::text as count from information_schema.columns
        where table_name = 'booking_details' and column_name = ${column}
      `.execute(getTestDb())
      expect(rows[0]!.count).toBe('0')
    },
  )

  it('stores money as integers', async () => {
    const { rows } = await sql<{ column_name: string; data_type: string }>`
      select column_name, data_type from information_schema.columns
      where (table_name, column_name) in
        (('houses','price_per_night'), ('house_addon_prices','default_price'),
         ('booking_details','price_per_night'), ('booking_details','deposit'))
    `.execute(getTestDb())
    expect(rows).toHaveLength(4)
    for (const row of rows) expect(row.data_type).toBe('integer')
  })

  it('refuses two bookings for the same engine booking', async () => {
    const db = getTestDb()
    const guest = await db
      .insertInto('guests')
      .values({ name: 'Ivan', phone: '+48111222333' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const row = {
      engine_booking_id: '00000000-0000-4000-8000-000000000000',
      guest_id: guest.id,
      price_per_night: 30000,
      addons_snapshot: JSON.stringify([]),
      deposit: 0,
    }
    await db.insertInto('booking_details').values(row).execute()
    await expect(db.insertInto('booking_details').values(row).execute()).rejects.toThrow()
  })

  it('refuses a second guest with the same phone', async () => {
    const db = getTestDb()
    await db.insertInto('guests').values({ name: 'Ivan', phone: '+48111222333' }).execute()
    await expect(
      db.insertInto('guests').values({ name: 'Someone else', phone: '+48111222333' }).execute(),
    ).rejects.toThrow()
  })

  it.each([
    ['a negative price', { price_per_night: -1 }],
    ['a negative deposit', { deposit: -1 }],
  ])('refuses %s', async (_name, override) => {
    const db = getTestDb()
    const guest = await db
      .insertInto('guests')
      .values({ name: 'Ivan', phone: '+48111222333' })
      .returning('id')
      .executeTakeFirstOrThrow()

    await expect(
      db
        .insertInto('booking_details')
        .values({
          engine_booking_id: '00000000-0000-4000-8000-000000000001',
          guest_id: guest.id,
          price_per_night: 30000,
          addons_snapshot: JSON.stringify([]),
          deposit: 0,
          ...override,
        })
        .execute(),
    ).rejects.toThrow()
  })
})
