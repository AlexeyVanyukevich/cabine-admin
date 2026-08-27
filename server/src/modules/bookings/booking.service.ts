import { randomUUID } from 'node:crypto'
import type { AddonSnapshot } from '../../db/schema.js'
import type { EngineBooking, EngineClient } from '../../engine/client.js'
import { NotFoundError, ValidationError } from '../../shared/errors.js'
import { balanceFor, totalFor } from '../../shared/money.js'
import { nightsBetween } from '../../shared/nights.js'
import type { Guest } from '../guests/guest.repository.js'
import type { GuestService } from '../guests/guest.service.js'
import type { House } from '../houses/house.repository.js'
import type { HouseService } from '../houses/house.service.js'
import type { BookingDetails, BookingRepository } from './booking.repository.js'

export interface BookingView {
  id: string
  house_id: string | null
  house_name: string | null
  check_in: string
  check_out: string
  nights: number
  status: EngineBooking['status']
  price_per_night: number | null
  addons: AddonSnapshot[]
  total: number | null
  deposit: number | null
  balance: number | null
  note: string | null
  guest: Pick<Guest, 'id' | 'name' | 'phone' | 'note'> | null
  /** True when the engine holds this night but no details were ever stored here. */
  orphan: boolean
}

export interface CalendarView {
  houses: Array<{ id: string; name: string; nights: Array<{ date: string; available: boolean }> }>
  bookings: BookingView[]
}

export interface CreateBookingInput {
  house_id: string
  check_in: string
  check_out: string
  guest: { name: string; phone: string; note?: string }
  price_per_night: number
  addons?: Array<{ code: string }>
  deposit?: number
  note?: string
}

export class BookingService {
  constructor(
    private readonly repository: BookingRepository,
    private readonly houses: HouseService,
    private readonly guests: GuestService,
    private readonly engine: EngineClient,
  ) {}

  /**
   * The label and the price are copied from the house as it is priced right now, and never
   * read live afterwards. Raising a rate in March must not rewrite the total of a January
   * booking, or the owner would see a debt that does not exist.
   */
  private snapshotAddons(house: House, requested: Array<{ code: string }> = []): AddonSnapshot[] {
    return requested.map(({ code }) => {
      const offered = house.addons.find((addon) => addon.code === code)
      if (offered === undefined) {
        throw new ValidationError(`${house.name} does not offer ${code}`, { field: 'addons' })
      }
      return { code: offered.code, label: offered.label, price: offered.default_price }
    })
  }

  /**
   * `nightsBetween` and `totalFor` throw plain Errors — they are pure functions with no
   * opinion about HTTP. Reaching a route uncaught they would become a 500, so an inverted
   * date range would be reported to the owner as a fault of ours rather than a typo.
   */
  private assertUsable(body: CreateBookingInput, addons: AddonSnapshot[], deposit: number): number {
    try {
      const nights = nightsBetween(body.check_in, body.check_out)
      totalFor({ pricePerNight: body.price_per_night, nights, addons })
      balanceFor(0, deposit)
      return nights
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Unusable booking')
    }
  }

  async create(body: CreateBookingInput): Promise<BookingView> {
    const house = await this.houses.byId(body.house_id)
    const addons = this.snapshotAddons(house, body.addons)
    const deposit = body.deposit ?? 0

    // Validated before anything is written, so a bad request never reaches the engine.
    this.assertUsable(body, addons, deposit)

    const { guest } = await this.guests.findOrCreate(body.guest)

    // The engine first, always. If the write below fails, a booking exists whose guest details
    // are missing: the night is correctly held and the calendar shows it as an orphan for the
    // owner to repair. The reverse order can leave a row for a booking that does not hold the
    // night, which is how two guests end up in one house.
    const engineBooking = await this.engine.createBooking(
      house.engine_resource_id,
      body.check_in,
      body.check_out,
      randomUUID(),
    )

    await this.repository.insert({
      engine_booking_id: engineBooking.id,
      guest_id: guest.id,
      price_per_night: body.price_per_night,
      addons_snapshot: JSON.stringify(addons),
      deposit,
      note: body.note ?? null,
    })

    return this.view(engineBooking, house, guest, {
      price_per_night: body.price_per_night,
      addons,
      deposit,
      note: body.note ?? null,
    })
  }

  /**
   * Matches the bound the engine puts on its own listings. Refusing here with a clear message
   * beats forwarding a request the engine will reject anyway.
   */
  private assertWindow(from: string, to: string): void {
    let nights: number
    try {
      nights = nightsBetween(from, to)
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Unusable window')
    }
    if (nights > 366) throw new ValidationError('A calendar window may not exceed 366 nights')
  }

