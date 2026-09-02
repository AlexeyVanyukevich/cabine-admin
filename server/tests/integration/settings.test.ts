import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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

describe('GET /api/settings', () => {
  it('reports the currency in force', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings', cookies })

    expect(response.statusCode).toBe(200)
    expect(response.json().currency).toEqual({ code: 'RUB', symbol: '₽' })
  })

  /**
   * The browser keeps no copy of the currency table — this is where it gets one. A second
   * copy in the web workspace would drift, and nothing would notice until a price rendered
   * with the wrong symbol.
   */
  it('offers the currencies the owner may choose from', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings', cookies })

    expect(response.json().currencies).toEqual(
      expect.arrayContaining([
        { code: 'RUB', symbol: '₽' },
        { code: 'BYN', symbol: 'Br' },
      ]),
    )
  })

  it('needs a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings' })
    expect(response.statusCode).toBe(401)
  })
})

describe('PATCH /api/settings', () => {
  it('changes the currency', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies,
      payload: { currency: 'BYN' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().currency).toEqual({ code: 'BYN', symbol: 'Br' })
  })

  it('is what the next read reports', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies,
      payload: { currency: 'EUR' },
    })

    const response = await app.inject({ method: 'GET', url: '/api/settings', cookies })
    expect(response.json().currency.code).toBe('EUR')
  })

  /**
   * JPY is the case that matters: a real ISO 4217 code, so any check on the shape of the
   * string lets it through, and it has no minor unit. Accepting it would not add a currency —
   * it would reinterpret every integer already in the database.
   */
  it.each([
    ['a currency with no minor unit', 'JPY'],
    ['a code that is not a currency', 'XYZ'],
    ['the wrong case', 'byn'],
    ['not a code at all', 'roubles'],
    ['nothing', ''],
    ['a number', 42],
  ])('refuses %s', async (_name, currency) => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies,
      payload: { currency },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toBe('validation_error')
  })

  it('leaves the currency alone when it refuses one', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies,
      payload: { currency: 'JPY' },
    })

    const response = await app.inject({ method: 'GET', url: '/api/settings', cookies })
    expect(response.json().currency.code).toBe('RUB')
  })

  it('rejects a field it does not know', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies,
      payload: { currency: 'BYN', rate: 3.2 },
    })

    expect(response.statusCode).toBe(400)
  })

  it('needs a session', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { currency: 'BYN' },
    })
    expect(response.statusCode).toBe(401)
  })
})
