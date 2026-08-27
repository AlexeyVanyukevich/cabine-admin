import { useEffect, useRef } from 'react'
import type { Booking, CalendarHouse } from '../api'
import type { SelectionState } from './useSelection'
import { eachNight, isWeekend, money, today, weekday } from './nights'
import './timeline.css'

interface Props {
  from: string
  to: string
  houses: CalendarHouse[]
  bookings: Booking[]
  selection: SelectionState
  onOpenBooking: (booking: Booking) => void
  onNightDown: (houseId: string, date: string, free: string[]) => void
  onNightOver: (houseId: string, date: string, free: string[]) => void
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
export function Timeline({
  from,
  to,
  houses,
  bookings,
  selection,
  onOpenBooking,
  onNightDown,
  onNightOver,
}: Props) {
  const nights = eachNight(from, to)
  const now = today()
  const todayRow = useRef<HTMLDivElement>(null)

  // Opening the calendar should land on now, not on the 1st. Only when the month in view is
  // the one containing today, so paging to another month keeps its own top.
  useEffect(() => {
    todayRow.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [from])

  const live = bookings.filter((booking) => booking.status !== 'cancelled')

  function bookingAt(house: CalendarHouse, date: string): Booking | undefined {
    return live.find(
      (booking) =>
        booking.house_id === house.id &&
        eachNight(booking.check_in, booking.check_out).includes(date),
    )
  }

  const freeIn = (house: CalendarHouse): string[] =>
    house.nights.filter((night) => night.available).map((night) => night.date)

  function selected(houseId: string, date: string): boolean {
    if (selection.kind !== 'selecting' || selection.houseId !== houseId) return false
    return eachNight(selection.checkIn, selection.checkOut).includes(date)
  }

  return (
    <div
      className="timeline"
      style={{ '--lanes': houses.length } as React.CSSProperties}
      // A drag that ends outside a cell still ends the gesture.
      onPointerLeave={() => undefined}
    >
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
              ref={isToday ? todayRow : undefined}
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
                  if (!nightAvailable) {
                    // Not free, and nothing in this window explains why. Never drawn as free.
                    return (
                      <div
                        key={house.id}
                        className="timeline__cell timeline__cell--blocked"
                        data-testid="night-cell"
                        data-available="false"
                      >
                        <span className="visually-hidden">Занято</span>
                      </div>
                    )
                  }

                  return (
                    <button
                      key={house.id}
                      type="button"
                      className={[
                        'timeline__cell',
                        'timeline__cell--free',
                        selected(house.id, date) ? 'timeline__cell--picked' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-testid="night-cell"
                      data-available="true"
                      data-house={house.name}
                      data-date={date}
                      onPointerDown={() => onNightDown(house.id, date, freeIn(house))}
                      onPointerEnter={() => onNightOver(house.id, date, freeIn(house))}
                    >
                      <span className="visually-hidden">
                        Свободно, {date}, {house.name}
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
                    data-testid="night-cell"
                    data-available="false"
                    data-house={house.name}
                    data-date={date}
                    onClick={() => onOpenBooking(booking)}
                  >
                    {(segment === 'start' || segment === 'only') && (
                      <span className="timeline__label" data-testid="booking-bar">
                        <span className="timeline__guest">
                          {booking.orphan ? 'Бронь без данных' : (booking.guest?.name ?? '—')}
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
