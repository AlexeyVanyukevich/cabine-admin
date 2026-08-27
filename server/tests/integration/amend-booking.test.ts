import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, getTestDb, resetDb } from './helpers.js'
import { seedBooking, seedHouse, signIn } from './auth-helper.js'
import { addDays } from '../../src/shared/nights.js'

let app: FastifyInstance
let cookies: Record<string, string>
let houseId: string

beforeAll(async () => {
  app = await buildTestApp()
})
beforeEach(async () => {
  await resetDb()
  cookies = await signIn(app)
  houseId = await seedHouse(app, cookies)
})
afterAll(async () => {
  await app.close()
  await closeTestDb()
})

// The engine keeps its bookings across resetDb, so each case books in a window of its own.
let cursor = 0
function freshStay(nights = 2): { checkIn: string; checkOut: string } {
  cursor += 30
  const checkIn = addDays('2029-01-01', cursor)
  return { checkIn, checkOut: addDays(checkIn, nights) }
}

const get = (id: string) => app.inject({ method: 'GET', url: `/api/bookings/${id}`, cookies })

describe('POST /api/bookings/:id/reschedule', () => {
  // The reason the total is computed on read: a stored total would have to be recomputed on
  // every path that moves a booking, and one of them would eventually forget.
  it('recomputes the total when the stay gets longer', async () => {
    const { checkIn, checkOut } = freshStay()
    const id = await seedBooking(app, cookies, { houseId, checkIn, checkOut })
    expect((await get(id)).json().total).toBe(65000)

    const response = await app.inject({
      method: 'POST',
      url: `/api/bookings/${id}/reschedule`,
      cookies,
      payload: { check_in: checkIn, check_out: addDays(checkIn, 3) },
    })
    expect(response.statusCode).toBe(200)

    // Three nights now, and the add-on is unchanged: 3 × 30000 + 5000.
    expect((await get(id)).json()).toMatchObject({ nights: 3, total: 95000, balance: 75000 })
  })

  it('frees the nights it moved away from', async () => {
    const { checkIn, checkOut } = freshStay()
    const id = await seedBooking(app, cookies, { houseId, checkIn, checkOut })

    const moved = addDays(checkIn, 10)
    await app.inject({
      method: 'POST',
      url: `/api/bookings/${id}/reschedule`,
      cookies,
      payload: { check_in: moved, check_out: addDays(moved, 2) },
    })

    const calendar = await app.inject({
      method: 'GET',
      url: `/api/calendar?from=${checkIn}&to=${addDays(checkIn, 20)}`,
      cookies,
    })
    const nights = calendar.json().houses.find((h: { id: string }) => h.id === houseId).nights
    const byDate = Object.fromEntries(
      nights.map((n: { date: string; available: boolean }) => [n.date, n.available]),
    )
    expect(byDate[checkIn]).toBe(true)
    expect(byDate[moved]).toBe(false)
  })

  it('answers 409 and leaves the booking where it was when the nights are taken', async () => {
    const first = freshStay()
    const second = freshStay()
    const id = await seedBooking(app, cookies, { houseId, ...first })
    await seedBooking(app, cookies, {
      houseId,
      checkIn: second.checkIn,
      checkOut: second.checkOut,
      overrides: { guest: { name: 'Пётр', phone: '+48111222333' } },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/bookings/${id}/reschedule`,
      cookies,
      payload: { check_in: second.checkIn, check_out: second.checkOut },
    })
    expect(response.statusCode).toBe(409)
    expect((await get(id)).json().check_in).toBe(first.checkIn)
  })

  it('answers 404 for a booking the engine does not have', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings/00000000-0000-4000-8000-000000000000/reschedule',
      cookies,
      payload: { check_in: '2029-06-01', check_out: '2029-06-03' },
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('POST /api/bookings/:id/cancel', () => {
  // Cancelled is a status the engine owns; the guest and the money stay here as history.
  it('keeps the details as history', async () => {
    const { checkIn, checkOut } = freshStay()
    const id = await seedBooking(app, cookies, { houseId, checkIn, checkOut })

    const response = await app.inject({
      method: 'POST',
      url: `/api/bookings/${id}/cancel`,
      cookies,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().status).toBe('cancelled')

    expect(await getTestDb().selectFrom('booking_details').selectAll().execute()).toHaveLength(1)
    expect((await get(id)).json().guest.name).toBe('Иван')
  })
})

describe('PATCH /api/bookings/:id', () => {
  it('updates the deposit and the note without touching the engine', async () => {
    const { checkIn, checkOut } = freshStay()
    const id = await seedBooking(app, cookies, { houseId, checkIn, checkOut })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/bookings/${id}`,
      cookies,
      payload: { deposit: 65000, note: 'Оплачено полностью' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      deposit: 65000,
      balance: 0,
      note: 'Оплачено полностью',
      check_in: checkIn,
    })
  })

  it('refuses a negative deposit', async () => {
    const { checkIn, checkOut } = freshStay()
    const id = await seedBooking(app, cookies, { houseId, checkIn, checkOut })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/bookings/${id}`,
      cookies,
      payload: { deposit: -1 },
    })
    expect(response.statusCode).toBe(400)
  })

  it('answers 404 for a booking with no details here', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/bookings/00000000-0000-4000-8000-000000000000',
      cookies,
      payload: { deposit: 100 },
    })
    expect(response.statusCode).toBe(404)
  })
})
