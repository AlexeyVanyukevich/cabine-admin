import { describe, expect, it } from 'vitest'
import { conflictReason } from '../src/offline/conflict'
import { newCreateIntent, type CreatePayload, type Intent } from '../src/offline/intents'

const PAYLOAD: CreatePayload = {
  house_id: '22222222-2222-4222-8222-222222222222',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [],
  deposit: 0,
}

function withError(code: string): Intent {
  return {
    ...newCreateIntent(PAYLOAD, 'RUB'),
    state: 'conflict',
    attempted: true,
    lastError: { code, message: 'whatever the server said' },
  }
}

const CYRILLIC = /[а-яё]/i

describe('conflictReason', () => {
  it('says a taken night was taken, and that nothing was booked', () => {
    const said = conflictReason(withError('slot_unavailable'))
    expect(said).toMatch(CYRILLIC)
    // The owner has to know the booking does not exist, or they will not call the guest back.
    expect(said).toContain('не заведена')
  })

  it('explains a replayed key without using the word idempotency', () => {
    const said = conflictReason(withError('idempotency_key_reused'))
    expect(said).toMatch(CYRILLIC)
    expect(said.toLowerCase()).not.toContain('idempot')
  })

  it('never shows the message the server sent', () => {
    for (const code of ['slot_unavailable', 'outside_schedule', 'invalid_phone', 'something_new']) {
      expect(conflictReason(withError(code))).not.toContain('whatever the server said')
    }
  })

  it('falls back to a usable sentence for a code it does not know', () => {
    expect(conflictReason(withError('something_new'))).toMatch(CYRILLIC)
  })

  it("says a configuration fault is not the owner's, rather than telling them to check data", () => {
    const said = conflictReason(withError('engine_rejected_our_key'))
    expect(said).toMatch(CYRILLIC)
    expect(said).toContain('не заведена')
  })
})
