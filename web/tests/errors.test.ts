import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/api'
import { messageFor } from '../src/errors'

const CYRILLIC = /[а-яё]/i

describe('messageFor', () => {
  it('answers in the language of the interface', () => {
    const said = messageFor(new ApiError('invalid_phone', 400, 'Not a phone number: "8029…"'))
    expect(said).toMatch(CYRILLIC)
    expect(said).toContain('код')
  })

  // The point of the mapping: a server message is written for whoever maintains the system,
  // and the owner meets it in the middle of taking a booking.
  it('never shows the message the server sent', () => {
    const codes = [
      'invalid_phone',
      'validation_error',
      'not_found',
      'conflict',
      'engine_unreachable',
      'slot_unavailable',
      'hold_expired',
    ]
    for (const code of codes) {
      const said = messageFor(new ApiError(code, 400, 'body must have required property "x"'))
      expect(said).not.toContain('body must')
      expect(said).toMatch(CYRILLIC)
    }
  })

  it('falls back to what the screen was attempting, for a code it does not know', () => {
    const said = messageFor(new ApiError('something_new', 400, 'Boom'), 'Не удалось сохранить')
    expect(said).toBe('Не удалось сохранить')
  })

  it('handles a failure that is not an answer from the server at all', () => {
    expect(messageFor(new TypeError('boom'), 'Не удалось войти')).toBe('Не удалось войти')
    expect(messageFor(undefined)).toMatch(CYRILLIC)
  })
})
