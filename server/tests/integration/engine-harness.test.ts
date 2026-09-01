import { describe, expect, it, inject } from 'vitest'

describe('the engine harness', () => {
  it('publishes a url and a usable key', () => {
    expect(inject('engineUrl')).toMatch(/^http:\/\//)
    expect(inject('engineApiKey')).toMatch(/^bk_live_[A-Za-z0-9]{51}$/)
  })

  it('answers health', async () => {
    const response = await fetch(`${inject('engineUrl')}/health`)
    expect(response.status).toBe(200)
  })

  it('refuses an anonymous call, so the key is doing something', async () => {
    const response = await fetch(`${inject('engineUrl')}/resources`)
    expect(response.status).toBe(401)
  })

  // The two check-in times differ on purpose: a hardcoded anchor anywhere in the client would
  // pass against a pair that shared one, and the calendar would then be wrong for one house.
  it('has two day-based houses whose check-in times differ', async () => {
    const response = await fetch(`${inject('engineUrl')}/resources`, {
      headers: { authorization: `Bearer ${inject('engineApiKey')}` },
    })
    const resources = (await response.json()) as Array<{
      id: string
      slot_duration: string
      slot_anchor_time: string
    }>

    expect(resources).toHaveLength(2)
    for (const resource of resources) expect(resource.slot_duration).toBe('P1D')

    const anchors = resources.map((resource) => resource.slot_anchor_time).sort()
    expect(anchors).toEqual(['14:00', '15:00'])
  })
})
