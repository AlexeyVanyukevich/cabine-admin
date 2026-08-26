import { useState, type FormEvent } from 'react'
import { api, ApiError, type Booking } from '../api'
import { Sheet } from '../ui/Sheet'
import { money, toMinor, toRoubles } from '../calendar/nights'
import { formatStay } from './NewBooking'

interface Props {
  booking: Booking
  onClose: () => void
  onChanged: () => void
}

export function BookingDetails({ booking, onClose, onChanged }: Props) {
  const [deposit, setDeposit] = useState(toRoubles(booking.deposit))
  const [note, setNote] = useState(booking.note ?? '')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  const cancelled = booking.status === 'cancelled'

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api.patch(`/api/bookings/${booking.id}`, {
        deposit: deposit.trim() === '' ? 0 : toMinor(deposit),
        note: note.trim() === '' ? null : note,
      })
      onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  async function cancelBooking() {
    setBusy(true)
    setError(undefined)
    try {
      await api.post(`/api/bookings/${booking.id}/cancel`)
      onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось отменить бронь')
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={booking.orphan ? 'Бронь без данных' : (booking.guest?.name ?? 'Бронь')}
      onClose={onClose}
    >
      <p className="stay">
        {booking.house_name} · {formatStay(booking.check_in, booking.check_out)} · {booking.nights}{' '}
        {booking.nights === 1 ? 'ночь' : booking.nights < 5 ? 'ночи' : 'ночей'}
      </p>

      {booking.orphan && (
        // The engine holds these nights but nothing here says for whom. Shown plainly, with
        // what to do about it, rather than hidden — a hidden booking is a night believed free.
        <p className="formerror" role="status">
          Эта бронь есть в движке, но здесь о ней ничего не записано. Ночи заняты. Заведите гостя и
          сумму заново, чтобы запись стала полной.
        </p>
      )}

      {cancelled && <p className="stay stay--muted">Бронь отменена. Ночи свободны.</p>}

      {booking.guest !== null && (
        // The name is already the sheet's title; repeating it here would just be furniture.
        <dl className="facts">
          <div className="facts__row">
            <dt>Телефон</dt>
            <dd>
              <a href={`tel:${booking.guest.phone}`}>{booking.guest.phone}</a>
            </dd>
          </div>
        </dl>
      )}

      {!booking.orphan && (
        <div className="total">
          <div className="total__row">
            <span>
              {booking.nights} × {money(booking.price_per_night)}
            </span>
            <span>
              {money(
                booking.price_per_night === null ? null : booking.price_per_night * booking.nights,
              )}
            </span>
          </div>
          {booking.addons.map((addon) => (
            <div className="total__row" key={addon.code}>
              <span>{addon.label}</span>
              <span>{money(addon.price)}</span>
            </div>
          ))}
          <div className="total__row total__row--sum">
            <span>Итого</span>
            <span>{money(booking.total)}</span>
          </div>
          <div
            className={`total__row ${(booking.balance ?? 0) > 0 ? 'total__row--owed' : ''}`}
            data-testid="balance"
          >
            <span>{(booking.balance ?? 0) > 0 ? 'Остаток' : 'Оплачено полностью'}</span>
            <span>{money(booking.balance)}</span>
          </div>
        </div>
      )}

      {!booking.orphan && !cancelled && (
        <form onSubmit={save}>
          {error !== undefined && (
            <p className="formerror" role="alert">
              {error}
            </p>
          )}

          <div className="field__row">
            <label className="field">
              <span className="field__label">Аванс, ₽</span>
              <input
                className="field__input"
                value={deposit}
                onChange={(event) => setDeposit(event.target.value)}
                inputMode="decimal"
              />
            </label>
          </div>

          <label className="field">
            <span className="field__label">Заметка</span>
            <textarea
              className="field__input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </label>

          <div className="actions">
            <button className="btn btn--primary" type="submit" disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </form>
      )}

      {!cancelled && (
        <div className="actions actions--end">
          {confirmingCancel ? (
            <>
              <button
                className="btn btn--quiet"
                type="button"
                onClick={() => setConfirmingCancel(false)}
              >
                Не отменять
              </button>
              <button
                className="btn btn--danger"
                type="button"
                onClick={() => void cancelBooking()}
                disabled={busy}
              >
                Да, отменить
              </button>
            </>
          ) : (
            <button
              className="btn btn--danger"
              type="button"
              onClick={() => setConfirmingCancel(true)}
            >
              Отменить бронь
            </button>
          )}
        </div>
      )}
    </Sheet>
  )
}
