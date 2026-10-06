import { describe, expect, it } from 'vitest'
import { bannerFor, type BannerInput, type BannerState } from '../src/offline/banner'

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
