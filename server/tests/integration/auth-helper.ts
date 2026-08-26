import { inject } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { getTestDb } from './helpers.js'
import { hashPassword } from '../../src/modules/auth/password.js'

const PASSWORD = 'correct horse battery staple'

/**
 * Seeds the owner and signs in, so every suite that is not about authentication says
 * `cookies` and nothing more.
 */
export async function signIn(app: FastifyInstance): Promise<Record<string, string>> {
  await getTestDb()
    .insertInto('owners')
    .values({ label: 'The owner', password_hash: await hashPassword(PASSWORD) })
    .execute()

  const response = await app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password: PASSWORD },
  })
  const cookie = response.cookies.find((c) => c.name === 'session')
  if (cookie === undefined) throw new Error(`Could not sign in: ${response.statusCode}`)
  return { session: cookie.value }
}

/** A house pointing at the harness's first seeded resource. Returns its local id. */
export async function seedHouse(
  app: FastifyInstance,
  cookies: Record<string, string>,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/houses',
    cookies,
    payload: {
      engine_resource_id: inject('houseA'),
      name: 'Дом у озера',
      price_per_night: 30000,
      addons: [{ code: 'sauna', label: 'Баня', default_price: 5000 }],
      ...overrides,
    },
  })
  if (response.statusCode !== 201) {
    throw new Error(`Could not seed a house: ${response.statusCode} ${response.body}`)
  }
  return response.json().id as string
}

/** A confirmed booking with one add-on. Returns the engine's booking id. */
export async function seedBooking(
  app: FastifyInstance,
  cookies: Record<string, string>,
  input: {
    houseId: string
    checkIn: string
    checkOut: string
    overrides?: Record<string, unknown>
  },
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/bookings',
    cookies,
    payload: {
      house_id: input.houseId,
      check_in: input.checkIn,
      check_out: input.checkOut,
      guest: { name: 'Иван', phone: '+79123456789' },
      price_per_night: 30000,
      addons: [{ code: 'sauna' }],
      deposit: 20000,
      ...input.overrides,
    },
  })
  if (response.statusCode !== 201) {
    throw new Error(`Could not seed a booking: ${response.statusCode} ${response.body}`)
  }
  return response.json().id as string
}
