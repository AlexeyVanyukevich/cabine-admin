import { describe, expect, it } from 'vitest'
import type { CalendarView, House } from '../src/api'
import { applyIntents } from '../src/offline/overlay'
import { newCreateIntent, type CreatePayload, type Intent } from '../src/offline/intents'

const HOUSE_ID = '22222222-2222-4222-8222-222222222222'

const HOUSES: House[] = [
  {
    id: HOUSE_ID,
    engine_resource_id: 'res-a',
    name: 'Дом у озера',
    price_per_night: 30000,
    checkout_time: '11:00',
    checkin_time: '14:00',
    addons: [{ id: 'a1', code: 'sauna', label: 'Баня', default_price: 5000 }],
  },
]

const VIEW: CalendarView = {
  houses: [
    {
      id: HOUSE_ID,
      name: 'Дом у озера',
      nights: [
        { date: '2026-10-01', available: true },
        { date: '2026-10-02', available: true },
        { date: '2026-10-03', available: true },
      ],
    },
  ],
  bookings: [],
}

const PAYLOAD: CreatePayload = {
  house_id: HOUSE_ID,
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [{ code: 'sauna' }],
  deposit: 10000,
}

function pending(payload: CreatePayload = PAYLOAD): Intent {
  return newCreateIntent(payload, 'RUB')
}

describe('applyIntents', () => {
  it('returns the view untouched when nothing is queued', () => {
    const before = structuredClone(VIEW)
    const result = applyIntents(VIEW, [], HOUSES)

    expect(result).toEqual(before)
    expect(VIEW).toEqual(before) // the input itself was not mutated
    expect(result.houses).not.toBe(VIEW.houses)
    expect(result.bookings).not.toBe(VIEW.bookings)
  })

  it('shows a queued booking on the calendar', () => {
    const intent = pending()
    const { bookings } = applyIntents(VIEW, [intent], HOUSES)

    expect(bookings).toHaveLength(1)
    expect(bookings[0]?.guest?.name).toBe('Аня')
    expect(bookings[0]?.check_in).toBe('2026-10-01')
    expect(bookings[0]?.check_out).toBe('2026-10-03')
  })

  it('marks it as pending, so no screen can mistake it for engine truth', () => {
    const intent = pending()
    const { bookings } = applyIntents(VIEW, [intent], HOUSES)

    expect(bookings[0]?.pending).toEqual({ intentId: intent.id, state: 'pending' })
  })

  it('takes the nights it covers, and only those', () => {
    // Two nights: the 1st and the 2nd. The 3rd is the checkout day and stays free.
    const { houses } = applyIntents(VIEW, [pending()], HOUSES)

    expect(houses[0]?.nights).toEqual([
      { date: '2026-10-01', available: false },
      { date: '2026-10-02', available: false },
      { date: '2026-10-03', available: true },
    ])
  })

  it('totals the stay from the captured price and add-ons', () => {
    // Two nights at 300.00 plus a 50.00 sauna, less a 100.00 deposit.
    const { bookings } = applyIntents(VIEW, [pending()], HOUSES)

    expect(bookings[0]?.total).toBe(65000)
    expect(bookings[0]?.deposit).toBe(10000)
    expect(bookings[0]?.balance).toBe(55000)
  })

  it('labels add-ons from the house, so the sheet reads the same as it would online', () => {
    const { bookings } = applyIntents(VIEW, [pending()], HOUSES)
    expect(bookings[0]?.addons).toEqual([{ code: 'sauna', label: 'Баня', price: 5000 }])
  })

  it('renders in the currency captured, not the one in force now', () => {
    const intent = { ...pending(), currency: 'BYN' }
    expect(applyIntents(VIEW, [intent], HOUSES).bookings[0]?.currency).toBe('BYN')
  })

  it('leaves a conflicted intent on the calendar rather than hiding it', () => {
    // A hidden booking is a night the owner believes is free.
    const intent: Intent = { ...pending(), state: 'conflict', attempted: true }
    const { bookings, houses } = applyIntents(VIEW, [intent], HOUSES)

    expect(bookings[0]?.pending?.state).toBe('conflict')
    expect(houses[0]?.nights[0]?.available).toBe(false)
  })

  it('keeps engine bookings alongside queued ones', () => {
    const withBooking: CalendarView = {
      ...VIEW,
      bookings: [
        {
          id: 'engine-1',
          house_id: HOUSE_ID,
          house_name: 'Дом у озера',
          check_in: '2026-10-05',
          check_out: '2026-10-06',
          nights: 1,
          status: 'confirmed',
          price_per_night: 30000,
          addons: [],
          currency: 'RUB',
          total: 30000,
          deposit: 0,
          balance: 30000,
          note: null,
          guest: { id: 'g1', name: 'Пётр', phone: '+375291112233', note: null },
          orphan: false,
        },
      ],
    }

    const { bookings } = applyIntents(withBooking, [pending()], HOUSES)
    expect(bookings).toHaveLength(2)
    expect(bookings.filter((booking) => booking.pending === undefined)).toHaveLength(1)
  })

  it('ignores an intent for a house not in this view', () => {
    // A month the owner has paged away from, or a house since deleted.
    const elsewhere = pending({ ...PAYLOAD, house_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
    const before = structuredClone(VIEW)
    const result = applyIntents(VIEW, [elsewhere], HOUSES)

    expect(result).toEqual(before)
    expect(VIEW).toEqual(before) // the input itself was not mutated
    expect(result.houses).not.toBe(VIEW.houses)
    expect(result.bookings).not.toBe(VIEW.bookings)
  })

  it('ignores nights that fall outside the rendered window', () => {
    const later = pending({ ...PAYLOAD, check_in: '2026-11-01', check_out: '2026-11-03' })
    const { houses } = applyIntents(VIEW, [later], HOUSES)

    // The booking is still listed, but no night in this month changes.
    expect(houses[0]?.nights.every((night) => night.available)).toBe(true)
  })
})
