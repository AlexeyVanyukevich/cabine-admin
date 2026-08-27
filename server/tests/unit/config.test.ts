import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/config.js'

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5434/cabins',
  ENGINE_URL: 'http://localhost:3000',
  ENGINE_API_KEY: 'bk_live_abcdefgh' + 'A'.repeat(43),
}

describe('loadConfig', () => {
  it('parses a fully specified environment', () => {
    expect(
      loadConfig({ ...valid, PORT: '4000', SESSION_TTL_DAYS: '7', ENGINE_TIMEOUT_MS: '2000' }),
    ).toEqual({
      databaseUrl: valid.DATABASE_URL,
      engineUrl: valid.ENGINE_URL,
      engineApiKey: valid.ENGINE_API_KEY,
      engineTimeoutMs: 2000,
      port: 4000,
      sessionTtlDays: 7,
      loginAttemptsPerMinute: 10,
      logLevel: 'info',
    })
  })

  it('defaults the port, the session lifetime and the engine timeout', () => {
    const config = loadConfig(valid)
    expect(config.port).toBe(4000)
    expect(config.sessionTtlDays).toBe(30)
    expect(config.engineTimeoutMs).toBe(5000)
    expect(config.loginAttemptsPerMinute).toBe(10)
  })

  it.each(['DATABASE_URL', 'ENGINE_URL', 'ENGINE_API_KEY'])('requires %s', (key) => {
    const incomplete = { ...valid, [key]: '' }
    expect(() => loadConfig(incomplete)).toThrow(new RegExp(key))
  })

  // A trailing slash makes every request path double up: `http://host//resources`.
  it('strips a trailing slash from the engine url', () => {
    expect(loadConfig({ ...valid, ENGINE_URL: 'http://localhost:3000/' }).engineUrl).toBe(
      'http://localhost:3000',
    )
  })

  it('rejects an engine key that is not one', () => {
    expect(() => loadConfig({ ...valid, ENGINE_API_KEY: 'nope' })).toThrow(/ENGINE_API_KEY/)
  })
})
