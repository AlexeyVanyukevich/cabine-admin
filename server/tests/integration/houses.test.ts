import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, resetDb } from './helpers.js'
import { signIn } from './auth-helper.js'

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

const house = (overrides = {}) => ({
  engine_resource_id: inject('houseA'),
  name: 'Дом у озера',
  price_per_night: 30000,
  ...overrides,
})

describe('POST /api/houses', () => {
  it('creates a house with its add-ons', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: { ...house(), addons: [{ code: 'sauna', label: 'Баня', default_price: 5000 }] },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().addons).toEqual([
      expect.objectContaining({ code: 'sauna', label: 'Баня', default_price: 5000 }),
    ])
  })

  // The owner names an extra; they do not invent an identifier for it. A code typed by a
  // person is a code that will eventually be typed differently.
  it('generates the add-on code when only a label and a price are given', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: { ...house(), addons: [{ label: 'Купель', default_price: 70000 }] },
    })

    expect(response.statusCode).toBe(201)
    const [addon] = response.json().addons
    expect(addon).toMatchObject({ label: 'Купель', default_price: 70000 })
    expect(addon.code).toEqual(expect.any(String))
    expect(addon.code.length).toBeGreaterThan(0)
  })

  it('keeps two generated codes apart within one house', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: {
        ...house(),
        addons: [
          { label: 'Баня', default_price: 50000 },
          { label: 'Купель', default_price: 70000 },
        ],
      },
    })

    expect(response.statusCode).toBe(201)
    const codes = response.json().addons.map((addon: { code: string }) => addon.code)
    expect(new Set(codes).size).toBe(2)
  })

  it('records the check-out time and answers with it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: { ...house(), checkout_time: '11:00' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().checkout_time).toBe('11:00')
  })

  it('refuses a second house pointing at the same engine resource', async () => {
    await app.inject({ method: 'POST', url: '/api/houses', cookies, payload: house() })
    const second = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: house({ name: 'Другой' }),
    })
    expect(second.statusCode).toBe(409)
  })

  // A typo here would otherwise surface much later as a house whose calendar column is
  // permanently empty, which reads as "never booked" rather than "wrong id".
  it('refuses a resource the engine does not have', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: house({ engine_resource_id: '00000000-0000-4000-8000-000000000000' }),
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().details).toMatchObject({ field: 'engine_resource_id' })
  })

  it.each([
    ['a negative price', { price_per_night: -1 }],
    ['a fractional price — money is minor units', { price_per_night: 300.5 }],
    ['a blank name', { name: '  ' }],
    ['an engine id that is not a uuid', { engine_resource_id: 'nope' }],
  ])('refuses %s', async (_name, override) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: house(override),
    })
    expect(response.statusCode).toBe(400)
  })

  it('refuses an unknown field rather than ignoring it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: { ...house(), timezone: 'Europe/Warsaw' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('needs a session', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/houses', payload: house() })
    expect(response.statusCode).toBe(401)
  })
})

describe('GET /api/houses', () => {
  it('lists houses with their add-ons', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: { ...house(), addons: [{ code: 'sauna', label: 'Баня', default_price: 5000 }] },
    })
    const response = await app.inject({ method: 'GET', url: '/api/houses', cookies })
    expect(response.json()).toHaveLength(1)
    expect(response.json()[0].addons).toHaveLength(1)
  })

  it('needs a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/houses' })).statusCode).toBe(401)
  })
})

describe('PATCH /api/houses/:id', () => {
  it('changes the nightly price without touching bookings already made', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/houses',
      cookies,
      payload: house(),
    })
    const id = created.json().id as string

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/houses/${id}`,
      cookies,
      payload: { price_per_night: 35000 },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json().price_per_night).toBe(35000)
  })

  it('answers 404 for a house that is not there', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/houses/00000000-0000-4000-8000-000000000000',
      cookies,
      payload: { price_per_night: 35000 },
    })
    expect(response.statusCode).toBe(404)
  })
})
