import { describe, expect, it } from 'vitest'
import {
  attentionLine,
  bannerFor,
  waitingLine,
  type BannerInput,
  type BannerState,
} from '../src/offline/banner'

interface Case extends BannerInput {
  name: string
  expected: BannerState
}

const CASES: Case[] = [
  {
    name: 'nothing queued',
    outcome: 'idle',
    sending: false,
    waiting: 0,
    conflicts: 0,
    expected: 'none',
  },
  {
    name: 'everything sent',
    outcome: 'synced',
    sending: false,
    waiting: 0,
    conflicts: 0,
    expected: 'none',
  },
  {
    name: 'queued after a round that found nothing to send',
    outcome: 'idle',
    sending: false,
    waiting: 1,
    conflicts: 0,
    expected: 'queued',
  },
  {
    name: 'queued after a round that sent everything it had',
    outcome: 'synced',
    sending: false,
    waiting: 2,
    conflicts: 0,
    expected: 'queued',
  },
  {
    name: 'a round in flight',
    outcome: 'idle',
    sending: true,
    waiting: 1,
    conflicts: 0,
    expected: 'sending',
  },
  {
    name: 'a retry in flight after a round that could not reach the server',
    outcome: 'offline',
    sending: true,
    waiting: 1,
    conflicts: 0,
    expected: 'sending',
  },
  {
    name: 'a retry in flight after the session expired',
    outcome: 'paused',
    sending: true,
    waiting: 1,
    conflicts: 0,
    expected: 'sending',
  },
  {
    name: 'a round with nothing queued',
    outcome: 'idle',
    sending: true,
    waiting: 0,
    conflicts: 0,
    expected: 'none',
  },
  {
    name: 'queued with no network',
    outcome: 'offline',
    sending: false,
    waiting: 1,
    conflicts: 0,
    expected: 'waiting',
  },
  {
    name: 'no network, nothing queued',
    outcome: 'offline',
    sending: false,
    waiting: 0,
    conflicts: 0,
    expected: 'offline',
  },
  {
    name: 'session expired',
    outcome: 'paused',
    sending: false,
    waiting: 1,
    conflicts: 0,
    expected: 'paused',
  },
  {
    name: 'a conflict',
    outcome: 'conflicts',
    sending: false,
    waiting: 0,
    conflicts: 1,
    expected: 'conflicts',
  },
  {
    name: 'a conflict, with others in flight',
    outcome: 'conflicts',
    sending: true,
    waiting: 1,
    conflicts: 1,
    expected: 'conflicts',
  },
  {
    name: 'a conflict, with no network',
    outcome: 'offline',
    sending: false,
    waiting: 1,
    conflicts: 1,
    expected: 'conflicts',
  },
]

describe('bannerFor', () => {
  it.each(CASES)('$name → $expected', ({ expected, ...input }) => {
    expect(bannerFor(input)).toBe(expected)
  })
})

/** Russian picks the noun by the last digits: 1 and 21 take one form, 2–4 and 22 another, 5–20,
 *  25 and 111 a third. Only 1 is spelled out, as the banner always has. */
const COUNTS: Array<{ count: number; waiting: string; attention: string }> = [
  { count: 1, waiting: '1 бронь ждёт отправки', attention: 'Одна бронь требует внимания' },
  { count: 2, waiting: '2 брони ждут отправки', attention: '2 брони требуют внимания' },
  { count: 4, waiting: '4 брони ждут отправки', attention: '4 брони требуют внимания' },
  { count: 5, waiting: '5 броней ждут отправки', attention: '5 броней требуют внимания' },
  { count: 11, waiting: '11 броней ждут отправки', attention: '11 броней требуют внимания' },
  { count: 12, waiting: '12 броней ждут отправки', attention: '12 броней требуют внимания' },
  { count: 21, waiting: '21 бронь ждёт отправки', attention: '21 бронь требует внимания' },
  { count: 22, waiting: '22 брони ждут отправки', attention: '22 брони требуют внимания' },
  { count: 25, waiting: '25 броней ждут отправки', attention: '25 броней требуют внимания' },
  { count: 111, waiting: '111 броней ждут отправки', attention: '111 броней требуют внимания' },
]

describe('waitingLine', () => {
  it.each(COUNTS)('$count → $waiting', ({ count, waiting }) => {
    expect(waitingLine(count)).toBe(waiting)
  })
})

describe('attentionLine', () => {
  it.each(COUNTS)('$count → $attention', ({ count, attention }) => {
    expect(attentionLine(count)).toBe(attention)
  })
})
