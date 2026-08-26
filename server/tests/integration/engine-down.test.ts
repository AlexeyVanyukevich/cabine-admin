import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeTestDb, resetDb } from './helpers.js'
import { buildTestApp } from './helpers.js'
import { signIn } from './auth-helper.js'

beforeEach(resetDb)
afterAll(closeTestDb)

const window = '?from=2026-09-01&to=2026-10-01'

describe('when the engine does not answer', () => {
  it('answers 503 with a distinct code, never an empty calendar', async () => {
    // Port 1 is reserved and refuses immediately, so this does not wait out the timeout.
    const app = await buildTestApp({ config: { engineUrl: 'http://127.0.0.1:1' } })
    try {
      const cookies = await signIn(app)
      const response = await app.inject({
        method: 'GET',
        url: `/api/calendar${window}`,
        cookies,
      })

      expect(response.statusCode).toBe(503)
      expect(response.json().error).toBe('engine_unreachable')
      // The one thing that must never happen: a 200 with no bookings, which the interface
      // would draw as a month of free nights.
      expect(response.statusCode).not.toBe(200)
    } finally {
      await app.close()
    }
  })

  // A revoked key must not read as a network blip, or the owner spends half an hour
  // reloading a page that will never come back on its own.
  it('distinguishes a revoked key from an outage', async () => {
    const app = await buildTestApp({
      config: { engineApiKey: `bk_live_${'A'.repeat(51)}` },
    })
    try {
      const cookies = await signIn(app)
      const response = await app.inject({
        method: 'GET',
        url: `/api/calendar${window}`,
        cookies,
      })

      expect(response.statusCode).toBe(502)
      expect(response.json().error).toBe('engine_rejected_our_key')
    } finally {
      await app.close()
    }
  })

  it('refuses to create a booking rather than pretending it was made', async () => {
    const app = await buildTestApp({ config: { engineUrl: 'http://127.0.0.1:1' } })
    try {
      const cookies = await signIn(app)
      const response = await app.inject({
        method: 'POST',
        url: '/api/houses',
        cookies,
        payload: {
          engine_resource_id: '00000000-0000-4000-8000-000000000000',
          name: 'Дом',
          price_per_night: 30000,
        },
      })

      // Creating a house checks the engine first, so it fails the same way rather than
      // storing a house whose resource was never verified.
      expect(response.statusCode).toBe(503)
      expect(response.json().error).toBe('engine_unreachable')
    } finally {
      await app.close()
    }
  })

  it('still answers health, so a probe can tell the two apart', async () => {
    const app = await buildTestApp({ config: { engineUrl: 'http://127.0.0.1:1' } })
    try {
      const response = await app.inject({ method: 'GET', url: '/api/health' })
      expect(response.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})
