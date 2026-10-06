import { attentionLine, bannerFor, waitingLine } from './banner'
import type { Intent } from './intents'
import type { SyncOutcome } from './sync'
import './offline.css'

interface Props {
  outcome: SyncOutcome
  sending: boolean
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
export function ConnectionBanner({ outcome, sending, intents, onOpenTray, onRetry }: Props) {
  const conflicts = intents.filter((intent) => intent.state === 'conflict').length
  const waiting = intents.length - conflicts
  const state = bannerFor({ outcome, sending, waiting, conflicts })

  if (state === 'conflicts') {
    return (
      <button
        className="conn conn--bad"
        type="button"
        onClick={onOpenTray}
        data-testid="connection-banner"
        data-state="conflicts"
      >
        {attentionLine(conflicts)}
      </button>
    )
  }

  if (state === 'sending') {
    return (
      <p className="conn conn--wait" data-testid="connection-banner" data-state="sending">
        Отправляем…
      </p>
    )
  }

  if (state === 'waiting') {
    return (
      <button
        className="conn conn--wait"
        type="button"
        onClick={onOpenTray}
        data-testid="connection-banner"
        data-state="waiting"
      >
        Нет сети · {waitingLine(waiting)}
      </button>
    )
  }

  if (state === 'offline') {
    return (
      <p className="conn conn--wait" data-testid="connection-banner" data-state="offline">
        Нет сети. Календарь показан на память.
      </p>
    )
  }

  if (state === 'paused') {
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

  if (state === 'queued') {
    // Not "no network": the browser says it has one, and only a send can tell. The tray it
    // opens has the button that tries.
    return (
      <button
        className="conn conn--wait"
        type="button"
        onClick={onOpenTray}
        data-testid="connection-banner"
        data-state="queued"
      >
        {waitingLine(waiting)}
      </button>
    )
  }

  return null
}
