import { useCallback, useEffect, useRef, useState } from 'react'
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
  /** The cache key THIS render is asking about. Never assume it is the one `fallback` or
   *  `checkedKey` last resolved against — see the note on `checkedKey` below. */
  cacheKey: string
  /** `query.error != null` — a fetch for this key has failed and not yet been superseded. */
  failed: boolean
  data: T | undefined
  fallback: { key: string; value: T; fetchedAt: string } | undefined
  /**
   * The cache key the last completed IndexedDB read settled for, whether or not it found
   * anything — `undefined` until the very first read finishes.
   *
   * This has to be a key, not a plain boolean. `@tanstack/react-query` can hand back a PREVIOUS
   * key's cached error synchronously — in the same render that changes `cacheKey` back to it —
   * before the effect that would otherwise reset `fallback`/this field for the new key has had
   * a chance to run. A plain "have we checked" boolean would still read `true` on that render,
   * left over from whatever key was checked last, and branch 2 below would serve THAT key's
   * `fallback` under THIS key's stamp: a month revisited while offline rendering the PREVIOUS
   * month's cache as its own. Comparing keys catches that on the very render it happens, rather
   * than a tick later once an effect fires — the bad render is in the render itself.
   */
  checkedKey: string | undefined
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
 * 2. A failed fetch with a cache entry FOR THIS KEY renders that entry, under its stamp, error
 *    suppressed. A cache entry for a DIFFERENT key is never returned here, however recent —
 *    that is a different query's answer, not this one's.
 * 3. A failed fetch whose cache read has not yet settled FOR THIS KEY stays pending rather than
 *    flashing an error, or a stale answer that belongs to some other key, a moment before it
 *    turns into this key's own stale grid.
 * 4. Otherwise the fetch failed and there is nothing to stamp for this key: surface the error.
 *    In-memory `data` from a prior success is deliberately not shown here — it carries no
 *    `fetchedAt`, so it cannot be rendered honestly under a stamp, and an explicit error is not
 *    the empty grid the calendar must never show.
 */
export function resolveCachedQuery<T>(input: ResolveInput<T>): Resolved<T> {
  const { cacheKey, failed, data, fallback, checkedKey, error, isPending } = input

  if (!failed && data !== undefined) {
    return { data, fetchedAt: undefined, stale: false, error: null, isPending: false }
  }

  if (failed && fallback !== undefined && fallback.key === cacheKey) {
    return {
      data: fallback.value,
      fetchedAt: fallback.fetchedAt,
      stale: true,
      error: null,
      isPending: false,
    }
  }

  if (failed && checkedKey !== cacheKey) {
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
  options: { staleTime?: number } = {},
): CachedQuery<T> {
  const client = useQueryClient()
  const [fallback, setFallback] = useState<
    { key: string; value: T; fetchedAt: string } | undefined
  >()
  const [checkedKey, setCheckedKey] = useState<string | undefined>()

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const value = await fetcher()
      await putCache(cacheKey, value)
      return value
    },
    ...options,
  })

  const failed = query.error != null

  useEffect(() => {
    if (!failed) {
      setFallback(undefined)
      setCheckedKey(undefined)
      return
    }
    let live = true
    readCache<T>(cacheKey)
      .then((entry) => {
        if (!live) return
        setFallback(entry === undefined ? undefined : { key: cacheKey, ...entry })
        setCheckedKey(cacheKey)
      })
      .catch(() => {
        // An IndexedDB failure (quota, private browsing) still has to resolve the "is the cache
        // checked yet" question, or branch 3 above would leave the hook pending forever.
        if (!live) return
        setFallback(undefined)
        setCheckedKey(cacheKey)
      })
    return () => {
      live = false
    }
  }, [failed, cacheKey])

  return {
    ...resolveCachedQuery({
      cacheKey,
      failed,
      data: query.data,
      fallback,
      checkedKey,
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
  /**
   * Increments once per round that actually sent something — never resets, never repeats a
   * value. A consumer that needs to react every time something is sent (Calendar's calendar
   * refetch, so a just-synced booking's nights stop showing free) cannot key that off `outcome`
   * alone: a SECOND round that also sends something resolves to the same `'synced'` value as the
   * first, and an effect does not re-run for a dependency that compares equal to what it already
   * held. This is the monotonic value that dependency needs instead.
   */
  syncSerial: number
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
  const [syncSerial, setSyncSerial] = useState(0)
  const online = useOnline()
  // A ref, not state: two overlapping rounds are not two renders' worth of a difference, they
  // are the same tick's worth. A `visibilitychange` during an in-flight round, a redundant
  // `online` event, or two taps of "Отправить сейчас" would otherwise start a second `runSync`
  // over the same queue — and the two requests it fires aren't as harmless as replaying the same
  // idempotency key twice. Each also calls `guests.findOrCreate` on the server, a read-then-insert
  // with no unique-violation recovery against a `UNIQUE` phone column, so the loser of that race
  // gets back a 500 that `runSync` treats as non-retryable and marks the intent `conflict` — the
  // owner sees "требует внимания" for a booking that was actually fine.
  const inFlight = useRef(false)

  const reload = useCallback(() => {
    void allIntents().then(setIntents)
  }, [])

  const syncNow = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    void runSync({ post: api.post, read: allIntents, save: putIntent, drop: dropIntent })
      .then((result) => {
        setOutcome(result)
        if (result === 'synced') setSyncSerial((serial) => serial + 1)
      })
      .finally(() => {
        inFlight.current = false
        reload()
      })
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

  return { outcome, intents, syncNow, reload, syncSerial }
}
