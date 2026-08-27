import type { ColumnType, Generated } from 'kysely'

export interface HousesTable {
  id: Generated<string>
  /** The engine's resource. This project never stores what the engine says about it. */
  engine_resource_id: string
  name: string
  /** Minor units. */
  price_per_night: number
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

export interface Database {
  houses: HousesTable
  house_addon_prices: HouseAddonPricesTable
  guests: GuestsTable
  booking_details: BookingDetailsTable
  owners: OwnersTable
  sessions: SessionsTable
}
