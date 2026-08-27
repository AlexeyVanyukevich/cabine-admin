import { describe, expect, it } from 'vitest'
import { addDays, eachNight, localDate, nightsBetween } from '../../src/shared/nights.js'

describe('localDate', () => {
  // The engine renders timestamps in the house's zone. Taking the date from that string is
  // what keeps an owner in another timezone from seeing every booking shifted by a day.
  it('takes the date from the offset the engine sent, not from this machine', () => {
    expect(localDate('2026-09-01T15:00:00+02:00')).toBe('2026-09-01')
    expect(localDate('2026-01-01T00:00:00+13:00')).toBe('2026-01-01')
  })

  it.each(['', 'nonsense', '2026-9-1T15:00:00+02:00', '2026-09-01'])(
    'refuses %j rather than guessing',
    (value) => {
      expect(() => localDate(value)).toThrow(/timestamp/)
    },
  )
})

describe('nightsBetween', () => {
  it.each([
    ['2026-09-01', '2026-09-02', 1],
    ['2026-09-20', '2026-09-22', 2],
    ['2026-09-01', '2026-10-01', 30],
    // A month boundary and a leap day, where naive arithmetic goes wrong.
    ['2028-02-28', '2028-03-01', 2],
  ])('counts %s to %s as %i nights', (from, to, expected) => {
    expect(nightsBetween(from, to)).toBe(expected)
  })

  // Across a daylight-saving change these are plain dates, so no hour is lost or gained.
  it('is unaffected by a daylight-saving transition', () => {
    expect(nightsBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(nightsBetween('2026-10-24', '2026-10-26')).toBe(2)
  })

  it.each([
    ['2026-09-02', '2026-09-01'],
    ['2026-09-01', '2026-09-01'],
  ])('refuses %s to %s', (from, to) => {
    expect(() => nightsBetween(from, to)).toThrow(/at least one night/)
  })
})

describe('eachNight', () => {
  it('lists the nights, excluding the departure date', () => {
    expect(eachNight('2026-09-20', '2026-09-22')).toEqual(['2026-09-20', '2026-09-21'])
  })

  // The property the whole calendar rests on: the departure date is free for a new arrival.
  it('lets two stays meet on one date without sharing a night', () => {
    const first = eachNight('2026-09-20', '2026-09-22')
    const second = eachNight('2026-09-22', '2026-09-24')
    expect(first.filter((night) => second.includes(night))).toEqual([])
  })
})

describe('addDays', () => {
  it.each([
    ['2026-09-30', 1, '2026-10-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2026-09-02', -1, '2026-09-01'],
  ])('%s plus %i is %s', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected)
  })
})
