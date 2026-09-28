import { api, type Settings } from './api'
import { useCachedQuery, type CachedQuery } from './offline/useOffline'

export const settingsKey = ['settings']

/**
 * The currency the owner prices in, and the list they may choose from — both from the server,
 * because the browser deliberately keeps no copy of the currency table.
 *
 * Routed through `useCachedQuery` (`web/src/offline/useOffline.ts`) rather than a plain
 * `useQuery`: `NewBooking` disables its Save button until a currency exists
 * (`web/src/booking/NewBooking.tsx`), and a booking taken on a cold, offline open needs that
 * button to enable from the last cached settings rather than staying disabled for want of a
 * server that cannot be reached. Every caller of this hook only reads `.data`, so serving it
 * from `useCachedQuery` instead of `useQuery` is a drop-in change.
 *
 * `staleTime: Infinity` is passed through because a setting only changes when the owner changes
 * it, and the mutation invalidates `settingsKey` when it does — this hook dedupes across every
 * screen that formats an amount, so there is no context to thread and no prop to pass down.
 */
export function useSettings(): CachedQuery<Settings> {
  return useCachedQuery('settings', settingsKey, () => api.get<Settings>('/api/settings'), {
    staleTime: Number.POSITIVE_INFINITY,
  })
}
