import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, resetDb } from './helpers.js'
import { seedBooking, seedHouse, signIn } from './auth-helper.js'
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

const create = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/guests', cookies, payload })

describe('POST /api/guests', () => {
  it('stores the phone normalised, whatever spelling arrived', async () => {
    const response = await create({ name: 'Иван', phone: '+7 (912) 345-67-89' })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ name: 'Иван', phone: '+79123456789' })
  })

  // The phone is the identity: one person must not become two histories because the owner
  // typed the number differently the second time.
  it('returns the existing guest when the same number arrives spelled differently', async () => {
    const first = await create({ name: 'Иван', phone: '+7 912 345 67 89' })
    const second = await create({ name: 'Иван', phone: '79123456789' })

    expect(second.statusCode).toBe(200)
    expect(second.json().id).toBe(first.json().id)
  })

  // A returning guest must not undo a correction the owner has already made.
  it('does not overwrite a name the owner has already set', async () => {
    const first = await create({ name: 'Иван Петров', phone: '+79123456789' })
    await create({ name: 'иван', phone: '+79123456789' })

    const response = await app.inject({
      method: 'GET',
      url: `/api/guests/${first.json().id}`,
      cookies,
    })
    expect(response.json().name).toBe('Иван Петров')
  })

  it.each([
    ['a blank name', { name: '  ', phone: '+79123456789' }],
    ['a number that is not one', { name: 'Иван', phone: '123' }],
  ])('refuses %s', async (_name, payload) => {
    expect((await create(payload)).statusCode).toBe(400)
  })

  it('refuses an unknown field rather than ignoring it', async () => {
    const response = await create({ name: 'Иван', phone: '+79123456789', vip: true })
    expect(response.statusCode).toBe(400)
  })

  it('needs a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/guests',
      payload: { name: 'Иван', phone: '+79123456789' },
    })
    expect(response.statusCode).toBe(401)
  })
})

describe('GET /api/guests', () => {
  it('finds one by phone, however it is spelled in the query', async () => {
    await create({ name: 'Иван', phone: '+79123456789' })

    const response = await app.inject({
      method: 'GET',
      url: `/api/guests?phone=${encodeURIComponent('+7 (912) 345-67-89')}`,
      cookies,
    })
    expect(response.json()).toHaveLength(1)
    expect(response.json()[0].phone).toBe('+79123456789')
  })

  it('answers an empty list rather than an error for an unknown number', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/guests?phone=%2B48111222333',
      cookies,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('lists everyone when no phone is given', async () => {
    await create({ name: 'Иван', phone: '+79123456789' })
    await create({ name: 'Пётр', phone: '+48111222333' })

    const response = await app.inject({ method: 'GET', url: '/api/guests', cookies })
    expect(response.json()).toHaveLength(2)
  })
})

describe('PATCH /api/guests/:id', () => {
  it('corrects a name and a note', async () => {
    const created = await create({ name: 'иван', phone: '+79123456789' })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/guests/${created.json().id}`,
      cookies,
      payload: { name: 'Иван Петров', note: 'Приезжает с собакой' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      name: 'Иван Петров',
      note: 'Приезжает с собакой',
    })
  })

  it('answers 404 for a guest that is not there', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/guests/00000000-0000-4000-8000-000000000000',
      cookies,
      payload: { name: 'Кто-то' },
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('GET /api/guests/:id/bookings', () => {
  it('lists a guest’s stays, newest first, with dates from the engine', async () => {
    const houseId = await seedHouse(app, cookies)
    const first = addDays('2031-03-01', 0)
    const second = addDays('2031-03-01', 20)

    await seedBooking(app, cookies, { houseId, checkIn: first, checkOut: addDays(first, 2) })
    await seedBooking(app, cookies, { houseId, checkIn: second, checkOut: addDays(second, 1) })

    const guest = await app.inject({
      method: 'GET',
      url: `/api/guests?phone=${encodeURIComponent('+79123456789')}`,
      cookies,
    })
    const guestId = guest.json()[0].id as string

    const response = await app.inject({
      method: 'GET',
      url: `/api/guests/${guestId}/bookings`,
      cookies,
    })

    expect(response.statusCode).toBe(200)
    const stays = response.json()
    expect(stays).toHaveLength(2)
    // Newest first: the later stay leads.
    expect(stays[0].check_in).toBe(second)
    expect(stays[1].check_in).toBe(first)
    expect(stays[0]).toMatchObject({ house_name: 'Дом у озера', total: 35000 })
  })

  it('answers an empty list for a guest who has never stayed', async () => {
    const created = await create({ name: 'Никто', phone: '+48999888777' })
    const response = await app.inject({
      method: 'GET',
      url: `/api/guests/${created.json().id}/bookings`,
      cookies,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([])
  })

  it('answers 404 for a guest that is not there', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/guests/00000000-0000-4000-8000-000000000000/bookings',
      cookies,
    })
    expect(response.statusCode).toBe(404)
  })
})
