import { describe, expect, it } from 'vitest'
import { ApiError, isOffline, NotSignedIn } from '../src/api'

describe('isOffline', () => {
  it('recognises the failure api.ts raises when fetch itself throws', () => {
    expect(isOffline(new ApiError('offline', 0, 'Нет связи'))).toBe(true)
  })

  it('does not mistake an answer from the server for being offline', () => {
    // A 500 means the server was reached and failed. Queueing that would hide a real fault.
    expect(isOffline(new ApiError('internal_error', 500, 'Boom'))).toBe(false)
    expect(isOffline(new NotSignedIn('unauthorized', 401, 'Сессия истекла'))).toBe(false)
    expect(isOffline(new TypeError('boom'))).toBe(false)
    expect(isOffline(undefined)).toBe(false)
  })
})
