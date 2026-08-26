import type { FastifyInstance } from 'fastify'
import { AppError } from '../../shared/errors.js'
import type { AuthService } from './auth.service.js'

export class UnauthorizedError extends AppError {
  readonly statusCode = 401
  readonly code = 'unauthorized'
}

export class ForbiddenOriginError extends AppError {
  readonly statusCode = 403
  readonly code = 'forbidden_origin'
}

declare module 'fastify' {
  interface FastifyRequest {
    sessionId: string
  }
  interface FastifyContextConfig {
    public?: true
  }
}

export function registerGuard(app: FastifyInstance, service: AuthService): void {
  app.decorateRequest('sessionId', '')

  // Compared against the host the request was addressed to rather than a configured origin,
  // so the check keeps working behind a proxy and on an ephemeral test port.
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') return
    const origin = request.headers.origin
    if (origin === undefined) return
    const host = request.headers.host
    if (host === undefined || new URL(origin).host !== host) {
      throw new ForbiddenOriginError('This request did not come from the console')
    }
  })

  app.addHook('onRequest', async (request) => {
    // Only the API is guarded. The SPA's own HTML, its bundle and its assets must load without
    // a session — the page is what shows the login form, so protecting it would mean the
    // owner is answered 401 by the very screen that exists to fix that.
    if (!request.url.startsWith('/api/')) return
    if (request.routeOptions.config?.public === true) return

    const token = request.cookies.session
    if (token === undefined) throw new UnauthorizedError('Sign in first')

    const session = await service.resolve(token)
    if (session === undefined) throw new UnauthorizedError('Sign in first')

    request.sessionId = session.id
  })
}
