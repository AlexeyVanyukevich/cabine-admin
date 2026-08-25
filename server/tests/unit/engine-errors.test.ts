import { describe, expect, it } from 'vitest'
import { EngineError, isRetryable, isOwnerFacing } from '../../src/engine/errors.js'

const error = (code: string, status: number) => new EngineError(code, status, 'message')

describe('isRetryable', () => {
  // The engine translates contention and refuses to retry on purpose, leaving the decision
  // to its caller. We are the caller.
  it.each(['concurrent_update', 'rate_limited'])('retries %s', (code) => {
    expect(isRetryable(error(code, code === 'rate_limited' ? 429 : 503))).toBe(true)
  })

  it.each(['slot_unavailable', 'outside_schedule', 'unauthorized', 'not_found'])(
    'does not retry %s',
    (code) => {
      expect(isRetryable(error(code, 409))).toBe(false)
    },
  )
})

describe('isOwnerFacing', () => {
  // Things the owner can understand and act on, versus defects and outages.
  it.each(['slot_unavailable', 'outside_schedule', 'resource_inactive'])(
    '%s is something to show the owner',
    (code) => {
      expect(isOwnerFacing(error(code, 409))).toBe(true)
    },
  )

  it.each(['invalid_slot_boundary', 'idempotency_key_reused', 'validation_error'])(
    '%s is a defect on our side, not the owner’s problem',
    (code) => {
      expect(isOwnerFacing(error(code, 400))).toBe(false)
    },
  )

  // A revoked key is an operational alert. Telling the owner "network error" would have
  // them reloading the page for half an hour.
  it('unauthorized is neither retryable nor the owner’s fault', () => {
    expect(isRetryable(error('unauthorized', 401))).toBe(false)
    expect(isOwnerFacing(error('unauthorized', 401))).toBe(false)
  })
})
