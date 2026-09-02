import { describe, expect, it } from 'vitest'
import config from '../vite.config'

/**
 * The server rejects any write whose `Origin` disagrees with the `Host` it was addressed to
 * (`server/src/modules/auth/guard.ts`) — a CSRF check that needs no configured origin and so
 * keeps working on any port.
 *
 * Vite 8 defaults `changeOrigin` to true, which rewrites `Host` to the proxy target while the
 * browser's `Origin` stays the dev server's. The two then disagree on every non-GET request
 * and development dies at the login button with `forbidden_origin`. The shorthand string form
 * of a proxy entry silently takes that default, which is how this was missed.
 *
 * Production is unaffected: Fastify serves the SPA itself, so there is no proxy and the two
 * headers always agree. That is exactly why a browser test cannot catch this — the Playwright
 * suite runs against the built bundle, never against the dev proxy.
 */
describe('the dev proxy', () => {
  const proxy = (config as { server?: { proxy?: Record<string, unknown> } }).server?.proxy ?? {}

  it('proxies the API', () => {
    expect(Object.keys(proxy)).toContain('/api')
  })

  it('passes the browser’s Host through untouched, or every write is refused', () => {
    const api = proxy['/api']

    // A bare string would take Vite's default, which is the bug this guards.
    expect(typeof api).toBe('object')
    expect((api as { changeOrigin?: boolean }).changeOrigin).toBe(false)
  })
})
