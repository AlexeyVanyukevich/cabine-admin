import type { EngineBooking, EngineClient } from '../../engine/client.js'

/** Plain UTC date. Good enough to mean "from now on", which is all the guard needs. */
export const todayUtc = (): string => new Date().toISOString().slice(0, 10)

/**
 * The bookings that make moving a house's check-in time unsafe.
 *
 * Check-in is the engine's `slot_anchor_time` — the instant a night begins. Moving it re-cuts
 * every boundary, so a booking made under the old one would straddle two new slots:
 * availability would show two nights taken instead of one, and rescheduling it could fail the
 * engine's own boundary check. Nothing is corrupted; the calendar just quietly stops matching
 * reality, which is the failure this project exists to prevent.
 *
 * Past stays do not matter — their nights are behind us and nobody is deciding anything from
 * them. Cancelled ones hold nothing. So the question is only: is anyone still coming?
 */
export async function bookingsBlockingCheckInChange(
  engine: EngineClient,
  engineResourceId: string,
  from: string = todayUtc(),
): Promise<EngineBooking[]> {
  // A year ahead: the engine's own bound on a listing, and further than this owner books.
  const to = `${Number(from.slice(0, 4)) + 1}-${from.slice(5)}`

  const bookings = await engine.listBookings(from, to)
  return bookings.filter(
    (booking) =>
      booking.resourceId === engineResourceId &&
      booking.status !== 'cancelled' &&
      booking.status !== 'expired',
  )
}
