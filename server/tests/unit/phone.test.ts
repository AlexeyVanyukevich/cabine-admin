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
