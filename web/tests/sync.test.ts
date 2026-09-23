import { describe, expect, it, vi } from 'vitest'
import { ApiError, NotSignedIn } from '../src/api'
import { runSync, type SyncDeps } from '../src/offline/sync'
import { newCreateIntent, type CreatePayload, type Intent } from '../src/offline/intents'

const PAYLOAD: CreatePayload = {
  house_id: '22222222-2222-4222-8222-222222222222',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [],
  deposit: 0,
}

function deps(
  intents: Intent[],
  post: SyncDeps['post'],
): SyncDeps & {
  saved: Intent[]
  dropped: string[]
} {
  const saved: Intent[] = []
  const dropped: string[] = []
  return {
    post,
    read: async () => intents,
    save: async (intent) => void saved.push(intent),
    drop: async (id) => void dropped.push(id),
    saved,
    dropped,
  }
}

describe('runSync', () => {
  it('does nothing when the queue is empty', async () => {
    const post = vi.fn()
    expect(await runSync(deps([], post))).toBe('idle')
    expect(post).not.toHaveBeenCalled()
  })

  it('sends a pending intent and drops it once the server has it', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const context = deps([intent], vi.fn().mockResolvedValue({ id: 'engine-1' }))

    expect(await runSync(context)).toBe('synced')
    expect(context.dropped).toEqual([intent.id])
  })

  it('sends the intent id as the idempotency key', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const post = vi.fn().mockResolvedValue({ id: 'engine-1' })
    await runSync(deps([intent], post))

    expect(post.mock.calls[0]?.[1]).toMatchObject({
      idempotency_key: intent.id,
      currency: 'RUB',
      house_id: PAYLOAD.house_id,
    })
  })

  it('processes intents one at a time, in capture order', async () => {
    const first = { ...newCreateIntent(PAYLOAD, 'RUB'), capturedAt: '2026-09-04T09:00:00.000Z' }
    const second = { ...newCreateIntent(PAYLOAD, 'RUB'), capturedAt: '2026-09-04T10:00:00.000Z' }

    const order: string[] = []
    const post = vi
      .fn()
      .mockImplementation(async (_path: string, body: { idempotency_key: string }) => {
        order.push(body.idempotency_key)
        return { id: 'engine-1' }
      })

    // Deliberately handed to sync in the wrong order: two queued creates can overlap each
    // other's nights, so the second must see the first's outcome.
    await runSync(deps([second, first], post))
    expect(order).toEqual([first.id, second.id])
  })

  it('parks a taken night as a conflict for the owner, and stops guessing', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const context = deps(
      [intent],
      vi.fn().mockRejectedValue(new ApiError('slot_unavailable', 409, 'taken')),
    )

    expect(await runSync(context)).toBe('conflicts')
    expect(context.dropped).toEqual([])
    // Two writes for this one: the pre-dispatch freeze, then the refusal. The freeze is
    // `saved[0]`; the outcome that matters here is the last one recorded.
    expect(context.saved.at(-1)).toMatchObject({
      state: 'conflict',
      lastError: { code: 'slot_unavailable' },
    })
  })

  it('leaves an intent pending when the server could not be reached', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const context = deps(
      [intent],
      vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи')),
    )

    expect(await runSync(context)).toBe('offline')
    expect(context.dropped).toEqual([])
    expect(context.saved[0]?.state).toBe('pending')
  })

  it('retries rather than conflicts on the codes the engine calls retryable', async () => {
    for (const [code, status] of [
      ['concurrent_update', 503],
      ['rate_limited', 429],
      ['internal_error', 500],
    ] as const) {
      const intent = newCreateIntent(PAYLOAD, 'RUB')
      const context = deps([intent], vi.fn().mockRejectedValue(new ApiError(code, status, code)))

      expect(await runSync(context)).toBe('offline')
      expect(context.saved[0]?.state).toBe('pending')
    }
  })

  it('pauses the whole queue on a lost session without draining it', async () => {
    const first = { ...newCreateIntent(PAYLOAD, 'RUB'), capturedAt: '2026-09-04T09:00:00.000Z' }
    const second = { ...newCreateIntent(PAYLOAD, 'RUB'), capturedAt: '2026-09-04T10:00:00.000Z' }
    const post = vi.fn().mockRejectedValue(new NotSignedIn('unauthorized', 401, 'Сессия истекла'))
    const context = deps([first, second], post)

    expect(await runSync(context)).toBe('paused')
    // The session is a fixed 30-day TTL, so a long offline stretch expires it. A queue drained
    // by the login screen loses bookings that exist nowhere else.
    expect(context.dropped).toEqual([])
    expect(post).toHaveBeenCalledOnce()
  })

  it('marks an intent attempted before sending, not after', async () => {
    const intent = newCreateIntent(PAYLOAD, 'RUB')
    const context = deps(
      [intent],
      vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи')),
    )

    await runSync(context)
    expect(context.saved[0]?.attempted).toBe(true)
  })

  it('skips intents already parked as conflicts', async () => {
    const parked: Intent = {
      ...newCreateIntent(PAYLOAD, 'RUB'),
      state: 'conflict',
      attempted: true,
    }
    const post = vi.fn()

    // Resending would earn the same refusal. It is the owner's to resolve.
    expect(await runSync(deps([parked], post))).toBe('conflicts')
    expect(post).not.toHaveBeenCalled()
  })
})
