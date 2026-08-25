import { DateTime } from 'luxon'
import { EngineError, EngineUnreachableError, isRetryable } from './errors.js'
import { localDate } from '../shared/nights.js'

export interface EngineBooking {
  id: string
  resourceId: string
  /** House-local, YYYY-MM-DD. */
  checkIn: string
  checkOut: string
  status: 'held' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'expired'
}

export interface EngineSlot {
  date: string
  available: boolean
}

export interface EngineClient {
  listBookings: (from: string, to: string) => Promise<EngineBooking[]>
  getBooking: (id: string) => Promise<EngineBooking | undefined>
  availability: (resourceId: string, from: string, to: string) => Promise<EngineSlot[]>
  createBooking: (
    resourceId: string,
    checkIn: string,
    checkOut: string,
    idempotencyKey: string,
  ) => Promise<EngineBooking>
  reschedule: (id: string, checkIn: string, checkOut: string) => Promise<EngineBooking>
  cancel: (id: string) => Promise<EngineBooking>
}

export interface EngineClientOptions {
  engineUrl: string
  engineApiKey: string
  /** A hung engine must not hang this request; the owner would watch a spinner with no reason. */
  timeoutMs?: number
  maxAttempts?: number
}

interface RawBooking {
  id: string
  resource_id: string
  start_time: string
  end_time: string
  status: EngineBooking['status']
}

interface RawSlot {
  start: string
  end: string
  available: boolean
}

export function createEngineClient(options: EngineClientOptions): EngineClient {
  const timeoutMs = options.timeoutMs ?? 5_000
  const maxAttempts = options.maxAttempts ?? 3

  async function call<T>(path: string, init: RequestInit = {}): Promise<T | undefined> {
    let lastError: EngineError | undefined

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response
      try {
        response = await fetch(`${options.engineUrl}${path}`, {
          ...init,
          headers: {
            // Only when something is actually being sent. Fastify refuses a request that
            // declares JSON and then carries nothing, which is every bodyless POST here.
            ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
            // The only place this key is named.
            authorization: `Bearer ${options.engineApiKey}`,
            ...(init.headers ?? {}),
          },
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (cause) {
        throw new EngineUnreachableError(`The booking engine did not answer ${path}`, cause)
      }

      if (response.status === 404) return undefined
      if (response.ok) {
        return response.status === 204 ? undefined : ((await response.json()) as T)
      }

      const body = (await response.json().catch(() => ({}))) as {
        error?: string
        message?: string
        details?: unknown
      }
      lastError = new EngineError(
        body.error ?? 'unknown',
        response.status,
        body.message ?? `The engine answered ${response.status}`,
        body.details,
      )

      if (!isRetryable(lastError) || attempt === maxAttempts) throw lastError
      // Linear backoff is enough: contention here is two of the owner's own tabs, not a herd.
      await new Promise((resolve) => setTimeout(resolve, attempt * 250))
    }

    throw lastError
  }

  /**
   * The engine anchors a day-long slot at a wall-clock time in the resource's own zone — 15:00
   * for these houses — and rejects any interval that does not land on a boundary. A midnight
   * timestamp is therefore not a valid check-in, so the anchor and the zone have to be read
   * from the resource before a date can be turned into an instant.
   */
  const resources = new Map<string, { timezone: string; anchor: string }>()

  async function resourceOf(resourceId: string): Promise<{ timezone: string; anchor: string }> {
    const cached = resources.get(resourceId)
    if (cached !== undefined) return cached

    const raw = await call<{ timezone: string; slot_anchor_time: string }>(
      `/resources/${resourceId}`,
    )
    if (raw === undefined) throw new EngineError('not_found', 404, `No house ${resourceId}`)

    // Immutable in the engine — `timezone` cannot be patched — so this cache cannot go stale.
    const value = { timezone: raw.timezone, anchor: raw.slot_anchor_time.slice(0, 5) }
    resources.set(resourceId, value)
    return value
  }

  async function instant(resourceId: string, date: string): Promise<string> {
    const { timezone, anchor } = await resourceOf(resourceId)
    const at = DateTime.fromISO(`${date}T${anchor}`, { zone: timezone })
    if (!at.isValid) throw new Error(`Could not place ${date} at ${anchor} in ${timezone}`)
    return at.toISO({ suppressMilliseconds: true })!
  }

  const toBooking = (raw: RawBooking): EngineBooking => ({
    id: raw.id,
    resourceId: raw.resource_id,
    checkIn: localDate(raw.start_time),
    checkOut: localDate(raw.end_time),
    status: raw.status,
  })

  return {
    async listBookings(from, to) {
      const raw = await call<RawBooking[]>(
        `/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      return (raw ?? []).map(toBooking)
    },

    async getBooking(id) {
      const raw = await call<RawBooking>(`/bookings/${id}`)
      return raw === undefined ? undefined : toBooking(raw)
    },

    async availability(resourceId, from, to) {
      const raw = await call<{ slots: RawSlot[] }>(
        `/resources/${resourceId}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      )
      // The engine answers with instants; the calendar is drawn in nights, and the night is
      // named by the date the guest arrives.
      return (raw?.slots ?? []).map((slot) => ({
        date: localDate(slot.start),
        available: slot.available,
      }))
    },

    async createBooking(resourceId, checkIn, checkOut, idempotencyKey) {
      const raw = await call<RawBooking>(`/resources/${resourceId}/bookings`, {
        method: 'POST',
        body: JSON.stringify({
          start_time: await instant(resourceId, checkIn),
          end_time: await instant(resourceId, checkOut),
          idempotency_key: idempotencyKey,
        }),
      })
      if (raw === undefined) throw new EngineError('not_found', 404, `No house ${resourceId}`)
      return toBooking(raw)
    },

    async reschedule(id, checkIn, checkOut) {
      // The resource is needed to build the timestamps, and only the booking knows which.
      const existing = await call<RawBooking>(`/bookings/${id}`)
      if (existing === undefined) throw new EngineError('not_found', 404, `No booking ${id}`)

      const raw = await call<RawBooking>(`/bookings/${id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({
          start_time: await instant(existing.resource_id, checkIn),
          end_time: await instant(existing.resource_id, checkOut),
        }),
      })
      if (raw === undefined) throw new EngineError('not_found', 404, `No booking ${id}`)
      return toBooking(raw)
    },

    async cancel(id) {
      const raw = await call<RawBooking>(`/bookings/${id}/cancel`, { method: 'POST' })
      if (raw === undefined) throw new EngineError('not_found', 404, `No booking ${id}`)
      return toBooking(raw)
    },
  }
}
