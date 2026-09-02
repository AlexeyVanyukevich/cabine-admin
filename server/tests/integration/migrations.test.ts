import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'kysely'
import { closeTestDb, getTestDb, resetDb } from './helpers.js'

beforeEach(resetDb)
afterAll(closeTestDb)

describe('schema', () => {
  it.each([
    'houses',
    'house_addon_prices',
    'guests',
    'booking_details',
    'owners',
    'sessions',
    'settings',
  ])('creates the %s table', async (table) => {
    const { rows } = await sql<{ count: string }>`
        select count(*)::text as count from information_schema.tables
        where table_schema = 'public' and table_name = ${table}
      `.execute(getTestDb())
    expect(rows[0]!.count).toBe('1')
  })

  // The forward-compatible half of the login design: reshaping `owners` later is cheap, but
  // a sessions table without this column cannot gain it without a backfill.
  it('ties every session to an owner', async () => {
    const { rows } = await sql<{ is_nullable: string }>`
      select is_nullable from information_schema.columns
      where table_name = 'sessions' and column_name = 'owner_id'
    `.execute(getTestDb())
    expect(rows[0]?.is_nullable).toBe('NO')
  })

  // Check-out has no engine equivalent. A slot ends at the next boundary, so the hours
  // between the guest leaving and that boundary are turnaround; the time itself is only
  // information for the guest, and lives here.
  it('keeps the check-out time on the house', async () => {
    const { rows } = await sql<{ data_type: string; is_nullable: string }>`
      select data_type, is_nullable from information_schema.columns
      where table_name = 'houses' and column_name = 'checkout_time'
    `.execute(getTestDb())
    expect(rows[0]?.data_type).toBe('time without time zone')
  })

  // Check-in is deliberately absent: it is the engine's slot_anchor_time, and a copy here
  // would be a second answer to a question the engine already owns.
  it('does not copy the check-in time', async () => {
    const { rows } = await sql<{ count: string }>`
      select count(*)::text as count from information_schema.columns
      where table_name = 'houses' and column_name in ('checkin_time', 'check_in_time')
    `.execute(getTestDb())
    expect(rows[0]!.count).toBe('0')
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

  // Every price already in the database was agreed in roubles, so that is what the migration
  // must leave behind — both for the setting and for every booking it backfills.
  it('starts the owner off in roubles', async () => {
    const row = await getTestDb().selectFrom('settings').select('currency').executeTakeFirst()
    expect(row?.currency).toBe('RUB')
  })

  it('backfills every existing booking to roubles', async () => {
    const { rows } = await sql<{ is_nullable: string; column_default: string | null }>`
      select is_nullable, column_default from information_schema.columns
      where table_name = 'booking_details' and column_name = 'currency'
    `.execute(getTestDb())
    expect(rows[0]?.is_nullable).toBe('NO')
    expect(rows[0]?.column_default).toContain('RUB')
  })

  /**
   * The constraint checks the shape of the code, never which codes are allowed. Membership is
   * enforced by the TypeBox enum at the route, from the one list in `shared/currency.ts`;
   * pinning that list into the schema would mean a migration every time one is added.
   */
  it('accepts a well-formed currency code', async () => {
    await getTestDb().updateTable('settings').set({ currency: 'BYN' }).execute()
    const row = await getTestDb().selectFrom('settings').select('currency').executeTakeFirst()
    expect(row?.currency).toBe('BYN')
  })

  it.each([
    ['lower case', 'byn'],
    ['too short', 'RU'],
    ['too long', 'RUBB'],
    ['not letters', 'R1B'],
  ])('refuses a currency that is %s', async (_name, currency) => {
    await expect(getTestDb().updateTable('settings').set({ currency }).execute()).rejects.toThrow()
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
