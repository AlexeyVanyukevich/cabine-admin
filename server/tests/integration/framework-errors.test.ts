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

interface Refusal {
  name: string
  contentType: string
  payload: string
  status: number
  error: string
}

/** Fastify's default body limit; one byte past it is enough. */
const BODY_LIMIT = 1024 * 1024

const refusals: Refusal[] = [
  {
    name: 'a body over the size limit',
    contentType: 'application/json',
    payload: JSON.stringify({ currency: 'x'.repeat(BODY_LIMIT) }),
    status: 413,
    error: 'payload_too_large',
  },
  {
    name: 'a body that is not JSON',
    contentType: 'application/json',
    payload: '{"currency":',
    status: 400,
    error: 'bad_request',
  },
  {
    name: 'a content type with no parser',
    contentType: 'application/xml',
    payload: '<currency>RUB</currency>',
    status: 415,
    error: 'bad_request',
  },
]

/**
 * Signed in, because the guard runs before the body is parsed: an anonymous request is
 * answered 401 and never reaches the refusal under test.
 */
describe('a request the framework refuses before any route runs', () => {
  it.each(refusals)('answers $name with $status $error', async (refusal) => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      cookies,
      headers: { 'content-type': refusal.contentType },
      payload: refusal.payload,
    })

    expect(response.statusCode).toBe(refusal.status)
    expect(response.json()).toMatchObject({ error: refusal.error, message: expect.any(String) })
  })
})
