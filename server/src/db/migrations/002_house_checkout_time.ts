import { Kysely, sql } from 'kysely'

/**
 * Check-out is not an engine concept and never can be.
 *
 * A day-based slot runs from one boundary to the next, and that boundary is the house's
 * check-in time — `slot_anchor_time` in the engine, documented there as "a hotel with 14:00
 * check-in". A guest leaving at 11:00 leaves inside the slot that ends at 14:00, so those
 * three hours are turnaround: correctly unbookable, and invisible to availability.
 *
 * That makes check-out purely information for the guest, which is this project's half of the
 * split. Check-in is deliberately not copied here — it belongs to the engine, and a local
 * copy would be a second answer to a question the engine already owns.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('houses')
    .addColumn('checkout_time', 'time', (col) => col.notNull().defaultTo(sql`'11:00'`))
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('houses').dropColumn('checkout_time').execute()
}