  /**
   * Assembled from two systems and storing nothing of its own. Occupancy comes from the
   * engine's availability, which already accounts for closed dates and cancellations; the
   * bookings come from its listing; the guest and the money come from here.
   */
  async calendar(from: string, to: string): Promise<CalendarView> {
    this.assertWindow(from, to)
    const houses = await this.houses.list()

    const [bookings, ...availability] = await Promise.all([
      this.engine.listBookings(from, to),
      ...houses.map((house) => this.engine.availability(house.engine_resource_id, from, to)),
    ])

    const details = await this.repository.byEngineIds(bookings.map((booking) => booking.id))
    const byEngineId = new Map(details.map((row) => [row.engine_booking_id, row]))
    const guests = await Promise.all(
      details.map((row) => this.guests.byId(row.guest_id).catch(() => undefined)),
    )
    const guestById = new Map(
      guests.filter((guest) => guest !== undefined).map((guest) => [guest.id, guest]),
    )

    return {
      houses: houses.map((house, index) => ({
        id: house.id,
        name: house.name,
        nights: availability[index] ?? [],
      })),
      bookings: bookings.map((booking) => {
        const row = byEngineId.get(booking.id)
        const house = houses.find((h) => h.engine_resource_id === booking.resourceId)
        return this.viewFromRow(
          booking,
          house,
          row === undefined ? undefined : guestById.get(row.guest_id),
          row,
        )
      }),
    }
  }

  async reschedule(
    engineBookingId: string,
    checkIn: string,
    checkOut: string,
  ): Promise<BookingView> {
    const existing = await this.engine.getBooking(engineBookingId)
    if (existing === undefined) throw new NotFoundError(`No booking ${engineBookingId}`)

    try {
      nightsBetween(checkIn, checkOut)
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : 'Unusable stay')
    }

    // Nothing local to update: no dates are stored here, so a move cannot leave the two
    // systems disagreeing about when the stay is.
    await this.engine.reschedule(engineBookingId, checkIn, checkOut)
    return this.byId(engineBookingId)
  }

  async cancel(engineBookingId: string): Promise<BookingView> {
    const existing = await this.engine.getBooking(engineBookingId)
    if (existing === undefined) throw new NotFoundError(`No booking ${engineBookingId}`)

    // The details stay as history. No status is stored here, so there is nothing to mark.
    await this.engine.cancel(engineBookingId)
    return this.byId(engineBookingId)
  }

  async amend(
    engineBookingId: string,
    patch: { deposit?: number; note?: string | null },
  ): Promise<BookingView> {
    // Money and notes are ours alone; the engine is not involved and must not be called.
    const updated = await this.repository.update(engineBookingId, patch)
    if (updated === undefined) throw new NotFoundError(`No booking ${engineBookingId}`)
    return this.byId(engineBookingId)
  }

  async byId(engineBookingId: string): Promise<BookingView> {
    const engineBooking = await this.engine.getBooking(engineBookingId)
    if (engineBooking === undefined) throw new NotFoundError(`No booking ${engineBookingId}`)

    const details = await this.repository.byEngineId(engineBookingId)
    const houses = await this.houses.list()
    const house = houses.find((h) => h.engine_resource_id === engineBooking.resourceId)
    const guest = details === undefined ? undefined : await this.guests.byId(details.guest_id)

    return this.viewFromRow(engineBooking, house, guest, details)
  }

  view(
    engineBooking: EngineBooking,
    house: House | undefined,
    guest: Guest,
    money: {
      price_per_night: number
      addons: AddonSnapshot[]
      deposit: number
      note: string | null
    },
  ): BookingView {
    const nights = nightsBetween(engineBooking.checkIn, engineBooking.checkOut)
    const total = totalFor({
      pricePerNight: money.price_per_night,
      nights,
      addons: money.addons,
    })

    return {
      id: engineBooking.id,
      house_id: house?.id ?? null,
      house_name: house?.name ?? null,
      check_in: engineBooking.checkIn,
      check_out: engineBooking.checkOut,
      nights,
      status: engineBooking.status,
      price_per_night: money.price_per_night,
      addons: money.addons,
      total,
      deposit: money.deposit,
      balance: balanceFor(total, money.deposit),
      note: money.note,
      guest: { id: guest.id, name: guest.name, phone: guest.phone, note: guest.note },
      orphan: false,
    }
  }

  /**
   * A booking the engine holds but this project knows nothing about is rendered with nulls
   * and `orphan: true`, never dropped. A hidden booking is a night the owner believes is free.
   */
  viewFromRow(
    engineBooking: EngineBooking,
    house: House | undefined,
    guest: Guest | undefined,
    details: BookingDetails | undefined,
  ): BookingView {
    const nights = nightsBetween(engineBooking.checkIn, engineBooking.checkOut)

    if (details === undefined || guest === undefined) {
      return {
        id: engineBooking.id,
        house_id: house?.id ?? null,
        house_name: house?.name ?? null,
        check_in: engineBooking.checkIn,
        check_out: engineBooking.checkOut,
        nights,
        status: engineBooking.status,
        price_per_night: null,
        addons: [],
        total: null,
        deposit: null,
        balance: null,
        note: null,
        guest: null,
        orphan: true,
      }
    }

    return this.view(engineBooking, house, guest, {
      price_per_night: details.price_per_night,
      addons: details.addons_snapshot,
      deposit: details.deposit,
      note: details.note,
    })
  }
}
