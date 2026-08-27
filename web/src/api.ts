/**
 * Every call goes to this project's own server. The booking engine is never addressed from a
 * browser: its key lives on the server and nowhere else, and the minimum-stay and horizon
 * rules only hold while the server is the only caller.
 */

export interface ApiErrorBody {
  error: string
  message: string
  details?: unknown
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Raised on a 401 so the router can show the login screen instead of a broken page. */
export class NotSignedIn extends ApiError {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      // The session cookie is httpOnly; the browser attaches it, nothing here reads it.
      credentials: 'same-origin',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError('offline', 0, 'Нет связи с сервером. Проверьте интернет.')
  }

  if (response.status === 204) return undefined as T

  const body = (await response.json().catch(() => ({}))) as Partial<ApiErrorBody>

  if (!response.ok) {
    const message = body.message ?? `Ошибка ${response.status}`
    if (response.status === 401) {
      throw new NotSignedIn(body.error ?? 'unauthorized', 401, message)
    }
    throw new ApiError(body.error ?? 'unknown', response.status, message, body.details)
  }

  return body as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, {
      method: 'POST',
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  patch: <T>(path: string, payload: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(payload) }),
}

export interface Night {
  date: string
  available: boolean
}

export interface CalendarHouse {
  id: string
  name: string
  nights: Night[]
}

export interface Guest {
  id: string
  name: string
  phone: string
  note: string | null
}

export interface Booking {
  id: string
  house_id: string | null
  house_name: string | null
  check_in: string
  check_out: string
  nights: number
  status: 'held' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'expired'
  price_per_night: number | null
  addons: Array<{ code: string; label: string; price: number }>
  total: number | null
  deposit: number | null
  balance: number | null
  note: string | null
  guest: Guest | null
  orphan: boolean
}

export interface CalendarView {
  houses: CalendarHouse[]
  bookings: Booking[]
}

export interface House {
  id: string
  engine_resource_id: string
  name: string
  price_per_night: number
  /** `HH:MM`, ours. */
  checkout_time: string
  /** `HH:MM`, the engine's slot boundary. Null only when the engine could not be reached. */
  checkin_time: string | null
  addons: Array<{ id: string; code: string; label: string; default_price: number }>
}
