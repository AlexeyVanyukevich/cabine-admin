import { Kysely, sql } from 'kysely'

/**
 * The currency the owner prices in.
 *
 * Two places, for one reason. The setting is what a price entered now means, and the owner can
 * change it. The column on a booking is what that booking meant when it was made, and nothing
 * can change it — the same rule that already keeps the price on the row rather than read live
 * from the house. Without the snapshot, changing the setting would relabel settled totals and
 * show the owner a debt that was never agreed.
 *
 * Nothing is converted here and nothing ever will be. The backfill names the currency every
 * existing row is already denominated in.
 *
 * The check constraints test the *shape* of a code, not which codes are allowed. Membership
 * belongs to `shared/currency.ts`, enforced at the route: the list on offer is going to grow,
 * and pinning it into the schema would make each addition a migration.
 */
const CODE_SHAPE = sql`~ '^[A-Z]{3}$'`

export async function up(db: Kysely<any>): Promise<void> {
  // An ordinary key rather than a pinned one, following `owners`: a row nothing can be joined
  // to has to be rewritten the day it needs a foreign key. The row is created here and only
  // ever updated afterwards, so a second one cannot appear through the application.
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
