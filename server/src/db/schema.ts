import type { ColumnType, Generated } from 'kysely'

export interface HousesTable {
  id: Generated<string>
  /** The engine's resource. This project never stores what the engine says about it. */
  engine_resource_id: string
  name: string
  /** Minor units. */
  price_per_night: number
  /**
   * `HH:MM`. Information for the guest and nothing more — a slot ends at the next boundary,
   * so the hours between check-out and that boundary are turnaround. Check-in is not here on
   * purpose: it is the engine's `slot_anchor_time`.
   */
  checkout_time: Generated<string>
  created_at: Generated<Date>
}

export interface HouseAddonPricesTable {
  id: Generated<string>
  house_id: string
  code: string
  label: string
  default_price: number
}

export interface GuestsTable {
  id: Generated<string>
  name: string
  /** Normalised; this is the guest's identity. */
  phone: string
  note: string | null
  created_at: Generated<Date>
}

/** One add-on as it was priced when the booking was made. */
export interface AddonSnapshot {
  code: string
  label: string
  price: number
}

/**
 * Everything the engine does not know about a booking. Deliberately holds no dates and no
 * status: those come from the engine on every read, so this row cannot disagree with it.
 */
export interface BookingDetailsTable {
  id: Generated<string>
  engine_booking_id: string
  guest_id: string
  price_per_night: number
  addons_snapshot: ColumnType<AddonSnapshot[], string, string>
  /**
   * What the amounts on this row meant when it was made, snapshotted for the same reason
   * `price_per_night` is: changing the setting later must not reinterpret a settled booking.
   */
  currency: Generated<string>
  deposit: number
  note: string | null
  created_at: Generated<Date>
  updated_at: ColumnType<Date, Date | undefined, Date>
}

/**
 * One row today. An ordinary primary key rather than a secret pinned to `id = 1`, because a
 * row nothing can be joined to has to be rewritten the day a second owner appears.
 */
export interface OwnersTable {
  id: Generated<string>
  /** For display only. There is no username: login asks for the password alone. */
  label: string
  password_hash: string
  created_at: Generated<Date>
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface SessionsTable {
  id: Generated<string>
  owner_id: string
  token_hash: string
  expires_at: ColumnType<Date, Date | string, Date | string>
  created_at: Generated<Date>
  last_seen_at: ColumnType<Date, Date | string | undefined, Date | string>
}

/**
 * App-wide settings, one row. Created by the migration and only ever updated, so the code
 * never has to decide what a second row would mean.
 */
export interface SettingsTable {
  id: Generated<string>
  /** ISO 4217 alpha-3. Which codes are allowed lives in `shared/currency.ts`, not here. */
  currency: Generated<string>
  created_at: Generated<Date>
  updated_at: ColumnType<Date, Date | undefined, Date>
}

export interface Database {
  houses: HousesTable
  house_addon_prices: HouseAddonPricesTable
  guests: GuestsTable
  booking_details: BookingDetailsTable
  owners: OwnersTable
  sessions: SessionsTable
  settings: SettingsTable
}
