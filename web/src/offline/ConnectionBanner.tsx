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
 *
 * `data-state` names which of the banner's messages is up, so a test can tell them apart
 * without depending on their wording.
 */
export function ConnectionBanner({ outcome, intents, onOpenTray, onRetry }: Props) {
  const conflicts = intents.filter((intent) => intent.state === 'conflict').length
  const waiting = intents.length - conflicts

  if (conflicts > 0) {
    return (
      <button
        className="conn conn--bad"
        type="button"
        onClick={onOpenTray}
        data-testid="connection-banner"
        data-state="conflicts"
      >
        {conflicts === 1 ? 'Одна бронь требует внимания' : `${conflicts} брони требуют внимания`}
      </button>
    )
  }

  if (outcome === 'offline' && waiting > 0) {
    return (
      <button
        className="conn conn--wait"
        type="button"
        onClick={onOpenTray}
        data-testid="connection-banner"
        data-state="waiting"
      >
        Нет сети · {waiting} {waiting === 1 ? 'бронь ждёт' : 'брони ждут'} отправки
      </button>
    )
  }

  if (outcome === 'offline') {
    return (
      <p className="conn conn--wait" data-testid="connection-banner" data-state="offline">
        Нет сети. Календарь показан на память.
      </p>
    )
  }

  if (outcome === 'paused') {
    return (
      <button
        className="conn conn--bad"
        type="button"
        onClick={onRetry}
        data-testid="connection-banner"
        data-state="paused"
      >
        Сессия истекла. Войдите снова, чтобы отправить брони.
      </button>
    )
  }

  if (waiting > 0) {
    return (
      <p className="conn conn--wait" data-testid="connection-banner" data-state="sending">
        Отправляем…
      </p>
    )
  }

  return null
}
