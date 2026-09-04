/**
 * What the owner wants a booking to be — not the sequence of actions that got there.
 *
 * A log of offline actions replayed in order would need a temporary client id for a booking
 * that does not exist yet, reconciled mid-sync, with every later action parked when an earlier
 * one conflicts. Desired state collapses all of that: one record per booking, edited in place.
 */

/** Exactly the body `POST /api/bookings` accepts, so sync sends it unchanged. */
export interface CreatePayload {
  house_id: string
  check_in: string
  check_out: string
  guest: { name: string; phone: string; note?: string }
  price_per_night: number
  addons: Array<{ code: string }>
  deposit: number
  note?: string
}

export type IntentState = 'pending' | 'syncing' | 'conflict'

export interface Intent {
  /** Also the engine idempotency key, which is why it must not change once sent. */
  id: string
  bookingId: string | null
  op: 'create'
  capturedAt: string
  /** As agreed, offline. Never re-read from settings at sync time. */
  currency: string
  payload: CreatePayload
  state: IntentState
  /**
   * True once a request carrying this id has left the browser. The engine refuses the same key
   * with a different body, so an attempted payload is frozen until a replay tells us whether
   * the original landed.
   */
  attempted: boolean
  lastError?: { code: string; message: string }
}

export function newCreateIntent(payload: CreatePayload, currency: string): Intent {
  return {
    id: crypto.randomUUID(),
    bookingId: null,
    op: 'create',
    capturedAt: new Date().toISOString(),
    currency,
    payload,
    state: 'pending',
    attempted: false,
  }
}

export function isEditable(intent: Intent): boolean {
  return !intent.attempted
}

export function editIntent(intent: Intent, payload: CreatePayload): Intent {
  if (!isEditable(intent)) {
    throw new Error('This booking has been attempted; its payload is frozen until sync resolves it')
  }
  // Back to pending with the error cleared: the owner has changed what is being asked, so the
  // previous refusal no longer describes it.
  const { lastError: _, ...rest } = intent
  return { ...rest, payload, state: 'pending' }
}
