/** An answer from the engine that carries its `{ error, message, details }` body. */
export class EngineError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

/** No answer at all: connection refused, DNS failure, or our own timeout. */
export class EngineUnreachableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'EngineUnreachableError'
  }
}

/**
 * The engine reports contention as `503 concurrent_update` and explicitly does not retry,
 * so that the decision stays with the caller. `429` is a limit we can wait out.
 */
const RETRYABLE = new Set(['concurrent_update', 'rate_limited'])

/**
 * Errors describing something the owner did or can fix, as opposed to defects here and
 * outages over there. The distinction decides whether the interface shows an explanation or
 * an apology.
 */
const OWNER_FACING = new Set([
  'slot_unavailable',
  'outside_schedule',
  'resource_inactive',
  'invalid_state_transition',
  'hold_expired',
  'invalid_interval',
])

export function isRetryable(error: EngineError): boolean {
  return RETRYABLE.has(error.code)
}

export function isOwnerFacing(error: EngineError): boolean {
  return OWNER_FACING.has(error.code)
}
