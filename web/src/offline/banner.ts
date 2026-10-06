import type { SyncOutcome } from './sync'

export interface BannerInput {
  /** How the last sync round ended. Says nothing about what was queued after it. */
  outcome: SyncOutcome
  /** Whether a round is in flight right now. */
  sending: boolean
  /** Queued and not refused. */
  waiting: number
  conflicts: number
}

export type BannerState =
  'conflicts' | 'sending' | 'waiting' | 'offline' | 'paused' | 'queued' | 'none'

/**
 * Which of the connection banner's messages is up. Kept apart from the component so the
 * order can be tested without a renderer.
 *
 * Sending is claimed only while a round is in flight. A booking queued after the last round
 * has not been tried yet, and "Отправляем…" for it would say it is on its way while it waits.
 */
export function bannerFor({ outcome, sending, waiting, conflicts }: BannerInput): BannerState {
  if (conflicts > 0) return 'conflicts'
  if (sending && waiting > 0) return 'sending'
  if (outcome === 'offline') return waiting > 0 ? 'waiting' : 'offline'
  if (outcome === 'paused') return 'paused'
  return waiting > 0 ? 'queued' : 'none'
}
