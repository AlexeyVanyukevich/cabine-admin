import { describe, expect, it } from 'vitest'
import { normalisePhone } from '../../src/modules/guests/phone.js'

describe('normalisePhone', () => {
  // The phone is the guest's identity, so two spellings of one number must not become two
  // guests with two separate histories. Punctuation and spacing carry no meaning.
  it.each([
    ['+375 29 123 45 67', '+375291234567'],
    ['+375 (29) 123-45-67', '+375291234567'],
    ['  +375291234567  ', '+375291234567'],
    ['+7 (912) 345-67-89', '+79123456789'],
    ['+7 912 345 67 89', '+79123456789'],
  ])('reduces %s to %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  // Any country, on the same terms as the two nearest ones.
  it.each([
    ['+48 111 222 333', '+48111222333'],
    ['+1 (415) 555-0132', '+14155550132'],
    ['+86 138 1234 5678', '+8613812345678'],
    ['+61 2 9374 4000', '+61293744000'],
  ])('keeps %s as %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  // Two ways of writing the plus rather than two ways of omitting it: the country code is
  // present in both, so neither has to be guessed at.
  it.each([
    ['375291234567', '+375291234567'],
    ['00375291234567', '+375291234567'],
  ])('reads %s as %s', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected)
  })

  // Reserved for fiction, so the library knows the shape and refuses to vouch for the number.
  // A guest whose operator is newer than the library's data would fail the same way, and
  // refusing to save the booking is the worse error, so a well-shaped number is kept.
  it('keeps a well-shaped number the library cannot vouch for', () => {
    expect(normalisePhone('+44 7700 900123')).toBe('+447700900123')
  })

  // A trunk prefix is not a country code. `8 029 …` and `8 912 …` are written identically and
  // belong to different countries, so the number is refused rather than assigned to whichever
  // one the server happens to sit in.
  it.each(['8 029 123 45 67', '8 912 345 67 89', '29 123 45 67'])(
    'refuses %j, which names no country',
    (raw) => {
      expect(() => normalisePhone(raw)).toThrow(/phone/i)
    },
  )

  it.each(['', 'not a phone', '123', '+', '+375 29 123'])('refuses %j', (raw) => {
    expect(() => normalisePhone(raw)).toThrow(/phone/i)
  })
})
