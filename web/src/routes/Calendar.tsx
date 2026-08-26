import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api, type Booking, type CalendarView, type House } from '../api'
import { Timeline } from '../calendar/Timeline'
import { useSelection } from '../calendar/useSelection'
import { monthBounds, monthName, shiftMonth, today } from '../calendar/nights'
import { NewBooking } from '../booking/NewBooking'
import { BookingDetails } from '../booking/BookingDetails'
import '../booking/booking.css'
import './calendar.css'

export function Calendar() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(() => monthBounds(today()).from)
  const [open, setOpen] = useState<Booking | undefined>()
  const { selection, dispatch } = useSelection()
  const { from, to } = monthBounds(month)

  const calendar = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.get<CalendarView>(`/api/calendar?from=${from}&to=${to}`),
  })

  const houses = useQuery({
    queryKey: ['houses'],
    queryFn: () => api.get<House[]>('/api/houses'),
  })

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

  /** Nothing is optimistic: the calendar is refetched, because a stale one costs money. */
  async function refresh() {
    setOpen(undefined)
    dispatch({ type: 'cancel' })
    await queryClient.invalidateQueries({ queryKey: ['calendar'] })
  }

  async function signOut() {
    await api.post('/api/logout')
    queryClient.clear()
    await navigate('/login', { replace: true })
  }

  const pickedHouse =
    selection.kind === 'selecting'
      ? houses.data?.find((house) => house.id === selection.houseId)
      : undefined

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar__brand">Журнал</div>
        <button className="topbar__signout" type="button" onClick={() => void signOut()}>
          Выйти
        </button>
      </header>

      <div className="monthbar">
        <button
          className="monthbar__step"
          type="button"
          aria-label="Предыдущий месяц"
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          ←
        </button>
        <h1 className="monthbar__title">Календарь · {monthName(month)}</h1>
        <button
          className="monthbar__step"
          type="button"
          aria-label="Следующий месяц"
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          →
        </button>
      </div>

      <main className="page__body">
        {calendar.isPending && <p className="notice">Загружаем календарь…</p>}

        {calendar.error && (
          // Never an empty grid: a month of blank nights reads as "everything is free", and
          // that is the one mistake here that costs money.
          <div className="notice notice--bad" role="alert">
            <p className="notice__title">Движок недоступен</p>
            <p>{calendar.error.message}</p>
            <button type="button" onClick={() => void calendar.refetch()}>
              Обновить
            </button>
          </div>
        )}

        {calendar.data && calendar.data.houses.length === 0 && (
          <div className="notice">
            <p className="notice__title">Пока нет домов</p>
            <p>Добавьте дом, и здесь появится календарь его ночей.</p>
          </div>
        )}

        {calendar.data && calendar.data.houses.length > 0 && (
          <>
            <p className="hint">Нажмите на свободную ночь, чтобы завести бронь.</p>
            <Timeline
              from={from}
              to={to}
              houses={calendar.data.houses}
              bookings={calendar.data.bookings}
              selection={selection}
              onOpenBooking={setOpen}
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
      </main>

      {/* Only once the gesture ends. Opening it on the first press would put the sheet over
          the grid before the owner had finished choosing how many nights. */}
      {selection.kind === 'selecting' && !picking && pickedHouse !== undefined && (
        <NewBooking
          house={pickedHouse}
          checkIn={selection.checkIn}
          checkOut={selection.checkOut}
          onCancel={() => dispatch({ type: 'cancel' })}
          onSaved={() => void refresh()}
        />
      )}

      {open !== undefined && (
        <BookingDetails
          booking={open}
          onClose={() => setOpen(undefined)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  )
}
