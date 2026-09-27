import { Sheet } from '../ui/Sheet'
import { formatStay } from '../booking/NewBooking'
import { conflictReason } from './conflict'
import type { Intent } from './intents'
import '../booking/booking.css'
import './offline.css'

interface Props {
  intent: Intent
  onClose: () => void
  /** Re-open the booking form with these details, so nothing is retyped. */
  onRebook: (intent: Intent) => void
  onDiscard: (intent: Intent) => void
}

/**
 * What was wanted, beside what the engine now says. The owner re-decides the nights here, never
 * the booking: the guest, the price, the add-ons and the deposit are never asked for again — see
 * `onRebook`, which carries `intent.payload` back into a fresh booking form.
 */
export function ConflictScreen({ intent, onClose, onRebook, onDiscard }: Props) {
  return (
    <Sheet
      title="Бронь не прошла"
      onClose={onClose}
      footer={
        <div className="actions">
          <button className="btn btn--quiet" type="button" onClick={() => onDiscard(intent)}>
            Удалить
          </button>
          <button className="btn btn--primary" type="button" onClick={() => onRebook(intent)}>
            Выбрать другие даты
          </button>
        </div>
      }
    >
      <p className="notice notice--bad" role="alert">
        {conflictReason(intent)}
      </p>

      {/* What was wanted, kept whole: the owner re-decides the nights, never the booking. */}
      <dl className="facts">
        <div className="facts__row">
          <dt>Гость</dt>
          <dd>{intent.payload.guest.name}</dd>
        </div>
        <div className="facts__row">
          <dt>Телефон</dt>
          <dd>{intent.payload.guest.phone}</dd>
        </div>
        <div className="facts__row">
          <dt>Даты</dt>
          <dd>{formatStay(intent.payload.check_in, intent.payload.check_out)}</dd>
        </div>
      </dl>
    </Sheet>
  )
}
