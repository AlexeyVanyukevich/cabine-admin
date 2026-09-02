import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type Booking, type Guest } from '../api'
import { Screen } from '../ui/Screen'
import { Sheet } from '../ui/Sheet'
import { currencyOf, money, owedByCurrency } from '../money'
import { useSettings } from '../settings'
import { formatStay } from '../booking/NewBooking'
import './guests.css'

export function Guests() {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Guest | undefined>()

  const query = search.trim()
  const guests = useQuery({
    queryKey: ['guests', query],
    queryFn: () =>
      api.get<Guest[]>(
        query === '' ? '/api/guests' : `/api/guests?phone=${encodeURIComponent(query)}`,
      ),
    // A half-typed number is not a phone, and the server rightly refuses it. Waiting for
    // enough digits keeps the screen from flashing an error on every keystroke.
    enabled: query === '' || query.replace(/\D/g, '').length >= 10,
  })

  return (
    <Screen title="Гости">
      <label className="search">
        <span className="visually-hidden">Поиск по телефону</span>
        <input
          className="field__input"
          type="tel"
          inputMode="tel"
          placeholder="Поиск по телефону"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      {guests.isPending && <p className="notice">Загружаем…</p>}

      {guests.error && (
        <div className="notice notice--bad" role="alert">
          <p>{guests.error.message}</p>
        </div>
      )}

      {guests.data?.length === 0 && (
        <div className="notice">
          <p className="notice__title">{query === '' ? 'Пока нет гостей' : 'Никого не нашлось'}</p>
          <p>
            {query === ''
              ? 'Гость появляется здесь, когда вы заводите бронь.'
              : 'Проверьте номер — искать можно в любом написании.'}
          </p>
        </div>
      )}

      <ul className="guests">
        {guests.data?.map((guest) => (
          <li key={guest.id}>
            <button className="guests__row" type="button" onClick={() => setOpen(guest)}>
              <span className="guests__name">{guest.name}</span>
              <span className="guests__phone">{guest.phone}</span>
              {guest.note !== null && guest.note !== '' && (
                <span className="guests__note">{guest.note}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {open !== undefined && <GuestSheet guest={open} onClose={() => setOpen(undefined)} />}
    </Screen>
  )
}

function GuestSheet({ guest, onClose }: { guest: Guest; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(guest.name)
  const [note, setNote] = useState(guest.note ?? '')
  const [error, setError] = useState<string | undefined>()

  const stays = useQuery({
    queryKey: ['guest-bookings', guest.id],
    queryFn: () => api.get<Booking[]>(`/api/guests/${guest.id}/bookings`),
  })

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/guests/${guest.id}`, {
        name,
        note: note.trim() === '' ? null : note,
      }),
    onSuccess: async () => {
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: ['guests'] })
      onClose()
    },
    onError: (cause) =>
      setError(cause instanceof ApiError ? cause.message : 'Не удалось сохранить'),
  })

  // One figure per currency. A guest who stayed either side of a change owes two amounts;
  // adding them would invent a number in neither currency.
  const currencies = useSettings().data?.currencies
  const owed = owedByCurrency(stays.data ?? [])

  return (
    <Sheet title={guest.name} onClose={onClose}>
      <dl className="facts">
        <div className="facts__row">
          <dt>Телефон</dt>
          <dd>
            <a href={`tel:${guest.phone}`}>{guest.phone}</a>
          </dd>
        </div>
        <div className="facts__row">
          <dt>Ночей всего</dt>
          <dd>{(stays.data ?? []).reduce((sum, stay) => sum + stay.nights, 0)}</dd>
        </div>
        {owed.length > 0 && (
          <div className="facts__row">
            <dt>Не оплачено</dt>
            <dd className="facts__owed">
              {owed
                .map((debt) => money(debt.owed, currencyOf(debt.currency, currencies)))
                .join(' · ')}
            </dd>
          </div>
        )}
      </dl>

      <h3 className="stays__title">Проживания</h3>

      {stays.isPending && <p className="notice">Загружаем…</p>}
      {stays.data?.length === 0 && <p className="notice">Ещё не приезжал.</p>}

      <ul className="stays">
        {stays.data?.map((stay) => (
          <li className="stays__row" key={stay.id}>
            <span className="stays__when">{formatStay(stay.check_in, stay.check_out)}</span>
            <span className="stays__house">{stay.house_name ?? '—'}</span>
            <span className={stay.status === 'cancelled' ? 'stays__cancelled' : 'stays__total'}>
              {stay.status === 'cancelled'
                ? 'отменено'
                : money(stay.total, currencyOf(stay.currency, currencies))}
            </span>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        {error !== undefined && (
          <p className="formerror" role="alert">
            {error}
          </p>
        )}

        <label className="field">
          <span className="field__label">Имя</span>
          <input
            className="field__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Заметка</span>
          <textarea
            className="field__input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Приезжает с собакой"
          />
        </label>

        <div className="actions">
          <button className="btn btn--primary" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
