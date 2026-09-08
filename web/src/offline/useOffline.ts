import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { putCache, readCache } from './db'

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

/**
 * A read that survives losing the network: the answer is written to IndexedDB on every
 * success, and served from there — explicitly stamped as stale — when the server cannot be
 * reached.
 *
 * The stamp is not decoration. Slice 1 rejected an availability cache because a stale grid
 * "would tell the same lie more convincingly", and that reasoning still holds for a cache that
 * claims to be current. This one never claims it.
 */
export function useCachedQuery<T>(
  cacheKey: string,
  queryKey: unknown[],
  fetcher: () => Promise<T>,
): CachedQuery<T> {
  const client = useQueryClient()
  const [fallback, setFallback] = useState<{ value: T; fetchedAt: string } | undefined>()

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
      return
    }
    let live = true
    void readCache<T>(cacheKey).then((entry) => {
      if (live && entry !== undefined) setFallback(entry)
    })
    return () => {
      live = false
    }
  }, [failed, cacheKey])

  if (query.data !== undefined) {
    return {
      data: query.data,
      fetchedAt: undefined,
      stale: false,
      error: null,
      isPending: false,
      refetch: () => void client.invalidateQueries({ queryKey }),
    }
  }

  return {
    data: fallback?.value,
    fetchedAt: fallback?.fetchedAt,
    stale: fallback !== undefined,
    // A cache that answered is not an error the screen should render over; the stamp says it.
    error: fallback === undefined ? query.error : null,
    isPending: query.isPending && fallback === undefined,
    refetch: () => void client.invalidateQueries({ queryKey }),
  }
}
