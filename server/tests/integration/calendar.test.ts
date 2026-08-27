import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, getTestDb, resetDb } from './helpers.js'
import { seedBooking, seedHouse, signIn } from './auth-helper.js'
import { addDays, nightsBetween } from '../../src/shared/nights.js'

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

// The engine keeps its bookings across resetDb, so each case looks at a window of its own.
let cursor = 0
function freshWindow(): { from: string; to: string } {
  cursor += 40
  const from = addDays('2028-01-01', cursor)
  return { from, to: addDays(from, 30) }
}

const calendar = (from: string, to: string) =>
  app.inject({ method: 'GET', url: `/api/calendar?from=${from}&to=${to}`, cookies })

const nightsOf = (body: { houses: Array<{ id: string; nights: unknown[] }> }) =>
  body.houses.find((house) => house.id === houseId)!.nights as Array<{
    date: string
    available: boolean
  }>

describe('GET /api/calendar', () => {
  it('reports availability per night, from the engine', async () => {
    const { from, to } = freshWindow()
    const response = await calendar(from, to)
    expect(response.statusCode).toBe(200)

    const nights = nightsOf(response.json())
    expect(nights).toHaveLength(nightsBetween(from, to))
    expect(nights[0]).toEqual({ date: from, available: true })
  })

  it('marks the booked nights but not the departure date', async () => {
    const { from, to } = freshWindow()
    const checkIn = addDays(from, 5)
    const checkOut = addDays(from, 7)
    await seedBooking(app, cookies, { houseId, checkIn, checkOut })

    const byDate = Object.fromEntries(
      nightsOf((await calendar(from, to)).json()).map((n) => [n.date, n.available]),
    )
    expect(byDate[checkIn]).toBe(false)
    expect(byDate[addDays(checkIn, 1)]).toBe(false)
    // The departure date is free for the next arrival — what the whole calendar rests on.
    expect(byDate[checkOut]).toBe(true)
  })

  it('joins guest and money onto each booking', async () => {
    const { from, to } = freshWindow()
    const checkIn = addDays(from, 5)
    await seedBooking(app, cookies, { houseId, checkIn, checkOut: addDays(checkIn, 2) })

    const [booking] = (await calendar(from, to)).json().bookings
    expect(booking).toMatchObject({
      check_in: checkIn,
      nights: 2,
      total: 65000,
      balance: 45000,
      orphan: false,
    })
    expect(booking.guest.name).toBe('Иван')
  })

  // Both mismatches are shown rather than hidden: a hidden booking is a night the owner
  // believes is free.
  it('flags a booking the engine has and we do not', async () => {
    const { from, to } = freshWindow()
    const checkIn = addDays(from, 5)
    await seedBooking(app, cookies, { houseId, checkIn, checkOut: addDays(checkIn, 2) })
    await getTestDb().deleteFrom('booking_details').execute()

    const [booking] = (await calendar(from, to)).json().bookings
    expect(booking.orphan).toBe(true)
    expect(booking.guest).toBeNull()
    expect(booking.check_in).toBe(checkIn)
    // The night is still shown as taken, which is the point.
    const byDate = Object.fromEntries(
      nightsOf((await calendar(from, to)).json()).map((n) => [n.date, n.available]),
    )
    expect(byDate[checkIn]).toBe(false)
  })

  it('does not show cancelled bookings as occupying nights', async () => {
    const { from, to } = freshWindow()
    const checkIn = addDays(from, 5)
    const id = await seedBooking(app, cookies, { houseId, checkIn, checkOut: addDays(checkIn, 2) })
    await app.inject({ method: 'POST', url: `/api/bookings/${id}/cancel`, cookies })

    expect(nightsOf((await calendar(from, to)).json()).every((n) => n.available)).toBe(true)
  })

  it.each([
    ['a window wider than a year', '2026-01-01', '2028-01-01'],
    ['an inverted window', '2026-10-01', '2026-09-01'],
    ['a malformed date', '01-09-2026', '2026-10-01'],
  ])('refuses %s', async (_name, from, to) => {
    expect((await calendar(from, to)).statusCode).toBe(400)
  })

  it('needs a session', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/calendar?from=2028-01-01&to=2028-02-01',
    })
    expect(response.statusCode).toBe(401)
  })
})
