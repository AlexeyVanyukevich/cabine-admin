import { isOffline } from '../api'
import { newCreateIntent, type CreatePayload, type Intent } from './intents'

export interface CaptureDeps {
  post: <T>(path: string, body: unknown) => Promise<T>
  save: (intent: Intent) => Promise<void>
}

/**
 * Try to book; queue only if the request never left. Anything the server answered — a taken
 * night, a bad phone number — is the owner's to see now, because queueing it would replay a
 * request already known to fail.
 *
 * The key is the caller's, never minted here. The form holds one per sheet opening so a retry
 * after a lost answer replays it; minting inside this function would give every retry a fresh
 * key and let the engine hold the night twice.
 */
export async function captureOrPost(
  payload: CreatePayload,
  currency: string,
  idempotencyKey: string,
  deps: CaptureDeps,
): Promise<'sent' | 'queued'> {
  const intent = { ...newCreateIntent(payload, currency), id: idempotencyKey }

  try {
    await deps.post('/api/bookings', {
      ...payload,
      currency,
      idempotency_key: intent.id,
    })
    return 'sent'
  } catch (cause) {
    if (!isOffline(cause)) throw cause

    // Attempted, because the request may have reached the engine before the connection died.
    // Replaying this same key is what resolves that; changing the payload first would be
    // refused as `idempotency_key_reused`.
    await deps.save({ ...intent, attempted: true })
    return 'queued'
  }
}
