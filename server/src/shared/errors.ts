import type { FastifyError, FastifyInstance } from 'fastify'
import { EngineError, EngineUnreachableError, isOwnerFacing } from '../engine/errors.js'

export abstract class AppError extends Error {
  abstract readonly statusCode: number
  abstract readonly code: string
  readonly details?: Record<string, unknown>

  constructor(message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = new.target.name
    if (details !== undefined) this.details = details
  }
}

export class ValidationError extends AppError {
  readonly statusCode = 400
  readonly code = 'validation_error'
}

export class NotFoundError extends AppError {
  readonly statusCode = 404
  readonly code = 'not_found'
}

export class ConflictError extends AppError {
  readonly statusCode = 409
  readonly code = 'conflict'
}

/** The engine could not be reached at all. Never an empty calendar — see the spec. */
export class EngineUnreachableAppError extends AppError {
  readonly statusCode = 503
  readonly code = 'engine_unreachable'
}

/** The engine answered, but with something that is not the owner's doing. */
export class EngineRejectedError extends AppError {
  readonly statusCode = 502
  readonly code = 'engine_rejected_our_key'
}

/** Something the owner can understand and act on, keeping the engine's own code. */
class OwnerFacingEngineError extends AppError {
  readonly statusCode: number
  readonly code: string

  constructor(code: string, statusCode: number, message: string) {
    super(message)
    this.code = code
    this.statusCode = statusCode
  }
}

/**
 * The engine's vocabulary, translated in one place rather than in each route. Doing it per
 * route means a route can forget, and the one that forgets reports an outage as a 500 — which
 * for the calendar is the difference between "we cannot tell you" and "everything is free".
 */
function translateEngineError(error: unknown): AppError | undefined {
  if (error instanceof EngineUnreachableError) {
    return new EngineUnreachableAppError('The booking engine did not answer')
  }
  if (error instanceof EngineError) {
    if (isOwnerFacing(error)) {
      return new OwnerFacingEngineError(error.code, error.status, error.message)
    }
    if (error.status === 401) return new EngineRejectedError('The booking engine refused our key')
    return new EngineRejectedError(`The booking engine answered ${error.status}: ${error.message}`)
  }
  return undefined
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const translated = translateEngineError(error)
    if (translated !== undefined) {
      if (
        translated instanceof EngineRejectedError ||
        translated instanceof EngineUnreachableAppError
      ) {
        // Operational, not the owner's doing: it belongs in the log even though the answer
        // is a clean one.
        request.log.error({ err: error }, 'the booking engine failed us')
      }
      void reply.status(translated.statusCode).send({
        error: translated.code,
        message: translated.message,
      })
      return
    }

    if (error instanceof AppError) {
      void reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      })
      return
    }
    if (error.validation) {
      void reply.status(400).send({
        error: 'validation_error',
        message: error.message,
        details: { issues: error.validation },
      })
      return
    }
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      void reply.status(error.statusCode).send({ error: 'bad_request', message: error.message })
      return
    }
    request.log.error({ err: error }, 'unhandled error')
    void reply.status(500).send({ error: 'internal_error', message: 'Internal server error' })
  })

  app.setNotFoundHandler((_request, reply) => {
    void reply.status(404).send({ error: 'not_found', message: 'Route not found' })
  })
}
