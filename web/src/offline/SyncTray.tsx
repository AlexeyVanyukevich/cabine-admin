import { Sheet } from '../ui/Sheet'
import { formatStay } from '../booking/NewBooking'
import type { Intent } from './intents'
import './offline.css'

interface Props {
  intents: Intent[]
  onClose: () => void
  onResolve: (intent: Intent) => void
  onRetry: () => void
}

/** Everything unsent, in one place, rather than hunted for across the calendar. */
export function SyncTray({ intents, onClose, onResolve, onRetry }: Props) {
  return (
    <Sheet
      title="Не отправлено"
      onClose={onClose}
      footer={
        <div className="actions">
          <button className="btn btn--quiet" type="button" onClick={onClose}>
            Закрыть
          </button>
          <button className="btn btn--primary" type="button" onClick={onRetry}>
            Отправить сейчас
          </button>
        </div>
      }
    >
      {intents.length === 0 && <p className="notice">Всё отправлено.</p>}

      <ul className="tray">
        {intents.map((intent) => (
          <li className="tray__row" key={intent.id}>
            <div>
              <p className="tray__who">{intent.payload.guest.name}</p>
              <p className="tray__when">
                {formatStay(intent.payload.check_in, intent.payload.check_out)}
              </p>
            </div>
            {intent.state === 'conflict' ? (
              <button className="btn btn--quiet" type="button" onClick={() => onResolve(intent)}>
                Разобраться
              </button>
            ) : (
              <span className="tray__state">
                {/* Keyed on the state, never on `attempted`: an intent that was tried and then
                    failed offline is still `attempted`, and calling it "Отправляется" while it
                    sits on the phone with no network is the one lie this screen must not tell. */}
                {intent.state === 'syncing' ? 'Отправляется' : 'Ждёт сети'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
