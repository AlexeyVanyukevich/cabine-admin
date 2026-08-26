import type { Booking, CalendarHouse } from '../api'
import { eachNight, isWeekend, money, today, weekday } from './nights'
import './timeline.css'

interface Props {
  from: string
  to: string
  houses: CalendarHouse[]
  bookings: Booking[]
  onOpenBooking: (booking: Booking) => void
  onPickNight: (houseId: string, date: string) => void
}

/** Where a night sits inside its stay, which is what gives a block its shape. */
type Segment = 'start' | 'middle' | 'end' | 'only'

function segmentOf(booking: Booking, date: string): Segment {
  const lastNight = eachNight(booking.check_in, booking.check_out).at(-1)
  if (booking.nights === 1) return 'only'
  if (date === booking.check_in) return 'start'
  if (date === lastNight) return 'end'
  return 'middle'
}

/**
 * Nights run downwards, one row each, and every house is a lane.
 *
 * A month grid would wrap a stay across rows and hide the property this whole product rests
 * on: the departure date is not one of the stay's nights, so the next guest can arrive the
 * morning the last one leaves. Here the two blocks simply sit against each other, and the
 * owner can see the join. It also happens to be the shape a thumb scrolls.
 */
export function Timeline({ from, to, houses, bookings, onOpenBooking, onPickNight }: Props) {
  const nights = eachNight(from, to)
  const now = today()

  const live = bookings.filter((booking) => booking.status !== 'cancelled')

  function bookingAt(house: CalendarHouse, date: string): Booking | undefined {
    return live.find(
      (booking) =>
        booking.house_id === house.id &&
        eachNight(booking.check_in, booking.check_out).includes(date),
    )
  }

  return (
    <div className="timeline" style={{ '--lanes': houses.length } as React.CSSProperties}>
      <div className="timeline__head">
        <div className="timeline__corner" />
        {houses.map((house) => (
          <div key={house.id} className="timeline__house" title={house.name}>
            {house.name}
          </div>
        ))}
      </div>

      <div className="timeline__body">
        {nights.map((date) => {
          const isToday = date === now
          return (
            <div
              key={date}
              className={[
                'timeline__row',
                isWeekend(date) ? 'timeline__row--weekend' : '',
                isToday ? 'timeline__row--today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className="timeline__date">
                <span className="timeline__day">{Number(date.slice(8, 10))}</span>
                <span className="timeline__weekday">{weekday(date)}</span>
              </div>

              {houses.map((house) => {
                const booking = bookingAt(house, date)
                const nightAvailable =
                  house.nights.find((night) => night.date === date)?.available ?? true

                if (booking === undefined) {
                  // A night the engine calls taken with no booking behind it in this window —
                  // shown as blocked rather than free, because free is the dangerous guess.
                  if (!nightAvailable) {
                    return (
                      <div key={house.id} className="timeline__cell timeline__cell--blocked">
                        <span className="visually-hidden">Занято</span>
                      </div>
                    )
                  }
                  return (
                    <button
                      key={house.id}
                      type="button"
                      className="timeline__cell timeline__cell--free"
                      onClick={() => onPickNight(house.id, date)}
                    >
                      <span className="visually-hidden">
                        Свободно, {date}, {house.name}. Добавить бронь
                      </span>
                    </button>
                  )
                }

                const segment = segmentOf(booking, date)
                const owes = (booking.balance ?? 0) > 0

                return (
                  <button
                    key={house.id}
                    type="button"
                    className={[
                      'timeline__cell',
                      'timeline__cell--lit',
                      `timeline__cell--${segment}`,
                      booking.orphan ? 'timeline__cell--orphan' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => onOpenBooking(booking)}
                  >
                    {(segment === 'start' || segment === 'only') && (
                      <span className="timeline__label">
                        <span className="timeline__guest">
                          {booking.orphan ? 'Без имени' : (booking.guest?.name ?? '—')}
                        </span>
                        {owes && <span className="timeline__owed">{money(booking.balance)}</span>}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
