import { afterAll, beforeAll, beforeEach, describe, expect, it, inject, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, getTestDb, resetDb } from './helpers.js'
import { signIn, seedHouse } from './auth-helper.js'
import { createEngineClient } from '../../src/engine/client.js'
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

/**
 * `resetDb` truncates this project's tables, but the engine has its own database and keeps
 * every booking these tests make. Re-using one date across cases would therefore fail on
 * whichever ran second, so each case takes a window of its own.
 */
let cursor = 0
function window(nights = 2): { check_in: string; check_out: string } {
  cursor += 10
  const check_in = addDays('2027-06-01', cursor)
  return { check_in, check_out: addDays(check_in, nights) }
}

const booking = (overrides: Record<string, unknown> = {}) => ({
  house_id: houseId,
  ...window(),
  guest: { name: 'Иван', phone: '+7 912 345 67 89' },
  price_per_night: 30000,
  addons: [{ code: 'sauna' }],
  deposit: 20000,
  ...overrides,
})

const post = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/bookings', cookies, payload })

describe('POST /api/bookings', () => {
  it('creates it and returns the joined view', async () => {
    const payload = booking()
    const response = await post(payload)

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({
      check_in: payload.check_in,
      check_out: payload.check_out,
      nights: 2,
      // 2 × 30000 + 5000
      total: 65000,
      balance: 45000,
      guest: { name: 'Иван', phone: '+79123456789' },
    })
  })

  it('snapshots the add-on price, so raising it later does not rewrite this total', async () => {
    const created = await post(booking())
    expect(created.statusCode).toBe(201)
    const id = created.json().id as string

    await getTestDb().updateTable('house_addon_prices').set({ default_price: 9999 }).execute()

    const reread = await app.inject({ method: 'GET', url: `/api/bookings/${id}`, cookies })
    expect(reread.json().total).toBe(65000)
  })

  it('reuses an existing guest with the same phone', async () => {
    await post(booking())
    await post(booking({ guest: { name: 'Иван Иванов', phone: '8 912 345 67 89' } }))
    expect(await getTestDb().selectFrom('guests').selectAll().execute()).toHaveLength(1)
  })

  it('refuses an add-on the house does not offer', async () => {
    expect((await post(booking({ addons: [{ code: 'helipad' }] }))).statusCode).toBe(400)
  })

  it('reports an occupied stay as a conflict the owner can understand', async () => {
    const first = booking()
    await post(first)
    const clash = await post(
      booking({ check_in: addDays(first.check_in, 1), check_out: addDays(first.check_in, 3) }),
    )

    expect(clash.statusCode).toBe(409)
    expect(clash.json().error).toBe('slot_unavailable')
  })

  it('lets a stay begin on the previous departure date', async () => {
    const first = booking()
    await post(first)
    const next = await post(
      booking({ check_in: first.check_out, check_out: addDays(first.check_out, 2) }),
    )
    expect(next.statusCode).toBe(201)
  })

  // The ordering the whole design rests on: the engine holds the night even when our own
  // write fails, so the failure is a missing name rather than a double booking.
  it('leaves the engine booking in place when the local write fails', async () => {
    const db = getTestDb()
    const real = db.insertInto.bind(db)
    // Targeted at booking_details specifically. `mockImplementationOnce` would have hit the
    // guest insert, which happens first, and the engine would never have been called at all.
    const insert = vi.spyOn(db, 'insertInto').mockImplementation(((table: string) => {
      if (table === 'booking_details') throw new Error('disk on fire')
      return real(table as never)
    }) as never)

    const payload = booking()
    const response = await post(payload)
    expect(response.statusCode).toBe(500)
    insert.mockRestore()

    // Nothing was stored here...
    expect(await getTestDb().selectFrom('booking_details').selectAll().execute()).toHaveLength(0)

    // ...but the engine is holding the night, which is the outcome worth having. The calendar
    // renders such a booking as an orphan; that is Task 9's concern, and asserting it here
    // would test the view rather than the ordering.
    const engine = createEngineClient({
      engineUrl: inject('engineUrl'),
      engineApiKey: inject('engineApiKey'),
    })
    const slots = await engine.availability(inject('houseA'), payload.check_in, payload.check_out)
    expect(slots.every((slot) => slot.available)).toBe(false)
  })

  it.each([
    ['a departure before the arrival', { check_in: '2026-09-22', check_out: '2026-09-20' }],
    ['a zero-night stay', { check_in: '2026-09-20', check_out: '2026-09-20' }],
    ['a fractional price', { price_per_night: 300.5 }],
    ['a negative deposit', { deposit: -1 }],
    ['a blank guest name', { guest: { name: ' ', phone: '+79123456789' } }],
    ['a phone that is not one', { guest: { name: 'Иван', phone: 'нет' } }],
  ])('refuses %s', async (_name, override) => {
    expect((await post(booking(override))).statusCode).toBe(400)
  })

  it('needs a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      payload: booking(),
    })
    expect(response.statusCode).toBe(401)
  })
})

/**
 * The same rule that keeps `price_per_night` on the row rather than read live from the house: a
 * booking means what it meant when it was agreed. Without this, changing the setting would
 * relabel settled totals and show the owner a debt that never existed.
 */
describe('the currency a booking was agreed in', () => {
  const setCurrency = (currency: string) =>
    app.inject({ method: 'PATCH', url: '/api/settings', cookies, payload: { currency } })

  it('is the one in force when it was made', async () => {
    await setCurrency('BYN')

    const response = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking(),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().currency).toBe('BYN')
  })

  it('survives a later change of the setting', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking(),
    })
    expect(created.json().currency).toBe('RUB')

    await setCurrency('EUR')

    const reread = await app.inject({
      method: 'GET',
      url: `/api/bookings/${created.json().id}`,
      cookies,
    })
    expect(reread.json().currency).toBe('RUB')
  })

  it('does not move the total either', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/bookings',
      cookies,
      payload: booking(),
    })
    const before = created.json().total

    await setCurrency('EUR')

    const reread = await app.inject({
      method: 'GET',
      url: `/api/bookings/${created.json().id}`,
      cookies,
    })
    expect(reread.json().total).toBe(before)
  })
})
