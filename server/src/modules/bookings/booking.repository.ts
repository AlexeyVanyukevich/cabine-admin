import type { Kysely, Selectable } from 'kysely'
import type { BookingDetailsTable, Database } from '../../db/schema.js'

export type BookingDetails = Selectable<BookingDetailsTable>

export interface BookingDetailsInput {
  engine_booking_id: string
  guest_id: string
  price_per_night: number
  addons_snapshot: string
  /** Snapshotted alongside the price, and never rewritten. See `003_currency`. */
  currency: string
  deposit: number
  note: string | null
}

export class BookingRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(values: BookingDetailsInput): Promise<BookingDetails> {
    return this.db
      .insertInto('booking_details')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  byEngineId(engineBookingId: string): Promise<BookingDetails | undefined> {
    return this.db
      .selectFrom('booking_details')
      .selectAll()
      .where('engine_booking_id', '=', engineBookingId)
      .executeTakeFirst()
  }

  byEngineIds(engineBookingIds: string[]): Promise<BookingDetails[]> {
    if (engineBookingIds.length === 0) return Promise.resolve([])
    return this.db
      .selectFrom('booking_details')
      .selectAll()
      .where('engine_booking_id', 'in', engineBookingIds)
      .execute()
  }

  /** Rows here whose booking the engine does not have — flagged, never hidden. */
  all(): Promise<BookingDetails[]> {
    return this.db.selectFrom('booking_details').selectAll().execute()
  }

  byGuestId(guestId: string): Promise<BookingDetails[]> {
    return this.db
      .selectFrom('booking_details')
      .selectAll()
      .where('guest_id', '=', guestId)
      .execute()
  }

  update(
    engineBookingId: string,
    patch: { deposit?: number; note?: string | null },
  ): Promise<BookingDetails | undefined> {
    return this.db
      .updateTable('booking_details')
      .set({ ...patch, updated_at: new Date() })
      .where('engine_booking_id', '=', engineBookingId)
      .returningAll()
      .executeTakeFirst()
  }
}
