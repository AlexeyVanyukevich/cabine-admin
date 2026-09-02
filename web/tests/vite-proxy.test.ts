import { describe, expect, it } from 'vitest'
import config from '../vite.config'

/**
 * The server rejects any write whose `Origin` disagrees with the `Host` it was addressed to
 * (`server/src/modules/auth/guard.ts`) — a CSRF check that needs no configured origin and so
 * keeps working on any port.
 *
 * Left to its default the dev proxy rewrites `Host` to its target while the browser's `Origin`
 * stays the dev server's. The two then disagree on every write, and development dies at the
 * login button. The shorthand string form of a proxy entry takes that default silently, which
 * is how this was missed.
 *
 * Production is unaffected: the server serves the bundle itself, so there is no proxy and the
 * two headers always agree. That is also why no browser test can catch this — the journey
 * suite runs against the built bundle, never against the dev proxy.
 */
describe('the dev proxy', () => {
  const proxy = (config as { server?: { proxy?: Record<string, unknown> } }).server?.proxy ?? {}

  it('proxies the API', () => {
    expect(Object.keys(proxy)).toContain('/api')
  })

  it('passes the browser’s Host through untouched, or every write is refused', () => {
    const api = proxy['/api']

    // A bare string would take the proxy's default, which is the bug this guards.
    expect(typeof api).toBe('object')
    expect((api as { changeOrigin?: boolean }).changeOrigin).toBe(false)
  })
})
