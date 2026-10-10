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
const abandon: SelectionAction = { type: 'abandon' }
const cancel: SelectionAction = { type: 'cancel' }

const chosen = (checkIn: string, checkOut: string, houseId = HOUSE): SelectionState => ({
  kind: 'chosen',
  houseId,
  checkIn,
  checkOut,
})
/** The first night held, waiting for the last: the range so far is that one night. */
const anchored = (night: string, checkOut: string, houseId = HOUSE): SelectionState => ({
  kind: 'anchored',
  houseId,
  anchor: night,
  checkIn: night,
  checkOut,
})

function run(...actions: SelectionAction[]): SelectionState {
  return actions.reduce(selectionReducer, idle)
}

interface Case {
  name: string
  actions: SelectionAction[]
  expected: SelectionState
}

const MOUSE: Case[] = [
  {
    // Two nights selected means a departure on the 22nd.
    name: 'turns a drag into a half-open range',
    actions: [press('2026-09-20'), over('2026-09-21'), up],
    expected: chosen('2026-09-20', '2026-09-22'),
  },
  {
    name: 'works when dragged backwards',
    actions: [press('2026-09-23'), over('2026-09-21'), up],
    expected: chosen('2026-09-21', '2026-09-24'),
  },
  {
    // An occupied night stops the drag rather than swallowing it: a selection that silently
    // skipped a booked night would submit a stay the engine refuses.
    name: 'stops at an occupied night instead of jumping over it',
    actions: [
      press('2026-09-20', HOUSE, ['2026-09-20', '2026-09-21']),
      over('2026-09-23', HOUSE, ['2026-09-20', '2026-09-21']),
      up,
    ],
    expected: chosen('2026-09-20', '2026-09-22'),
  },
  {
    name: 'ignores another house passing under the pointer',
    actions: [press('2026-09-20'), over('2026-09-22', OTHER), up],
    expected: chosen('2026-09-20', '2026-09-21'),
  },
  {
    // Nothing about a mouse stops it dragging, so a click that never left its night was meant
    // as that night alone. Holding it for a second click would cost the owner a click on every
    // stay.
    name: 'books one night when a night is clicked without dragging',
    actions: [press('2026-09-20'), up],
    expected: chosen('2026-09-20', '2026-09-21'),
  },
  {
    name: 'closes a range a tap began when the last night is clicked',
    actions: [down('2026-09-20'), up, press('2026-09-22'), up],
    expected: chosen('2026-09-20', '2026-09-23'),
  },
]

// A finger cannot drag across the grid: the browser keeps the touch on the night it began on,
// and moving it scrolls. So a stay is picked as two taps, first night then last.
const TWO_TAPS: Case[] = [
  {
    name: 'holds the first tap as check-in and waits for the last night',
    actions: [down('2026-09-20'), up],
    expected: anchored('2026-09-20', '2026-09-21'),
  },
  {
    name: 'closes the range on the second tap',
    actions: [down('2026-09-20'), up, down('2026-09-22'), up],
    expected: chosen('2026-09-20', '2026-09-23'),
  },
  {
    name: 'accepts the last night tapped before the first',
    actions: [down('2026-09-23'), up, down('2026-09-21'), up],
    expected: chosen('2026-09-21', '2026-09-24'),
  },
  {
    name: 'books one night when the same night is tapped twice',
    actions: [down('2026-09-20'), up, down('2026-09-20'), up],
    expected: chosen('2026-09-20', '2026-09-21'),
  },
  {
    // Clamping here would open a form for fewer nights than the owner tapped, and they might
    // not notice. Starting again from the tapped night keeps every range exactly what was
    // pointed at.
    name: 'starts again from the tapped night when an occupied night lies between',
    actions: [
      down('2026-09-20', HOUSE, ['2026-09-20', '2026-09-21', '2026-09-23']),
      up,
      down('2026-09-23', HOUSE, ['2026-09-20', '2026-09-21', '2026-09-23']),
      up,
    ],
    expected: anchored('2026-09-23', '2026-09-24'),
  },
  {
    name: 'starts again when the second tap is in another house',
    actions: [down('2026-09-20'), up, down('2026-09-22', OTHER), up],
    expected: anchored('2026-09-22', '2026-09-23', OTHER),
  },
]

// Scrolling the grid starts with a finger on some night. The browser then cancels the press
// instead of releasing it, and that must not count as a tap — least of all between the two
// taps of a stay, which is exactly when the owner scrolls to find the last night.
const SCROLL: Case[] = [
  {
    name: 'leaves nothing picked when it began from nothing',
    actions: [down('2026-09-20'), abandon],
    expected: idle,
  },
  {
    name: 'keeps the first night when it began between the two taps',
    actions: [down('2026-09-20'), up, down('2026-09-22'), abandon],
    expected: anchored('2026-09-20', '2026-09-21'),
  },
  {
    name: 'keeps the first night even when the scroll began in another house',
    actions: [down('2026-09-20'), up, down('2026-09-22', OTHER), abandon],
    expected: anchored('2026-09-20', '2026-09-21'),
  },
]

const EDGES: Case[] = [
  {
    name: 'refuses to start on an occupied night',
    actions: [down('2026-09-25')],
    expected: idle,
  },
  {
    name: 'forgets the selection when cancelled',
    actions: [down('2026-09-20'), up, cancel],
    expected: idle,
  },
]

const GROUPS: Array<[string, Case[]]> = [
  ['a mouse', MOUSE],
  ['two taps', TWO_TAPS],
  ['a press that becomes a scroll', SCROLL],
  ['edges', EDGES],
]

for (const [group, cases] of GROUPS) {
  describe(`selectionReducer — ${group}`, () => {
    it.each(cases)('$name', ({ actions, expected }) => {
      expect(run(...actions)).toEqual(expected)
    })
  })
}

// Not a row: what is checked is that the state is the same object, which is what lets React
// skip the render, not what the state holds.
describe('selectionReducer — a release with no press behind it', () => {
  it('returns the state it was given', () => {
    const anchoredState = run(down('2026-09-20'), up)
    expect(selectionReducer(anchoredState, up)).toBe(anchoredState)
  })
})
