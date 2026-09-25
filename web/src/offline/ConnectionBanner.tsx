import type { Intent } from './intents'
import type { SyncOutcome } from './sync'
import './offline.css'

interface Props {
  outcome: SyncOutcome
  intents: Intent[]
  onOpenTray: () => void
  onRetry: () => void
}

/**
 * The owner must never be unsure whether what they are looking at is real. This says so
 * continuously rather than only at the moment of saving.
 */
export function ConnectionBanner({ outcome, intents, onOpenTray, onRetry }: Props) {
  const conflicts = intents.filter((intent) => intent.state === 'conflict').length
  const waiting = intents.length - conflicts

  if (conflicts > 0) {
    return (
      <button className="conn conn--bad" type="button" onClick={onOpenTray}>
        {conflicts === 1 ? 'Одна бронь требует внимания' : `${conflicts} брони требуют внимания`}
      </button>
    )
  }

  if (outcome === 'offline' && waiting > 0) {
    return (
      <button className="conn conn--wait" type="button" onClick={onOpenTray}>
        Нет сети · {waiting} {waiting === 1 ? 'бронь ждёт' : 'брони ждут'} отправки
      </button>
    )
  }

  if (outcome === 'offline') {
    return <p className="conn conn--wait">Нет сети. Календарь показан на память.</p>
  }

  if (outcome === 'paused') {
    return (
      <button className="conn conn--bad" type="button" onClick={onRetry}>
        Сессия истекла. Войдите снова, чтобы отправить брони.
      </button>
    )
  }

  if (waiting > 0) {
    return <p className="conn conn--wait">Отправляем…</p>
  }

  return null
}
