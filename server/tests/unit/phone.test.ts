import { describe, expect, it } from 'vitest'
import { normalisePhone } from '../../src/modules/guests/phone.js'

describe('normalisePhone', () => {
  // The phone is the guest's identity, so two spellings of one number must not become two
  // guests with two separate histories.
  it.each([
    ['+375 29 123 45 67', '+375291234567'],
    ['8 029 123 45 67', '+375291234567'],
    ['80291234567', '+375291234567'],
    // Written the short way, without the trunk prefix at all.
    ['29 123 45 67', '+375291234567'],
    ['029 123 45 67', '+375291234567'],
    ['+375 (29) 123-45-67', '+375291234567'],
    ['8 017 226 66 66', '+375172266666'],
    // The international dial-out prefix stands in for the plus.
    ['00375291234567', '+375291234567'],
  ])('reduces %s to %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  // The trunk `8` is shared, and only the length of what follows separates the two, so both
  // readings are tried before the number is refused.
  it.each([
    ['+7 (912) 345-67-89', '+79123456789'],
    ['+7 912 345 67 89', '+79123456789'],
    ['8 912 345 67 89', '+79123456789'],
    ['89123456789', '+79123456789'],
    ['+79123456789', '+79123456789'],
  ])('reduces %s to %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  it.each([
    ['+48 111 222 333', '+48111222333'],
    ['+1 (415) 555-0132', '+14155550132'],
    ['+86 138 1234 5678', '+8613812345678'],
    // No plus and no local reading that works: the digits are taken as a country code.
    ['86 138 1234 5678', '+8613812345678'],
  ])('keeps %s as %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  // Reserved for fiction, so the library knows the shape and refuses the number. A guest whose
  // operator is newer than the library's data would fail the same way, and refusing to save the
  // booking is the worse error, so a well-shaped number is kept even when it is not known-good.
  it('keeps a well-shaped number the library cannot vouch for', () => {
    expect(normalisePhone('+44 7700 900123')).toBe('+447700900123')
  })

  it.each(['', 'not a phone', '123', '+', '8', '+375 29 123'])('refuses %j', (raw) => {
    expect(() => normalisePhone(raw)).toThrow(/phone/i)
  })
})
