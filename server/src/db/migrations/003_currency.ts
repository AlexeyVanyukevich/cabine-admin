import { Kysely, sql } from 'kysely'

/**
 * The currency the owner prices in.
 *
 * Two places, for one reason. `settings.currency` is what new prices mean *now*, and the
 * owner can change it. `booking_details.currency` is what a booking meant *when it was made*,
 * and nothing can change it — the same rule that already keeps `price_per_night` on the row
 * instead of read live from the house. Without the snapshot, switching to euros would relabel
 * every rouble in the history as a euro, and the owner would be looking at a debt that never
 * existed.
 *
 * Nothing is converted here and nothing ever will be. The backfill sets every existing row to
 * RUB because every existing row genuinely is roubles.
 *
 * The check constraints test the *shape* of a code, not which codes are allowed. Membership
 * belongs to `shared/currency.ts`, enforced at the route by a TypeBox enum: the list of
 * currencies on offer is going to grow, and pinning it into the schema would make each
 * addition a migration.
 */
const CODE_SHAPE = sql`~ '^[A-Z]{3}$'`

export async function up(db: Kysely<any>): Promise<void> {
  // No `id = 1` secret, following `owners`: a row nothing can be joined to has to be
  // rewritten the day it needs a foreign key. The row is created here and only ever updated
  // afterwards, so a second one cannot appear through the application.
  await db.schema
    .createTable('settings')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('currency', 'text', (col) => col.notNull().defaultTo('RUB'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('settings_currency_shape', sql`currency ${CODE_SHAPE}`)
    .execute()

  await db.insertInto('settings').values({ currency: 'RUB' }).execute()

  await db.schema
    .alterTable('booking_details')
    .addColumn('currency', 'text', (col) => col.notNull().defaultTo('RUB'))
    .execute()

  await db.schema
    .alterTable('booking_details')
    .addCheckConstraint('booking_details_currency_shape', sql`currency ${CODE_SHAPE}`)
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('booking_details')
    .dropConstraint('booking_details_currency_shape')
    .execute()
  await db.schema.alterTable('booking_details').dropColumn('currency').execute()
  await db.schema.dropTable('settings').execute()
}
