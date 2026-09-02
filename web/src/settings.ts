import { useQuery } from '@tanstack/react-query'
import { api, type Settings } from './api'

export const settingsKey = ['settings']

/**
 * The currency the owner prices in, and the list they may choose from — both from the server,
 * because the browser deliberately keeps no copy of the currency table.
 *
 * React Query dedupes this across every screen that formats an amount, so there is no context
 * to thread and no prop to pass down. `staleTime: Infinity` because a setting only changes
 * when the owner changes it, and the mutation invalidates the key when they do.
 */
export function useSettings() {
  return useQuery({
    queryKey: settingsKey,
    queryFn: () => api.get<Settings>('/api/settings'),
    staleTime: Number.POSITIVE_INFINITY,
  })
}
