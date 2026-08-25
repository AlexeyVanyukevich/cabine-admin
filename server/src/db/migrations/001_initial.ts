import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('houses')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('engine_resource_id', 'uuid', (col) => col.notNull().unique())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('price_per_night', 'integer', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('houses_price_not_negative', sql`price_per_night >= 0`)
    .addCheckConstraint('houses_name_not_blank', sql`length(btrim(name)) > 0`)
    .execute()

  await db.schema
    .createTable('house_addon_prices')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('house_id', 'uuid', (col) =>
      col.notNull().references('houses.id').onDelete('cascade'),
    )
    .addColumn('code', 'text', (col) => col.notNull())
    .addColumn('label', 'text', (col) => col.notNull())
    .addColumn('default_price', 'integer', (col) => col.notNull())
    .addUniqueConstraint('house_addon_prices_code_unique', ['house_id', 'code'])
    .addCheckConstraint('house_addon_prices_price_not_negative', sql`default_price >= 0`)
    .execute()

  await db.schema
    .createTable('guests')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('phone', 'text', (col) => col.notNull().unique())
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('guests_name_not_blank', sql`length(btrim(name)) > 0`)
    .execute()

  await db.schema
    .createTable('booking_details')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Not a foreign key: it points into another system's database.
    .addColumn('engine_booking_id', 'uuid', (col) => col.notNull().unique())
    .addColumn('guest_id', 'uuid', (col) =>
      col.notNull().references('guests.id').onDelete('restrict'),
    )
    .addColumn('price_per_night', 'integer', (col) => col.notNull())
    .addColumn('addons_snapshot', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('deposit', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint('booking_details_price_not_negative', sql`price_per_night >= 0`)
    .addCheckConstraint('booking_details_deposit_not_negative', sql`deposit >= 0`)
    .execute()

  await db.schema
    .createIndex('booking_details_guest_idx')
    .on('booking_details')
    .column('guest_id')
    .execute()

  // One row today, and no `id = 1` check: a second owner is likely enough that pinning the
  // secret to a fixed key would only have to be undone. See the spec's login section.
  await db.schema
    .createTable('owners')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('label', 'text', (col) => col.notNull())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // `owner_id` is here from the first migration on purpose. Reshaping `owners` later is cheap;
  // adding a not-null foreign key to a live sessions table means a backfill or signing
  // everybody out to get one.
  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('owner_id', 'uuid', (col) =>
      col.notNull().references('owners.id').onDelete('cascade'),
    )
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('last_seen_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await db.schema.createIndex('sessions_expires_idx').on('sessions').column('expires_at').execute()
  await db.schema.createIndex('sessions_owner_idx').on('sessions').column('owner_id').execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sessions').execute()
  await db.schema.dropTable('owners').execute()
  await db.schema.dropTable('booking_details').execute()
  await db.schema.dropTable('guests').execute()
  await db.schema.dropTable('house_addon_prices').execute()
  await db.schema.dropTable('houses').execute()
}
