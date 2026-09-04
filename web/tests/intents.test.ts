import { describe, expect, it } from 'vitest'
import { editIntent, isEditable, newCreateIntent, type CreatePayload } from '../src/offline/intents'

const PAYLOAD: CreatePayload = {
  house_id: '22222222-2222-4222-8222-222222222222',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [],
  deposit: 0,
}

describe('newCreateIntent', () => {
  it('mints a UUID that will serve as the engine idempotency key', () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    expect(intent.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(newCreateIntent(PAYLOAD, 'RUB').id).not.toBe(intent.id)
  })

  it('captures the currency rather than leaving it to be resolved at sync time', () => {
    // A settings change between capture and sync must not reinterpret a price already quoted
    // to a guest.
    expect(newCreateIntent(PAYLOAD, 'BYN').currency).toBe('BYN')
  })

  it('starts pending, unattempted, and with no booking of its own yet', () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    expect(intent.state).toBe('pending')
    expect(intent.attempted).toBe(false)
    expect(intent.bookingId).toBeNull()
  })
})

describe('editIntent', () => {
  it('keeps the same id, so an edit collapses into one create rather than queueing a second', () => {
    const first = newCreateIntent(PAYLOAD, 'RUB')
    const edited = editIntent(first, { ...PAYLOAD, price_per_night: 45000 })

    expect(edited.id).toBe(first.id)
    expect(edited.payload.price_per_night).toBe(45000)
  })

  it('clears a previous error, because the owner has just changed what is being asked', () => {
    const conflicted = {
      ...newCreateIntent(PAYLOAD, 'RUB'),
      state: 'conflict' as const,
      lastError: { code: 'slot_unavailable', message: 'taken' },
    }
    const edited = editIntent(conflicted, { ...PAYLOAD, check_in: '2026-10-05', check_out: '2026-10-07' })

    expect(edited.state).toBe('pending')
    expect(edited.lastError).toBeUndefined()
  })

  it('refuses to edit an intent that has already been attempted', () => {
    // The engine answers 409 idempotency_key_reused to the same key carrying a different body.
    // Until a replay tells us whether the original landed, the payload has to hold still.
    const attempted = { ...newCreateIntent(PAYLOAD, 'RUB'), attempted: true }
    expect(() => editIntent(attempted, { ...PAYLOAD, deposit: 10000 })).toThrow(/attempted/i)
  })
})

describe('isEditable', () => {
  it('is false exactly when the payload is frozen', () => {
    expect(isEditable(newCreateIntent(PAYLOAD, 'RUB'))).toBe(true)
    expect(isEditable({ ...newCreateIntent(PAYLOAD, 'RUB'), attempted: true })).toBe(false)
  })
})
