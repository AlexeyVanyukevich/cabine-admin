import { describe, expect, it } from 'vitest'
import { normalisePhone } from '../../src/modules/guests/phone.js'

describe('normalisePhone', () => {
  // The phone is the guest's identity, so two spellings of one number must not become two
  // guests with two separate histories.
  it.each([
    ['+7 (912) 345-67-89', '+79123456789'],
    ['+7 912 345 67 89', '+79123456789'],
    ['8 912 345 67 89', '+79123456789'],
    ['89123456789', '+79123456789'],
    ['+79123456789', '+79123456789'],
    // A trunk `8` followed by `0` belongs to the other code, not to +7. `8 800 …` is not a
    // counter-example: its digits read `88…`, so it stays where it was.
    ['+375 29 123 45 67', '+375291234567'],
    ['8 029 123 45 67', '+375291234567'],
    ['80291234567', '+375291234567'],
    ['8 017 226 66 66', '+375172266666'],
    ['8 800 555 35 35', '+78005553535'],
  ])('reduces %s to %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  it('keeps other country codes as given', () => {
    expect(normalisePhone('+48 111 222 333')).toBe('+48111222333')
  })

  it.each(['', 'not a phone', '123', '+'])('refuses %j', (raw) => {
    expect(() => normalisePhone(raw)).toThrow(/phone/i)
  })
})
