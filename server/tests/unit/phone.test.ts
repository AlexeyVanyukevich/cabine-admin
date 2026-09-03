import { describe, expect, it } from 'vitest'
import { normalisePhone } from '../../src/modules/guests/phone.js'

describe('normalisePhone', () => {
  // The phone is the guest's identity, so two spellings of one number must not become two
  // guests with two separate histories. Punctuation and spacing carry no meaning.
  it.each([
    ['+375 29 123 45 67', '+375291234567'],
    ['+375 (29) 123-45-67', '+375291234567'],
    ['  +375291234567  ', '+375291234567'],
  ])('reduces %s to %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  // Written the way the owner dials, with the trunk prefix or with nothing in front at all.
  it.each([
    ['8 029 123 45 67', '+375291234567'],
    ['80291234567', '+375291234567'],
    ['80297654156', '+375297654156'],
    ['29 123 45 67', '+375291234567'],
    ['029 123 45 67', '+375291234567'],
    ['8 017 226 66 66', '+375172266666'],
  ])('reads the domestic %s as %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  // The trunk prefix is shared with the neighbour and only the length of what follows tells
  // the two apart, so a number the home country cannot account for is tried there next.
  it.each([
    ['+7 (912) 345-67-89', '+79123456789'],
    ['+7 912 345 67 89', '+79123456789'],
    ['8 912 345 67 89', '+79123456789'],
    ['89123456789', '+79123456789'],
  ])('reads %s as the neighbour, %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  // Where both readings are whole numbers, the home one is taken. Service ranges are the only
  // place this bites, and a guest is never reached on one.
  it('resolves a number both countries could claim in favour of the home one', () => {
    expect(normalisePhone('8 800 555 35 35')).toBe('+3758005553535')
  })

  it.each([
    ['+48 111 222 333', '+48111222333'],
    ['+1 (415) 555-0132', '+14155550132'],
    ['+86 138 1234 5678', '+8613812345678'],
    ['+61 2 9374 4000', '+61293744000'],
    // Two ways of writing the plus: the country code is spelled out in both.
    ['375291234567', '+375291234567'],
    ['00375291234567', '+375291234567'],
    // No plus and no domestic reading that works: the leading digits are a country code.
    ['86 138 1234 5678', '+8613812345678'],
  ])('keeps %s as %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  // Reserved for fiction, so the library knows the shape and refuses to vouch for the number.
  // A guest whose operator is newer than the library's data would fail the same way, and
  // refusing to save the booking is the worse error, so a well-shaped number is kept.
  it('keeps a well-shaped number the library cannot vouch for', () => {
    expect(normalisePhone('+44 7700 900123')).toBe('+447700900123')
  })

  it.each(['', 'not a phone', '123', '+', '8', '+375 29 123'])('refuses %j', (raw) => {
    expect(() => normalisePhone(raw)).toThrow(/phone/i)
  })
})
