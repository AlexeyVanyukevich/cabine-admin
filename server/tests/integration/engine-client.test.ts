import { beforeAll, describe, expect, it, inject } from 'vitest'
import { createEngineClient, type EngineClient } from '../../src/engine/client.js'
import { EngineError, EngineUnreachableError } from '../../src/engine/errors.js'

let engine: EngineClient
let houseA: string

beforeAll(() => {
  engine = createEngineClient({
    engineUrl: inject('engineUrl'),
    engineApiKey: inject('engineApiKey'),
  })
  houseA = inject('houseA')
})

const key = () => `test-${Math.random().toString(36).slice(2)}`

describe('availability', () => {
  it('reports nights, in the house’s own dates', async () => {
    const slots = await engine.availability(houseA, '2026-09-01', '2026-09-05')
    expect(slots.map((slot) => slot.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
    ])
    for (const slot of slots) expect(slot.available).toBe(true)
  })
})

describe('createBooking', () => {
  it('creates a confirmed booking and returns house-local dates', async () => {
    const booking = await engine.createBooking(houseA, '2026-10-01', '2026-10-03', key())
    expect(booking.checkIn).toBe('2026-10-01')
    expect(booking.checkOut).toBe('2026-10-03')
    expect(booking.status).toBe('confirmed')
    expect(booking.resourceId).toBe(houseA)
  })

  it('marks the nights unavailable afterwards', async () => {
    await engine.createBooking(houseA, '2026-10-10', '2026-10-12', key())
    const slots = await engine.availability(houseA, '2026-10-09', '2026-10-13')
    const byDate = Object.fromEntries(slots.map((slot) => [slot.date, slot.available]))
    expect(byDate['2026-10-10']).toBe(false)
    expect(byDate['2026-10-11']).toBe(false)
    // The departure date is free again — the property the calendar depends on.
    expect(byDate['2026-10-12']).toBe(true)
  })

  it('lets a new stay start on the previous one’s departure date', async () => {
    await engine.createBooking(houseA, '2026-11-01', '2026-11-03', key())
    const next = await engine.createBooking(houseA, '2026-11-03', '2026-11-05', key())
    expect(next.status).toBe('confirmed')
  })

  it('raises slot_unavailable on an overlap', async () => {
    await engine.createBooking(houseA, '2026-12-01', '2026-12-03', key())
    await expect(
      engine.createBooking(houseA, '2026-12-02', '2026-12-04', key()),
    ).rejects.toMatchObject({ code: 'slot_unavailable' })
  })

  // The reason the facade mints a key per attempt: a retried request must not book twice.
  it('replays an identical request under the same key instead of booking twice', async () => {
    const shared = key()
    const first = await engine.createBooking(houseA, '2027-01-05', '2027-01-07', shared)
    const second = await engine.createBooking(houseA, '2027-01-05', '2027-01-07', shared)
    expect(second.id).toBe(first.id)
  })
})

describe('reschedule and cancel', () => {
  it('moves a booking and frees the old nights', async () => {
    const booking = await engine.createBooking(houseA, '2027-02-01', '2027-02-03', key())
    const moved = await engine.reschedule(booking.id, '2027-02-05', '2027-02-08')

    expect(moved.id).toBe(booking.id)
    expect(moved.checkIn).toBe('2027-02-05')
    const slots = await engine.availability(houseA, '2027-02-01', '2027-02-03')
    expect(slots.every((slot) => slot.available)).toBe(true)
  })

  it('cancels and frees the nights', async () => {
    const booking = await engine.createBooking(houseA, '2027-03-01', '2027-03-03', key())
    expect((await engine.cancel(booking.id)).status).toBe('cancelled')
    const slots = await engine.availability(houseA, '2027-03-01', '2027-03-03')
    expect(slots.every((slot) => slot.available)).toBe(true)
  })
})

describe('listBookings and getBooking', () => {
  it('lists both houses in one call', async () => {
    await engine.createBooking(houseA, '2027-04-01', '2027-04-03', key())
    await engine.createBooking(inject('houseB'), '2027-04-01', '2027-04-03', key())

    const bookings = await engine.listBookings('2027-04-01', '2027-04-05')
    expect(new Set(bookings.map((booking) => booking.resourceId)).size).toBe(2)
  })

  it('answers undefined for a booking that is not there', async () => {
    expect(await engine.getBooking('00000000-0000-4000-8000-000000000000')).toBeUndefined()
  })
})

describe('failure modes', () => {
  it('raises unauthorized for a wrong key, without retrying', async () => {
    const wrong = createEngineClient({
      engineUrl: inject('engineUrl'),
      engineApiKey: `bk_live_${'A'.repeat(51)}`,
    })
    await expect(wrong.availability(houseA, '2026-09-01', '2026-09-02')).rejects.toBeInstanceOf(
      EngineError,
    )
  })

  it('raises EngineUnreachableError when nothing answers', async () => {
    // Port 1 is reserved and refuses immediately, so this does not wait out the timeout.
    const dead = createEngineClient({
      engineUrl: 'http://127.0.0.1:1',
      engineApiKey: `bk_live_${'A'.repeat(51)}`,
    })
    await expect(dead.availability(houseA, '2026-09-01', '2026-09-02')).rejects.toBeInstanceOf(
      EngineUnreachableError,
    )
  })
})
