import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../src/api'
import { captureOrPost } from '../src/offline/capture'
import type { CreatePayload } from '../src/offline/intents'

const PAYLOAD: CreatePayload = {
  house_id: '22222222-2222-4222-8222-222222222222',
  check_in: '2026-10-01',
  check_out: '2026-10-03',
  guest: { name: 'Аня', phone: '+375291234567' },
  price_per_night: 30000,
  addons: [],
  deposit: 0,
}

// Minted where NewBooking.tsx mints its own: once per sheet opening, held by the caller, and
// passed in rather than minted inside captureOrPost — see the comment on captureOrPost itself.
const KEY = '11111111-1111-4111-8111-111111111111'

describe('captureOrPost', () => {
  it('posts when the server can be reached, and queues nothing', async () => {
    const post = vi.fn().mockResolvedValue({ id: 'engine-1' })
    const save = vi.fn()

    expect(await captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })).toBe('sent')
    expect(save).not.toHaveBeenCalled()

    // The key travels with the request so a retry of this very call cannot double-book.
    expect(post.mock.calls[0]?.[1]).toMatchObject({ currency: 'RUB', idempotency_key: KEY })
  })

  it('queues the booking when the request never reached the server', async () => {
    const post = vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи'))
    const save = vi.fn()

    expect(await captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })).toBe('queued')
    expect(save).toHaveBeenCalledOnce()
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      payload: PAYLOAD,
      currency: 'RUB',
      state: 'pending',
    })
  })

  it('queues under the same key it tried to post with', async () => {
    const post = vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи'))
    const save = vi.fn()

    await captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })

    // Otherwise a request that did reach the engine before the connection dropped would be
    // replayed later under a different key, and hold the night twice.
    expect(save.mock.calls[0]?.[0].id).toBe(KEY)
    expect(save.mock.calls[0]?.[0].id).toBe(post.mock.calls[0]?.[1].idempotency_key)
  })

  it('marks a queued intent as attempted, freezing its payload', async () => {
    const post = vi.fn().mockRejectedValue(new ApiError('offline', 0, 'Нет связи'))
    const save = vi.fn()

    await captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })
    expect(save.mock.calls[0]?.[0].attempted).toBe(true)
  })

  it('re-throws anything the server actually answered', async () => {
    const post = vi.fn().mockRejectedValue(new ApiError('slot_unavailable', 409, 'taken'))
    const save = vi.fn()

    // The night is genuinely taken and the owner must see that now, not in a queue.
    await expect(captureOrPost(PAYLOAD, 'RUB', KEY, { post, save })).rejects.toThrow()
    expect(save).not.toHaveBeenCalled()
  })
})
