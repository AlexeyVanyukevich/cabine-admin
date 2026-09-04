import type { Booking, CalendarHouse, CalendarView, House } from '../api'
import { eachNight, nightsBetween } from '../calendar/nights'
import type { Intent, IntentState } from './intents'

/**
 * The one place that decides what the owner believes is true: the last good read from the
 * server, with everything captured since laid over it.
 *
 * Pure and synchronous on purpose. Every offline-aware screen reads through this, so there is
 * one answer to that question rather than one per component — and it can be tested without a
 * browser, a database or a network.
 */
export interface OverlayBooking extends Booking {
  /** Absent for a booking the engine has confirmed. Present means: wanted, not yet agreed. */
  pending?: { intentId: string; state: IntentState }
}

export interface OverlayView {
  houses: CalendarHouse[]
  bookings: OverlayBooking[]
}

function bookingFor(intent: Intent, house: House | undefined): OverlayBooking {
  const nights = nightsBetween(intent.payload.check_in, intent.payload.check_out)

  // Labelled and priced from the house as it stands, matching what the server would have
  // snapshotted had the request gone through at capture time.
  const addons = intent.payload.addons.flatMap((chosen) => {
    const offered = house?.addons.find((addon) => addon.code === chosen.code)
    return offered === undefined
      ? []
      : [{ code: offered.code, label: offered.label, price: offered.default_price }]
  })

  const total =
    intent.payload.price_per_night * nights + addons.reduce((sum, addon) => sum + addon.price, 0)

  return {
    id: `intent:${intent.id}`,
    house_id: intent.payload.house_id,
    house_name: house?.name ?? null,
    check_in: intent.payload.check_in,
    check_out: intent.payload.check_out,
    nights,
    status: 'confirmed',
    price_per_night: intent.payload.price_per_night,
    addons,
    currency: intent.currency,
    total,
    deposit: intent.payload.deposit,
    balance: total - intent.payload.deposit,
    note: intent.payload.note ?? null,
    guest: {
      id: `intent:${intent.id}`,
      name: intent.payload.guest.name,
      phone: intent.payload.guest.phone,
      note: intent.payload.guest.note ?? null,
    },
    orphan: false,
    pending: { intentId: intent.id, state: intent.state },
  }
}

export function applyIntents(view: CalendarView, intents: Intent[], houses: House[]): OverlayView {
  if (intents.length === 0) return view

  const rendered = view.houses.map((house) => house.id)
  const relevant = intents.filter((intent) => rendered.includes(intent.payload.house_id))
  if (relevant.length === 0) return view

  // Every night any queued booking covers, per house. A conflicted intent counts too: until
  // the owner resolves it they still intend to hold those nights, and a night shown free that
  // someone believes is taken is the mistake that costs money.
  const taken = new Map<string, Set<string>>()
  for (const intent of relevant) {
    const nights = taken.get(intent.payload.house_id) ?? new Set<string>()
    for (const night of eachNight(intent.payload.check_in, intent.payload.check_out)) {
      nights.add(night)
    }
    taken.set(intent.payload.house_id, nights)
  }

  return {
    houses: view.houses.map((house) => {
      const nights = taken.get(house.id)
      if (nights === undefined) return house
      return {
        ...house,
        nights: house.nights.map((night) =>
          nights.has(night.date) ? { ...night, available: false } : night,
        ),
      }
    }),
    bookings: [
      ...view.bookings,
      ...relevant.map((intent) =>
        bookingFor(
          intent,
          houses.find((house) => house.id === intent.payload.house_id),
        ),
      ),
    ],
  }
}
