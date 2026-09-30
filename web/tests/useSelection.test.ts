import { describe, expect, it } from 'vitest'
import {
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from '../src/calendar/useSelection'

const idle: SelectionState = { kind: 'idle' }
const free = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']
const HOUSE = 'house-a'
const OTHER = 'house-b'

const down = (
  date: string,
  houseId = HOUSE,
  nights = free,
  pointerType = 'touch',
): SelectionAction => ({
  type: 'down',
  date,
  houseId,
  free: nights,
  pointerType,
})
const press = (date: string, houseId = HOUSE, nights = free): SelectionAction =>
  down(date, houseId, nights, 'mouse')
const over = (date: string, houseId = HOUSE, nights = free): SelectionAction => ({
  type: 'over',
  date,
  houseId,
  free: nights,
})
const up: SelectionAction = { type: 'up' }

function run(...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, idle)
}

describe('selectionReducer — a mouse', () => {
  it('turns a drag into a half-open range', () => {
    // Two nights selected means a departure on the 22nd.
    expect(run(press('2026-09-20'), over('2026-09-21'), up)).toMatchObject({
      kind: 'chosen',
      checkIn: '2026-09-20',
      checkOut: '2026-09-22',
    })
  })

  it('works when dragged backwards', () => {
    expect(run(press('2026-09-23'), over('2026-09-21'), up)).toMatchObject({
      kind: 'chosen',
      checkIn: '2026-09-21',
      checkOut: '2026-09-24',
    })
  })

  // An occupied night stops the drag rather than swallowing it: a selection that silently
  // skipped a booked night would submit a stay the engine refuses.
  it('stops at an occupied night instead of jumping over it', () => {
    const nights = ['2026-09-20', '2026-09-21']
    expect(
      run(press('2026-09-20', HOUSE, nights), over('2026-09-23', HOUSE, nights), up),
    ).toMatchObject({ checkIn: '2026-09-20', checkOut: '2026-09-22' })
  })

  it('ignores another house passing under the pointer', () => {
    expect(run(press('2026-09-20'), over('2026-09-22', OTHER), up)).toMatchObject({
      kind: 'chosen',
      houseId: HOUSE,
      checkIn: '2026-09-20',
      checkOut: '2026-09-21',
    })
  })

  // Nothing about a mouse stops it dragging, so a click that never left its night was meant as
  // that night alone. Holding it for a second click would cost the owner a click on every stay.
  it('books one night when a night is clicked without dragging', () => {
    expect(run(press('2026-09-20'), up)).toEqual({
      kind: 'chosen',
      houseId: HOUSE,
      checkIn: '2026-09-20',
      checkOut: '2026-09-21',
    })
  })

  it('closes a range a tap began when the last night is clicked', () => {
    expect(run(down('2026-09-20'), up, press('2026-09-22'), up)).toMatchObject({
      kind: 'chosen',
      checkIn: '2026-09-20',
      checkOut: '2026-09-23',
    })
  })
})

// A finger cannot drag across the grid: the browser keeps the touch on the night it began on,
// and moving it scrolls. So a stay is picked as two taps, first night then last.
describe('selectionReducer — two taps', () => {
  it('holds the first tap as check-in and waits for the last night', () => {
    expect(run(down('2026-09-20'), up)).toEqual({
      kind: 'anchored',
      houseId: HOUSE,
      anchor: '2026-09-20',
      checkIn: '2026-09-20',
      checkOut: '2026-09-21',
    })
  })

  it('closes the range on the second tap', () => {
    expect(run(down('2026-09-20'), up, down('2026-09-22'), up)).toEqual({
      kind: 'chosen',
      houseId: HOUSE,
      checkIn: '2026-09-20',
      checkOut: '2026-09-23',
    })
  })

  it('accepts the last night tapped before the first', () => {
    expect(run(down('2026-09-23'), up, down('2026-09-21'), up)).toMatchObject({
      kind: 'chosen',
      checkIn: '2026-09-21',
      checkOut: '2026-09-24',
    })
  })

  it('books one night when the same night is tapped twice', () => {
    expect(run(down('2026-09-20'), up, down('2026-09-20'), up)).toMatchObject({
      kind: 'chosen',
      checkIn: '2026-09-20',
      checkOut: '2026-09-21',
    })
  })

  // Clamping here would open a form for fewer nights than the owner tapped, and they might not
  // notice. Starting again from the tapped night keeps every range exactly what was pointed at.
  it('starts again from the tapped night when an occupied night lies between', () => {
    const nights = ['2026-09-20', '2026-09-21', '2026-09-23']
    expect(
      run(down('2026-09-20', HOUSE, nights), up, down('2026-09-23', HOUSE, nights), up),
    ).toMatchObject({ kind: 'anchored', checkIn: '2026-09-23', checkOut: '2026-09-24' })
  })

  it('starts again when the second tap is in another house', () => {
    expect(run(down('2026-09-20'), up, down('2026-09-22', OTHER), up)).toMatchObject({
      kind: 'anchored',
      houseId: OTHER,
      checkIn: '2026-09-22',
    })
  })
})

// Scrolling the grid starts with a finger on some night. The browser then cancels the press
// instead of releasing it, and that must not count as a tap — least of all between the two
// taps of a stay, which is exactly when the owner scrolls to find the last night.
describe('selectionReducer — a press that becomes a scroll', () => {
  it('leaves nothing picked when it began from nothing', () => {
    expect(run(down('2026-09-20'), { type: 'abandon' })).toEqual(idle)
  })

  it('keeps the first night when it began between the two taps', () => {
    expect(run(down('2026-09-20'), up, down('2026-09-22'), { type: 'abandon' })).toMatchObject({
      kind: 'anchored',
      checkIn: '2026-09-20',
      checkOut: '2026-09-21',
    })
  })

  it('keeps the first night even when the scroll began in another house', () => {
    expect(
      run(down('2026-09-20'), up, down('2026-09-22', OTHER), { type: 'abandon' }),
    ).toMatchObject({ kind: 'anchored', houseId: HOUSE, checkIn: '2026-09-20' })
  })
})

describe('selectionReducer — edges', () => {
  it('refuses to start on an occupied night', () => {
    expect(run(down('2026-09-25')).kind).toBe('idle')
  })

  it('ignores a release with no press behind it', () => {
    const anchored = run(down('2026-09-20'), up)
    expect(selectionReducer(anchored, up)).toBe(anchored)
  })

  it('forgets the selection when cancelled', () => {
    expect(run(down('2026-09-20'), up, { type: 'cancel' })).toEqual(idle)
  })
})
