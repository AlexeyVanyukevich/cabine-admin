import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { api, type Booking, type CalendarView } from '../api'
import { Timeline } from '../calendar/Timeline'
import { monthBounds, monthName, shiftMonth, today } from '../calendar/nights'
import './calendar.css'

export function Calendar() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [month, setMonth] = useState(() => monthBounds(today()).from)
  const { from, to } = monthBounds(month)

  const calendar = useQuery({
    queryKey: ['calendar', from, to],
    queryFn: () => api.get<CalendarView>(`/api/calendar?from=${from}&to=${to}`),
  })

  async function signOut() {
    await api.post('/api/logout')
    queryClient.clear()
    await navigate('/login', { replace: true })
  }

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
            <p className="notice__title">Календарь недоступен</p>
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
          <Timeline
            from={from}
            to={to}
            houses={calendar.data.houses}
            bookings={calendar.data.bookings}
            onOpenBooking={setOpen}
            onPickNight={() => undefined}
          />
        )}
      </main>
    </div>
  )
}

function setOpen(_booking: Booking) {
  // The booking sheet arrives in the next task.
}
