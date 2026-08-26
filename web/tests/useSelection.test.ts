import { describe, expect, it } from 'vitest'
import { selectionReducer, type SelectionState } from '../src/calendar/useSelection'

const idle: SelectionState = { kind: 'idle' }
const free = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']

describe('selectionReducer', () => {
  it('turns a drag into a half-open range', () => {
    let state = selectionReducer(idle, { type: 'start', date: '2026-09-20' })
    state = selectionReducer(state, { type: 'over', date: '2026-09-21', free })

    // Two nights selected means a departure on the 22nd.
    expect(state).toMatchObject({ checkIn: '2026-09-20', checkOut: '2026-09-22' })
  })

  it('works when dragged backwards', () => {
    let state = selectionReducer(idle, { type: 'start', date: '2026-09-23' })
    state = selectionReducer(state, { type: 'over', date: '2026-09-21', free })
    expect(state).toMatchObject({ checkIn: '2026-09-21', checkOut: '2026-09-24' })
  })

  // An occupied night stops the drag rather than swallowing it: a selection that silently
  // skipped a booked night would submit a stay the engine refuses.
  it('stops at an occupied night instead of jumping over it', () => {
    let state = selectionReducer(idle, { type: 'start', date: '2026-09-20' })
    state = selectionReducer(state, {
      type: 'over',
      date: '2026-09-23',
      free: ['2026-09-20', '2026-09-21'],
    })
    expect(state).toMatchObject({ checkIn: '2026-09-20', checkOut: '2026-09-22' })
  })

  it('refuses to start on an occupied night', () => {
    const state = selectionReducer(idle, { type: 'start', date: '2026-09-25', free })
    expect(state.kind).toBe('idle')
  })

  it('selects a single night as one night, not none', () => {
    const state = selectionReducer(idle, { type: 'start', date: '2026-09-20', free })
    expect(state).toMatchObject({ checkIn: '2026-09-20', checkOut: '2026-09-21' })
  })

  it('forgets the selection when cancelled', () => {
    let state = selectionReducer(idle, { type: 'start', date: '2026-09-20', free })
    state = selectionReducer(state, { type: 'cancel' })
    expect(state.kind).toBe('idle')
  })
})
