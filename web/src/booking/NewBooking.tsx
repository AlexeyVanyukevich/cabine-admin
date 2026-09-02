import { useState, type FormEvent } from 'react'
import { api, ApiError, type House } from '../api'
import { Sheet } from '../ui/Sheet'
import { nightsBetween } from '../calendar/nights'
import { money, toMinor } from '../money'
import { useSettings } from '../settings'

interface Props {
  house: House
  checkIn: string
  checkOut: string
  onCancel: () => void
  onSaved: () => void
}

export function NewBooking({ house, checkIn, checkOut, onCancel, onSaved }: Props) {
  const nights = nightsBetween(checkIn, checkOut)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [price, setPrice] = useState(String(house.price_per_night / 100))
  const [chosen, setChosen] = useState<string[]>([])
  const [deposit, setDeposit] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  // A booking being made now is priced in the currency in force now; the server snapshots
  // that same code onto the row, so what is shown here is what the booking will keep.
  const settings = useSettings()
  const currency = settings.data?.currency ?? { code: '', symbol: '' }

  const priceMinor = toMinor(price)
  const depositMinor = deposit.trim() === '' ? 0 : toMinor(deposit)
  const addonsMinor = house.addons
    .filter((addon) => chosen.includes(addon.code))
    .reduce((sum, addon) => sum + addon.default_price, 0)

  const total = Number.isNaN(priceMinor) ? null : priceMinor * nights + addonsMinor
  const balance = total === null || Number.isNaN(depositMinor) ? null : total - depositMinor

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api.post('/api/bookings', {
        house_id: house.id,
        check_in: checkIn,
        check_out: checkOut,
        guest: { name, phone },
        price_per_night: priceMinor,
        addons: chosen.map((code) => ({ code })),
        deposit: depositMinor,
        ...(note.trim() === '' ? {} : { note }),
      })
      onSaved()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось сохранить бронь')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="Новая бронь" onClose={onCancel}>
      <p className="stay">
        {house.name} · {formatStay(checkIn, checkOut)} · {nights}{' '}
        {nights === 1 ? 'ночь' : nights < 5 ? 'ночи' : 'ночей'}
      </p>

      <form onSubmit={submit}>
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
            autoComplete="name"
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Телефон</span>
          <input
            className="field__input"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+375 29 123 45 67"
            required
          />
        </label>

        <div className="field__row">
          <label className="field">
            <span className="field__label">Цена за ночь, {currency.symbol}</span>
            <input
              className="field__input"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Аванс, {currency.symbol}</span>
            <input
              className="field__input"
              value={deposit}
              onChange={(event) => setDeposit(event.target.value)}
              inputMode="decimal"
              placeholder="0"
            />
          </label>
        </div>

        {house.addons.length > 0 && (
          <fieldset className="addons">
            <legend className="field__label">Дополнительно</legend>
            {house.addons.map((addon) => (
              <label className="check" key={addon.code}>
                <input
                  type="checkbox"
                  checked={chosen.includes(addon.code)}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, addon.code]
                        : current.filter((code) => code !== addon.code),
                    )
                  }
                />
                <span>{addon.label}</span>
                <span className="check__price">{money(addon.default_price, currency)}</span>
              </label>
            ))}
          </fieldset>
        )}

        <label className="field">
          <span className="field__label">Заметка</span>
          <textarea
            className="field__input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
          />
        </label>

        {/* The sum is shown while the owner types, so the number they quote is the stored one. */}
        <div className="total">
          <div className="total__row">
            <span>
              {nights} × {money(Number.isNaN(priceMinor) ? null : priceMinor, currency)}
            </span>
            <span>{money(Number.isNaN(priceMinor) ? null : priceMinor * nights, currency)}</span>
          </div>
          {addonsMinor > 0 && (
            <div className="total__row">
              <span>Дополнительно</span>
              <span>{money(addonsMinor, currency)}</span>
            </div>
          )}
          <div className="total__row total__row--sum">
            <span>Итого</span>
            <span>{money(total, currency)}</span>
          </div>
          {balance !== null && balance !== total && (
            <div className="total__row total__row--owed">
              <span>Остаток</span>
              <span>{money(balance, currency)}</span>
            </div>
          )}
        </div>

        <div className="actions">
          <button className="btn btn--quiet" type="button" onClick={onCancel}>
            Отмена
          </button>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}

export function formatStay(checkIn: string, checkOut: string): string {
  return `${checkIn.slice(8, 10)}.${checkIn.slice(5, 7)} — ${checkOut.slice(8, 10)}.${checkOut.slice(5, 7)}`
}
