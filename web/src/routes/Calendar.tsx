import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api, type Booking, type CalendarView, type House } from '../api'
import { Screen } from '../ui/Screen'
import { Timeline } from '../calendar/Timeline'
import { useSelection } from '../calendar/useSelection'
import { monthBounds, monthName, shiftMonth, today } from '../calendar/nights'
import { NewBooking, formatNight, type RebookRequest } from '../booking/NewBooking'
import { BookingDetails } from '../booking/BookingDetails'
import { applyIntents, type OverlayBooking } from '../offline/overlay'
import { dropIntent } from '../offline/db'
import { useCachedQuery, type Sync } from '../offline/useOffline'
import { messageFor } from '../errors'
import '../booking/booking.css'
import './calendar.css'

interface Props {
  sync: Sync
  /** A pending booking has no engine id, so its details sheet has nothing to fetch — this opens
   *  the tray instead. */
  onOpenTray: () => void
  /**
   * Set once, from the conflict screen's "Выбрать другие даты": the guest, price, add-ons and
   * deposit of a refused booking, carried over into whichever nights are picked next. The house
   * and the nights are deliberately not part of this — the engine's refusal was about occupancy,
   * so occupancy is exactly what the owner re-decides, on this same grid, by picking nights as usual.
   * Paired with the refused intent's id so it can be dropped once the replacement is saved.
   */
  rebooking?: RebookRequest
  /** Called once the draft above has been handed to a `NewBooking` sheet, so a later, unrelated
   *  booking on this same visit does not inherit a stranger's details. */
  onRebookHandled: () => void
}

/**
 * `fetchedAt` is a moment, not a calendar date, so it is read through `Date` rather than the
 * plain-string helpers in `calendar/nights.ts` — those exist to keep a *date* out of the
 * browser's timezone, which is not what a "sent at" wall-clock stamp needs.
 *
 * The date itself is included whenever `fetchedAt` isn't today: a grid cached yesterday and
 * opened offline the next morning is the ordinary case for a phone left offline overnight, and
 * "обновлён 14:32" with no date reads as this afternoon. The stamp exists precisely so the cache
 * can never claim to be more current than it is.
 */
function stampMoment(fetchedAt: string): string {
  const at = new Date(fetchedAt)
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return date === today() ? time : `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${time}`
}

export function Calendar({ sync, onOpenTray, rebooking, onRebookHandled }: Props) {
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

  // A pointer released anywhere ends the press, so a drag that leaves the grid still finishes
  // with the range it had rather than sticking to the cursor. A cancelled one is a finger that
  // began scrolling the grid, which is not a tap on the night it happened to start on.
  useEffect(() => {
    const up = () => dispatch({ type: 'up' })
    const abandon = () => dispatch({ type: 'abandon' })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', abandon)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', abandon)
    }
  }, [dispatch])

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
    selection.kind === 'idle'
      ? undefined
      : houses.data?.find((house) => house.id === selection.houseId)

  // The first night stays held until the press on the next one is released: until then it is
  // still the first night, and a press that turns into a scroll falls back to it.
  const held =
    selection.kind === 'anchored'
      ? selection
      : selection.kind === 'pressing'
        ? selection.resume
        : undefined
  const heldHouse =
    held === undefined ? undefined : houses.data?.find((house) => house.id === held.houseId)

  // In the pinned bar, so the month on screen is named, and can be changed, however far down
  // the grid the owner has scrolled. A held first night takes the month's place there rather than
  // pinning a bar over the grid, where it would cover the nights just after it — the likeliest
  // last ones. The two share one cell, so the bar keeps its height either way and the grid under
  // it never moves.
  const bar = (
    <div className="calbar">
      <div className={held === undefined ? 'monthbar' : 'monthbar monthbar--covered'}>
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
      {held !== undefined && (
        <div className="pickbar" role="status">
          <p className="pickbar__text">
            <strong>
              С {formatNight(held.checkIn)}
              {heldHouse === undefined ? '' : ` · ${heldHouse.name}`}
            </strong>
            <span>Нажмите на последнюю ночь</span>
          </p>
          <button
            className="pickbar__cancel"
            type="button"
            onClick={() => dispatch({ type: 'cancel' })}
          >
            Отмена
          </button>
        </div>
      )}
    </div>
  )

  return (
    <Screen
      title="Календарь"
      bar={bar}
      notice={
        calendar.stale && calendar.fetchedAt !== undefined
          ? `Календарь на память, обновлён ${stampMoment(calendar.fetchedAt)}`
          : undefined
      }
    >
      <div>
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
            {/* Whichever gesture the device makes: a finger cannot drag, and a mouse need not
                click twice. */}
            <p className="hint hint--touch">
              Нажмите на первую ночь брони, затем на последнюю. На одну ночь — дважды на неё.
            </p>
            <p className="hint hint--mouse">
              Нажмите на ночь, чтобы забронировать её, или протяните мышью по нескольким.
            </p>
            <Timeline
              from={from}
              to={to}
              houses={overlay.houses}
              bookings={overlay.bookings}
              selection={selection}
              onOpenBooking={openBooking}
              onNightDown={(houseId, date, free, pointerType) =>
                dispatch({ type: 'down', date, houseId, free, pointerType })
              }
              onNightOver={(houseId, date, free) => dispatch({ type: 'over', date, houseId, free })}
            />
          </>
        )}
      </div>

      {/* Only once the last night is picked. Opening it on the first press would put the sheet
          over the grid before the owner had finished choosing how many nights. */}
      {selection.kind === 'chosen' && pickedHouse !== undefined && (
        <NewBooking
          house={pickedHouse}
          checkIn={selection.checkIn}
          checkOut={selection.checkOut}
          {...(rebooking === undefined ? {} : { initial: rebooking.draft })}
          onCancel={() => {
            dispatch({ type: 'cancel' })
            if (rebooking !== undefined) {
              void dropIntent(rebooking.intentId).then(sync.reload)
              onRebookHandled()
            }
          }}
          onSaved={(outcome) => {
            void refresh(outcome)
            if (rebooking !== undefined) {
              void dropIntent(rebooking.intentId).then(sync.reload)
              onRebookHandled()
            }
          }}
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
