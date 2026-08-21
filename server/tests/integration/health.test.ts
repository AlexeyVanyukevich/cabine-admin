import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildTestApp } from './helpers.js'

let app: FastifyInstance

beforeAll(async () => {
  app = await buildTestApp()
})
afterAll(async () => {
  await app.close()
})

describe('GET /api/health', () => {
  it('answers ok without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('never reveals the engine key', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })
    expect(response.body).not.toContain('bk_live_')
  })
})
