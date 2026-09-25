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
  const KEY_A = 'calendar:2026-09-01:2026-10-01'
  const KEY_B = 'calendar:2026-10-01:2026-11-01'

  it('reports a successful fetch as fresh, with no stamp and no error', () => {
    const result = resolveCachedQuery({
      cacheKey: KEY_A,
      failed: false,
      data: 'live',
      fallback: undefined,
      checkedKey: undefined,
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
      cacheKey: KEY_A,
      failed: true,
      data: 'stale-in-memory-leftover',
      fallback: undefined,
      checkedKey: KEY_A,
      error: boom,
      isPending: false,
    })
    expect(result.data).toBeUndefined()
    expect(result.stale).toBe(false)
    expect(result.error).toBe(boom)
  })

  it('serves the cache entry under its stamp once a failed fetch has one for this key, error suppressed', () => {
    const result = resolveCachedQuery({
      cacheKey: KEY_A,
      failed: true,
      data: 'stale-in-memory-leftover',
      fallback: { key: KEY_A, value: 'cached', fetchedAt: FETCHED_AT },
      checkedKey: KEY_A,
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

  it("never renders another key's fallback under this key's stamp — a month revisited offline must not show the previous month's cache", () => {
    // @tanstack/react-query can hand back key A's cached error synchronously the instant the
    // caller switches queryKey back to A, in the same render, before the effect that would
    // otherwise refresh `fallback`/`checkedKey` for A has run. If `fallback` (still holding B,
    // the month navigated away to) were accepted here just because SOMETHING is failed and
    // SOMETHING is cached, the owner would see month B's nights under month A's label — an
    // apparently-fresh, wrongly-free grid, which is worse than an honest pending flash.
    const result = resolveCachedQuery({
      cacheKey: KEY_A,
      failed: true,
      data: undefined,
      fallback: { key: KEY_B, value: 'cached-for-B', fetchedAt: FETCHED_AT },
      checkedKey: KEY_B,
      error: boom,
      isPending: false,
    })
    expect(result.data).toBeUndefined()
    expect(result.stale).toBe(false)
    // Pending, not the error either: a proper check for A's own cache has not happened yet.
    expect(result.error).toBeNull()
    expect(result.isPending).toBe(true)
  })

  it('stays pending while the cache read after a failure is still in flight', () => {
    // Reporting the error before the cache read settles would flash an error that a moment
    // later flips to a stale grid.
    const result = resolveCachedQuery({
      cacheKey: KEY_A,
      failed: true,
      data: undefined,
      fallback: undefined,
      checkedKey: undefined,
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
      cacheKey: KEY_A,
      failed: true,
      data: undefined,
      fallback: undefined,
      checkedKey: KEY_A,
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
      cacheKey: KEY_A,
      failed: false,
      data: undefined,
      fallback: undefined,
      checkedKey: undefined,
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
