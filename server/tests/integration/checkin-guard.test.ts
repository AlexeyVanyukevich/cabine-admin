import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, resetDb } from './helpers.js'
import { seedBooking, seedHouse, signIn } from './auth-helper.js'
import { createEngineClient } from '../../src/engine/client.js'
import { bookingsBlockingCheckInChange } from '../../src/modules/houses/checkin.js'
import { addDays } from '../../src/shared/nights.js'

let app: FastifyInstance
let cookies: Record<string, string>

beforeAll(async () => {
  app = await buildTestApp()
})
beforeEach(async () => {
  await resetDb()
  cookies = await signIn(app)
})
afterAll(async () => {
  await app.close()
  await closeTestDb()
})

const engine = () =>
  createEngineClient({ engineUrl: inject('engineUrl'), engineApiKey: inject('engineApiKey') })

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Years out, where no other suite books. The engine keeps every booking for the whole run, so
 * these assertions are about a named stay appearing or not — never about the list being empty,
 * which another file can always spoil.
 */
const far = (days: number) => addDays(today(), 2000 + days)

describe('bookingsBlockingCheckInChange', () => {
  it('reports a stay still to come', async () => {
    const houseId = await seedHouse(app, cookies)
    const checkIn = far(0)
    await seedBooking(app, cookies, { houseId, checkIn, checkOut: addDays(checkIn, 2) })

    const blocking = await bookingsBlockingCheckInChange(engine(), inject('houseA'), far(-5))
    expect(blocking.map((booking) => booking.checkIn)).toContain(checkIn)
  })

  // Past nights are behind us and nobody decides anything from them, so they do not block.
  it('ignores a stay that is already over', async () => {
    const houseId = await seedHouse(app, cookies)
    const checkIn = far(20)
    await seedBooking(app, cookies, { houseId, checkIn, checkOut: addDays(checkIn, 2) })

    const blocking = await bookingsBlockingCheckInChange(engine(), inject('houseA'), far(30))
    expect(blocking.map((booking) => booking.checkIn)).not.toContain(checkIn)
  })

  it('ignores a cancelled stay, which holds nothing', async () => {
    const houseId = await seedHouse(app, cookies)
    const checkIn = far(40)
    const id = await seedBooking(app, cookies, { houseId, checkIn, checkOut: addDays(checkIn, 1) })
    await app.inject({ method: 'POST', url: `/api/bookings/${id}/cancel`, cookies })

    const blocking = await bookingsBlockingCheckInChange(engine(), inject('houseA'), far(35))
    expect(blocking.map((booking) => booking.checkIn)).not.toContain(checkIn)
  })

  it('ignores another house’s bookings', async () => {
    const houseId = await seedHouse(app, cookies)
    const checkIn = far(60)
    await seedBooking(app, cookies, { houseId, checkIn, checkOut: addDays(checkIn, 1) })

    const blocking = await bookingsBlockingCheckInChange(engine(), inject('houseB'), far(55))
    expect(blocking.map((booking) => booking.checkIn)).not.toContain(checkIn)
  })
})
