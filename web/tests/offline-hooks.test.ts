import { describe, expect, it } from 'vitest'
import { ApiError, isOffline, NotSignedIn } from '../src/api'
import { resolveCachedQuery } from '../src/offline/useOffline'

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

describe('resolveCachedQuery', () => {
  const FETCHED_AT = '2026-09-04T10:00:00.000Z'
  const boom = new Error('boom')

  it('reports a successful fetch as fresh, with no stamp and no error', () => {
    const result = resolveCachedQuery({
      failed: false,
      data: 'live',
      fallback: undefined,
      fallbackChecked: false,
      error: null,
      isPending: false,
    })
    expect(result).toEqual({
      data: 'live',
      fetchedAt: undefined,
      stale: false,
      error: null,
      isPending: false,
    })
  })

  it('does not serve stale in-memory data as fresh once the fetch has failed — the defect this hook exists to avoid', () => {
    // @tanstack/query-core's reducer keeps a prior success's `data` around through a later
    // failed fetch: `data` and `error` coexist on the query object. Gating on `data` alone
    // would report this as fresh, exactly the "stale cache lying as current" outcome the
    // staleness stamp exists to prevent.
    const result = resolveCachedQuery({
      failed: true,
      data: 'stale-in-memory-leftover',
      fallback: undefined,
      fallbackChecked: true,
      error: boom,
      isPending: false,
    })
    expect(result.data).toBeUndefined()
    expect(result.stale).toBe(false)
    expect(result.error).toBe(boom)
  })

  it('serves the cache entry under its stamp once a failed fetch has one, error suppressed', () => {
    const result = resolveCachedQuery({
      failed: true,
      data: 'stale-in-memory-leftover',
      fallback: { value: 'cached', fetchedAt: FETCHED_AT },
      fallbackChecked: true,
      error: boom,
      isPending: false,
    })
    expect(result).toEqual({
      data: 'cached',
      fetchedAt: FETCHED_AT,
      stale: true,
      error: null,
      isPending: false,
    })
  })

  it('stays pending while the cache read after a failure is still in flight', () => {
    // Reporting the error before the cache read settles would flash an error that a moment
    // later flips to a stale grid.
    const result = resolveCachedQuery({
      failed: true,
      data: undefined,
      fallback: undefined,
      fallbackChecked: false,
      error: boom,
      isPending: false,
    })
    expect(result).toEqual({
      data: undefined,
      fetchedAt: undefined,
      stale: false,
      error: null,
      isPending: true,
    })
  })

  it('surfaces the error once the cache has been checked and holds nothing for this key', () => {
    const result = resolveCachedQuery({
      failed: true,
      data: undefined,
      fallback: undefined,
      fallbackChecked: true,
      error: boom,
      isPending: false,
    })
    expect(result).toEqual({
      data: undefined,
      fetchedAt: undefined,
      stale: false,
      error: boom,
      isPending: false,
    })
  })

  it('reports the first-ever fetch, still loading, as pending rather than failed', () => {
    const result = resolveCachedQuery({
      failed: false,
      data: undefined,
      fallback: undefined,
      fallbackChecked: false,
      error: null,
      isPending: true,
    })
    expect(result).toEqual({
      data: undefined,
      fetchedAt: undefined,
      stale: false,
      error: null,
      isPending: true,
    })
  })
})
