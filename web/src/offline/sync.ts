import { ApiError, isOffline, NotSignedIn } from '../api'
import type { Intent } from './intents'

export interface SyncDeps {
  post: <T>(path: string, body: unknown) => Promise<T>
  read: () => Promise<Intent[]>
  save: (intent: Intent) => Promise<void>
  drop: (id: string) => Promise<void>
}

export type SyncOutcome = 'idle' | 'synced' | 'offline' | 'paused' | 'conflicts'

/**
 * Codes the engine documents as transient. They mean "ask again", not "the owner must decide",
 * and treating them as conflicts would put a resolution screen in front of a passing hiccup.
 */
const RETRYABLE = new Set([
  'concurrent_update',
  'rate_limited',
  'internal_error',
  'engine_unreachable',
])

/**
 * Replays the queue against this project's own server — never the engine, whose key is not in
 * this browser and must not be.
 *
 * One intent at a time, in capture order: two queued creates can cover the same nights, and
 * only a serial loop lets the second be judged against the first's result.
 */
export async function runSync(deps: SyncDeps): Promise<SyncOutcome> {
  const queue = (await deps.read()).sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  if (queue.length === 0) return 'idle'

  let sent = 0
  let deferred = false
  // Counted as we go rather than re-read at the end: a second read would race whatever the
  // page has written since, and the loop already knows every outcome it produced.
  let conflicts = 0

  for (const intent of queue) {
    // Already refused for a reason resending cannot change.
    if (intent.state === 'conflict') {
      conflicts += 1
      continue
    }

    // Recorded before the request leaves, so a connection lost mid-flight — or an edit from
    // another tab — still finds the payload frozen. The engine refuses this key with a
    // different body afterwards. `syncing` is what lets the tray tell "sending right now"
    // apart from "tried, and now waiting" — collapsing it into `pending` here would make that
    // distinction unrecoverable once the request settles.
    const attempt: Intent = { ...intent, state: 'syncing', attempted: true }
    await deps.save(attempt)

    try {
      await deps.post('/api/bookings', {
        ...intent.payload,
        currency: intent.currency,
        idempotency_key: intent.id,
      })
      await deps.drop(intent.id)
      sent += 1
    } catch (cause) {
      if (cause instanceof NotSignedIn) {
        // Park this one and stop. Everything behind it would earn the same 401, and the owner
        // has to sign in before any of it can move.
        await deps.save({ ...attempt, state: 'pending' })
        return 'paused'
      }

      if (isOffline(cause) || (cause instanceof ApiError && RETRYABLE.has(cause.code))) {
        await deps.save({ ...attempt, state: 'pending' })
        deferred = true
        continue
      }

      // The server has spoken, so the pending freeze no longer describes this intent.
      await deps.save({
        ...attempt,
        state: 'conflict',
        lastError:
          cause instanceof ApiError
            ? { code: cause.code, message: cause.message }
            : { code: 'unknown', message: 'Не удалось отправить' },
      })
      conflicts += 1
    }
  }

  if (conflicts > 0) return 'conflicts'
  if (deferred) return 'offline'
  return sent > 0 ? 'synced' : 'idle'
}
