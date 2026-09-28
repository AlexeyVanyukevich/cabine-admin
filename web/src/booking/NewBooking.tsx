import { useState, type FormEvent } from 'react'
import { api, type House } from '../api'
import { Sheet } from '../ui/Sheet'
import { nightsBetween } from '../calendar/nights'
import { money, toMajor, toMinor } from '../money'
import { useSettings } from '../settings'
import { messageFor } from '../errors'
import { captureOrPost } from '../offline/capture'
import { putIntent } from '../offline/db'
import type { CreatePayload } from '../offline/intents'

/** Ties the pinned Save button to the form it submits, which is no longer its ancestor. */
const FORM = 'new-booking'

/**
 * What a resumed booking carries over. The house and the nights are chosen fresh on the grid —
 * a conflict is the engine's answer about occupancy, not about the guest or the price — so this
 * is deliberately everything else a `CreatePayload` holds.
 */
export type RebookDraft = Pick<
  CreatePayload,
  'guest' | 'price_per_night' | 'addons' | 'deposit' | 'note'
>

/**
 * A rebook in progress, paired with the refused intent it will replace. The intent is kept in
 * IndexedDB — never dropped — until this draft actually becomes a new booking (sent or queued):
 * see `App.tsx`'s `rebook` and `Calendar.tsx`'s `onSaved`/`onCancel`, which are the only places
 * that drop it.
 */
export interface RebookRequest {
  intentId: string
  draft: RebookDraft
}

interface Props {
  house: House
  checkIn: string
  checkOut: string
  onCancel: () => void
  onSaved: (outcome: 'sent' | 'queued') => void
  /** Set only when this sheet resumes a booking the engine refused earlier. */
  initial?: RebookDraft
}

export function NewBooking({ house, checkIn, checkOut, onCancel, onSaved, initial }: Props) {
  const nights = nightsBetween(checkIn, checkOut)

  const [name, setName] = useState(initial?.guest.name ?? '')
  const [phone, setPhone] = useState(initial?.guest.phone ?? '')
  const [price, setPrice] = useState(() =>
    initial === undefined ? String(house.price_per_night / 100) : toMajor(initial.price_per_night),
  )
  const [chosen, setChosen] = useState<string[]>(() =>
    // An add-on code the intent carried for a house that no longer offers it — most likely a
    // different house chosen this time round — is silently dropped rather than sent for one
    // that can't price it.
    initial === undefined
      ? []
      : initial.addons
          .map((addon) => addon.code)
          .filter((code) => house.addons.some((addon) => addon.code === code)),
  )
  const [deposit, setDeposit] = useState(() =>
    initial === undefined ? '' : toMajor(initial.deposit),
  )
  const [note, setNote] = useState(initial?.note ?? '')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  // A booking being made now is priced in the currency in force now; the client sends that
  // same code with the request, so what is shown here is what the booking will keep.
  const settings = useSettings()
  const currency = settings.data?.currency ?? { code: '', symbol: '' }

  // Minted once and held for the life of this sheet, not per submit: a lost answer followed by
  // a retry must replay the same key, or the engine sees two different attempts and holds the
  // night twice. See `web/src/offline/intents.ts` — the same rule for the offline queue.
  const [idempotencyKey] = useState(() => crypto.randomUUID())

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
      const outcome = await captureOrPost(
        {
          house_id: house.id,
          check_in: checkIn,
          check_out: checkOut,
          guest: { name, phone },
          price_per_night: priceMinor,
          addons: chosen.map((code) => ({ code })),
          deposit: depositMinor,
          ...(note.trim() === '' ? {} : { note }),
        },
        currency.code,
        idempotencyKey,
        { post: api.post, save: putIntent },
      )
      onSaved(outcome)
    } catch (cause) {
      setError(messageFor(cause, 'Не удалось сохранить бронь'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Новая бронь"
      onClose={onCancel}
      footer={
        <div className="actions">
          <button className="btn btn--quiet" type="button" onClick={onCancel}>
            Отмена
          </button>
          <button
            className="btn btn--primary"
            type="submit"
            form={FORM}
            // Submitting before settings has ever loaded would send an empty currency code,
            // which the schema rejects — a confusing 400 rather than a clear, disabled button.
            disabled={busy || settings.data === undefined}
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      }
    >
      <p className="stay">
        {house.name} · {formatStay(checkIn, checkOut)} · {nights}{' '}
        {nights === 1 ? 'ночь' : nights < 5 ? 'ночи' : 'ночей'}
      </p>

      <form id={FORM} onSubmit={submit}>
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
      </form>
    </Sheet>
  )
}

export function formatStay(checkIn: string, checkOut: string): string {
  return `${checkIn.slice(8, 10)}.${checkIn.slice(5, 7)} — ${checkOut.slice(8, 10)}.${checkOut.slice(5, 7)}`
}
