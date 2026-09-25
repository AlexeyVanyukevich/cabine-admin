import { useCallback, useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { allIntents, dropIntent, putIntent, putCache, readCache } from './db'
import { runSync, type SyncOutcome } from './sync'
import type { Intent } from './intents'

/** Whether the browser believes it has a network. It can be wrong; sync treats it as a hint. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    function up() {
      setOnline(true)
    }
    function down() {
      setOnline(false)
    }
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  return online
}

export interface CachedQuery<T> {
  data: T | undefined
  /** ISO 8601, present only when `data` came from the cache. */
  fetchedAt: string | undefined
  stale: boolean
  error: unknown
  isPending: boolean
  refetch: () => void
}

type Resolved<T> = Omit<CachedQuery<T>, 'refetch'>

interface ResolveInput<T> {
  /** `query.error != null` — a fetch for this key has failed and not yet been superseded. */
  failed: boolean
  data: T | undefined
  fallback: { value: T; fetchedAt: string } | undefined
  /** Whether the IndexedDB read that fills `fallback` after a failure has settled. */
  fallbackChecked: boolean
  error: unknown
  isPending: boolean
}

/**
 * The branch selection lives outside the hook so it can be unit-tested without a renderer:
 * this repo has no React Testing Library, but the ordering below is exactly the load-bearing
 * decision the staleness stamp depends on, so it does not ship unproven.
 *
 * Order matters:
 * 1. A fetch that has not failed, with data in hand, is genuinely fresh.
 * 2. A failed fetch with a cache entry renders that entry, under its stamp, error suppressed.
 * 3. A failed fetch whose cache read has not yet settled stays pending rather than flashing an
 *    error a moment before it turns into a stale grid.
 * 4. Otherwise the fetch failed and there is nothing to stamp: surface the error. In-memory
 *    `data` from a prior success is deliberately not shown here — it carries no `fetchedAt`, so
 *    it cannot be rendered honestly under a stamp, and an explicit error is not the empty grid
 *    the calendar must never show.
 */
export function resolveCachedQuery<T>(input: ResolveInput<T>): Resolved<T> {
  const { failed, data, fallback, fallbackChecked, error, isPending } = input

  if (!failed && data !== undefined) {
    return { data, fetchedAt: undefined, stale: false, error: null, isPending: false }
  }

  if (failed && fallback !== undefined) {
    return {
      data: fallback.value,
      fetchedAt: fallback.fetchedAt,
      stale: true,
      error: null,
      isPending: false,
    }
  }

  if (failed && !fallbackChecked) {
    return { data: undefined, fetchedAt: undefined, stale: false, error: null, isPending: true }
  }

  return { data: undefined, fetchedAt: undefined, stale: false, error, isPending }
}

/**
 * A read that survives losing the network: the answer is written to IndexedDB on every
 * success, and served from there — explicitly stamped as stale — when the server cannot be
 * reached.
 *
 * The stamp is not decoration. Slice 1 rejected an availability cache because a stale grid
 * "would tell the same lie more convincingly", and that reasoning still holds for a cache that
 * claims to be current. This one never claims it.
 *
 * `query.data` alone cannot gate freshness: `@tanstack/query-core`'s reducer keeps the last
 * successful `data` around through a subsequent failed fetch (its `"error"` case never clears
 * it), so `data` and `error` coexist on the query after a success-then-offline sequence. Gating
 * on `failed` as well, via `resolveCachedQuery`, is what keeps that in-memory leftover from
 * being served as if it were current.
 */
export function useCachedQuery<T>(
  cacheKey: string,
  queryKey: unknown[],
  fetcher: () => Promise<T>,
): CachedQuery<T> {
  const client = useQueryClient()
  const [fallback, setFallback] = useState<{ value: T; fetchedAt: string } | undefined>()
  const [fallbackChecked, setFallbackChecked] = useState(false)

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const value = await fetcher()
      await putCache(cacheKey, value)
      return value
    },
  })

  const failed = query.error != null

  useEffect(() => {
    if (!failed) {
      setFallback(undefined)
      setFallbackChecked(false)
      return
    }
    let live = true
    readCache<T>(cacheKey)
      .then((entry) => {
        if (!live) return
        setFallback(entry)
        setFallbackChecked(true)
      })
      .catch(() => {
        // An IndexedDB failure (quota, private browsing) still has to resolve the "is the cache
        // checked yet" question, or branch 3 above would leave the hook pending forever.
        if (!live) return
        setFallback(undefined)
        setFallbackChecked(true)
      })
    return () => {
      live = false
    }
  }, [failed, cacheKey])

  return {
    ...resolveCachedQuery({
      failed,
      data: query.data,
      fallback,
      fallbackChecked,
      error: query.error,
      isPending: query.isPending,
    }),
    refetch: () => void client.invalidateQueries({ queryKey }),
  }
}

export interface Sync {
  outcome: SyncOutcome
  intents: Intent[]
  syncNow: () => void
  reload: () => void
}

/**
 * Runs the queue on every signal that connectivity may have returned.
 *
 * `online` alone is not enough: a browser reports online on a captive portal with no route
 * anywhere. Focus and an explicit button cover what the event misses.
 *
 * Not the Background Sync API, which is Chromium-only — iOS Safari has never shipped it. The
 * consequence is real and documented rather than hidden: close the app while offline and
 * nothing is sent until it is opened again.
 */
export function useSync(): Sync {
  const [outcome, setOutcome] = useState<SyncOutcome>('idle')
  const [intents, setIntents] = useState<Intent[]>([])
  const online = useOnline()

  const reload = useCallback(() => {
    void allIntents().then(setIntents)
  }, [])

  const syncNow = useCallback(() => {
    void runSync({ post: api.post, read: allIntents, save: putIntent, drop: dropIntent })
      .then(setOutcome)
      .finally(reload)
  }, [reload])

  useEffect(reload, [reload])

  useEffect(() => {
    if (!online) {
      setOutcome('offline')
      return
    }
    syncNow()

    function onFocus() {
      if (document.visibilityState === 'visible') syncNow()
    }
    window.addEventListener('online', syncNow)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('online', syncNow)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [online, syncNow])

  return { outcome, intents, syncNow, reload }
}
