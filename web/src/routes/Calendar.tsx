import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type Booking, type CalendarView, type House } from '../api'
import { Screen } from '../ui/Screen'
import { Timeline } from '../calendar/Timeline'
import { useSelection } from '../calendar/useSelection'
import { monthBounds, monthName, shiftMonth, today } from '../calendar/nights'
import { NewBooking } from '../booking/NewBooking'
import { BookingDetails } from '../booking/BookingDetails'
import { applyIntents, type OverlayBooking } from '../offline/overlay'
import { useCachedQuery, type Sync } from '../offline/useOffline'
import { messageFor } from '../errors'
import '../booking/booking.css'
import './calendar.css'

interface Props {
  sync: Sync
  /** A pending booking has no engine id, so its details sheet has nothing to fetch — this opens
   *  the tray instead. */
  onOpenTray: () => void
}

/** `fetchedAt` is a moment, not a calendar date, so it is read through `Date` rather than the
 *  plain-string helpers in `calendar/nights.ts` — those exist to keep a *date* out of the
 *  browser's timezone, which is not what a "sent at" wall-clock stamp needs. */
function stampTime(fetchedAt: string): string {
  const at = new Date(fetchedAt)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

export function Calendar({ sync, onOpenTray }: Props) {
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(() => monthBounds(today()).from)
  const [open, setOpen] = useState<Booking | undefined>()
  const { selection, dispatch } = useSelection()
  const { from, to } = monthBounds(month)

  const calendar = useCachedQuery<CalendarView>(
    `calendar:${from}:${to}`,
    ['calendar', from, to],
    () => api.get<CalendarView>(`/api/calendar?from=${from}&to=${to}`),
  )

  const houses = useCachedQuery<House[]>('houses', ['houses'], () =>
    api.get<House[]>('/api/houses'),
  )

  // The overlay is the one place the grid and its bookings are decided: the last good read from
  // the server (or, offline, its cached stand-in), with everything captured since laid over it.
  const overlay =
    calendar.data === undefined
      ? undefined
      : applyIntents(calendar.data, sync.intents, houses.data ?? [])

  // A pointer released anywhere ends the gesture, so a drag that leaves the grid still
  // finishes with the range it had rather than sticking to the cursor.
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    function up() {
      setPicking(false)
    }
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [])

  // A sync round that actually sent something turns a queued booking into a real one. The
  // calendar fetch that produced `calendar.data` predates that, so without this it would render
  // the affected nights as free again the instant the matching intent drops out of the overlay —
  // exactly the "empty calendar reads as free" mistake this screen exists to prevent.
  //
  // Gated on `syncSerial`, not `sync.outcome`: a SECOND round that also sends something still
  // resolves to the same `'synced'` value as the first, and React does not re-run an effect
  // whose dependency compares equal to what it already held — the second batch's nights would
  // then flash free with nothing to correct them. `syncSerial` increments once per round that
  // actually sent something, so a repeated `'synced'` is still a distinct number.
  useEffect(() => {
    if (sync.syncSerial === 0) return
    void queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }, [sync.syncSerial, queryClient])

  /** Nothing is optimistic: the calendar is refetched, because a stale one costs money. */
  async function refresh(outcome: 'sent' | 'queued' = 'sent') {
    setOpen(undefined)
    dispatch({ type: 'cancel' })
    if (outcome === 'sent') {
      // A real booking landed on the server; the next read must see it.
      await queryClient.invalidateQueries({ queryKey: ['calendar'] })
    } else {
      // Nothing new to fetch — the overlay already shows it — but the overlay only shows what
      // `sync.intents` holds, and that was last read before this booking was captured.
      sync.reload()
    }
  }

  function openBooking(booking: OverlayBooking) {
    if (booking.pending !== undefined) {
      onOpenTray()
      return
    }
    setOpen(booking)
  }

  const pickedHouse =
    selection.kind === 'selecting'
      ? houses.data?.find((house) => house.id === selection.houseId)
      : undefined

  return (
    <Screen title="Календарь">
      <div className="monthbar">
        <button
          className="monthbar__step"
          type="button"
          aria-label="Предыдущий месяц"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          ←
        </button>
        <p className="monthbar__title">{monthName(month)}</p>
        <button
          className="monthbar__step"
          type="button"
          aria-label="Следующий месяц"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          →
        </button>
      </div>

      <div>
        {calendar.stale && calendar.fetchedAt !== undefined && (
          <p className="hint" role="status">
            Календарь на память, обновлён {stampTime(calendar.fetchedAt)}
          </p>
        )}

        {calendar.isPending && <p className="notice">Загружаем календарь…</p>}

        {calendar.error != null && (
          // Never an empty grid: a month of blank nights reads as "everything is free", and
          // that is the one mistake here that costs money.
          <div className="notice notice--bad" role="alert">
            <p className="notice__title">Движок недоступен</p>
            <p>{messageFor(calendar.error)}</p>
            <button type="button" onClick={() => calendar.refetch()}>
              Обновить
            </button>
          </div>
        )}

        {overlay && overlay.houses.length === 0 && (
          <div className="notice">
            <p className="notice__title">Пока нет домов</p>
            <p>Добавьте дом, и здесь появится календарь его ночей.</p>
          </div>
        )}

        {overlay && overlay.houses.length > 0 && (
          <>
            <p className="hint">Нажмите на свободную ночь, чтобы завести бронь.</p>
            <Timeline
              from={from}
              to={to}
              houses={overlay.houses}
              bookings={overlay.bookings}
              selection={selection}
              onOpenBooking={openBooking}
              onNightDown={(houseId, date, free) => {
                setPicking(true)
                dispatch({ type: 'start', date, houseId, free })
              }}
              onNightOver={(houseId, date, free) => {
                if (picking && selection.kind === 'selecting' && selection.houseId === houseId) {
                  dispatch({ type: 'over', date, free })
                }
              }}
            />
          </>
        )}
      </div>

      {/* Only once the gesture ends. Opening it on the first press would put the sheet over
          the grid before the owner had finished choosing how many nights. */}
      {selection.kind === 'selecting' && !picking && pickedHouse !== undefined && (
        <NewBooking
          house={pickedHouse}
          checkIn={selection.checkIn}
          checkOut={selection.checkOut}
          onCancel={() => dispatch({ type: 'cancel' })}
          onSaved={(outcome) => void refresh(outcome)}
        />
      )}

      {open !== undefined && (
        <BookingDetails
          booking={open}
          onClose={() => setOpen(undefined)}
          onChanged={() => void refresh()}
        />
      )}
    </Screen>
  )
}
