import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp, closeTestDb, getTestDb, resetDb } from './helpers.js'
import { hashPassword } from '../../src/modules/auth/password.js'

let app: FastifyInstance
const PASSWORD = 'correct horse battery staple'

beforeAll(async () => {
  app = await buildTestApp()
})
beforeEach(async () => {
  await resetDb()
  await getTestDb()
    .insertInto('owners')
    .values({ label: 'The owner', password_hash: await hashPassword(PASSWORD) })
    .execute()
})
afterAll(async () => {
  await app.close()
  await closeTestDb()
})

const login = (password = PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/login', payload: { password } })

describe('login', () => {
  it('sets an httpOnly session cookie', async () => {
    const response = await login()
    expect(response.statusCode).toBe(204)

    const cookie = response.cookies.find((c) => c.name === 'session')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax')
    expect(cookie?.path).toBe('/')
  })

  it('refuses the wrong password with the same answer as a missing one', async () => {
    const wrong = await login('nope')
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json()).toEqual({ error: 'unauthorized', message: 'Wrong password' })
  })

  it('stores only a hash of the token, never the token', async () => {
    const response = await login()
    const token = response.cookies.find((c) => c.name === 'session')!.value
    const rows = await getTestDb().selectFrom('sessions').select('token_hash').execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.token_hash).not.toBe(token)
  })

  it('ties the session to the owner it authenticated', async () => {
    await login()
    const owner = await getTestDb().selectFrom('owners').select('id').executeTakeFirstOrThrow()
    const session = await getTestDb()
      .selectFrom('sessions')
      .select('owner_id')
      .executeTakeFirstOrThrow()
    expect(session.owner_id).toBe(owner.id)
  })

  // The same answer as a wrong password: whether this server has been configured at all is
  // not something an attacker should be able to read off the login form.
  it('answers a server with no owner exactly as it answers a wrong password', async () => {
    await getTestDb().deleteFrom('owners').execute()

    const response = await login()
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized', message: 'Wrong password' })
  })

  // There is no username, so a password alone identifies nobody once there are two owners.
  // The failure must be loud and on the server: that error is the signal to add an identifier.
  it('refuses to guess when a second owner exists', async () => {
    await getTestDb()
      .insertInto('owners')
      .values({ label: 'A second owner', password_hash: await hashPassword('another password') })
      .execute()

    const response = await login()
    expect(response.statusCode).toBe(500)
    expect(await getTestDb().selectFrom('sessions').selectAll().execute()).toHaveLength(0)
  })
})

// The console faces the internet, so an offline attack is not the only one worth slowing.
// This builds its own app: a limit low enough to prove itself would otherwise be hit by
// every other case in this file.
describe('the login rate limit', () => {
  it('stops answering after too many attempts from one address', async () => {
    const limited = await buildTestApp({ config: { loginAttemptsPerMinute: 2 } })
    try {
      const attempt = () =>
        limited.inject({ method: 'POST', url: '/api/login', payload: { password: 'wrong' } })

      expect((await attempt()).statusCode).toBe(401)
      expect((await attempt()).statusCode).toBe(401)
      expect((await attempt()).statusCode).toBe(429)
    } finally {
      await limited.close()
    }
  })
})

describe('the guard', () => {
  it('refuses a protected route without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' })
    expect(response.statusCode).toBe(401)
  })

  it('admits one with a session', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { session: cookie.value },
    })
    expect(response.statusCode).toBe(200)
  })

  it('refuses a session that has been deleted — sign out everywhere works', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    await getTestDb().deleteFrom('sessions').execute()

    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { session: cookie.value },
    })
    expect(response.statusCode).toBe(401)
  })

  it('refuses an expired session', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    await getTestDb()
      .updateTable('sessions')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .execute()

    const response = await app.inject({
      method: 'GET',
      url: '/api/me',
      cookies: { session: cookie.value },
    })
    expect(response.statusCode).toBe(401)
  })

  it('leaves health public', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200)
  })
})

describe('the origin check', () => {
  it('refuses a write from a foreign origin', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    const response = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { session: cookie.value },
      headers: { origin: 'https://evil.example', host: 'cabins.example' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('allows one whose origin matches the host it was addressed to', async () => {
    const cookie = (await login()).cookies.find((c) => c.name === 'session')!
    const response = await app.inject({
      method: 'POST',
      url: '/api/logout',
      cookies: { session: cookie.value },
      headers: { origin: 'https://cabins.example', host: 'cabins.example' },
    })
    expect(response.statusCode).toBe(204)
  })
})
