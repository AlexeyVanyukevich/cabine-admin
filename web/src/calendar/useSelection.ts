import { useReducer } from 'react'
import { addDays } from './nights'

interface Range {
  houseId: string
  checkIn: string
  checkOut: string
}

/** The first night is picked and the grid is waiting for the last one. */
interface Anchored extends Range {
  kind: 'anchored'
  anchor: string
}

export type SelectionState =
  | { kind: 'idle' }
  /**
   * A pointer is down on a night. `completes` says whether releasing it finishes the stay —
   * true for a mouse, once a press has dragged off its first night, and for the second tap —
   * and `resume` is what a press that turns into a scroll falls back to.
   */
  | (Range & { kind: 'pressing'; anchor: string; completes: boolean; resume?: Anchored })
  | Anchored
  /** Final: the form for these nights is open. */
  | (Range & { kind: 'chosen' })

export type SelectionAction =
  /** `pointerType` is the press's own, as the browser names it. */
  | { type: 'down'; date: string; houseId: string; free: string[]; pointerType: string }
  | { type: 'over'; date: string; houseId: string; free: string[] }
  | { type: 'up' }
  /** The browser took the press over for a scroll: it was never a tap. */
  | { type: 'abandon' }
  | { type: 'cancel' }

/**
 * The last night reachable walking from `anchor` towards `date` through free nights only.
 * Jumping over an occupied night would build a stay the engine is bound to refuse, and the owner
 * would only find out after filling in the whole form.
 */
function reach(anchor: string, date: string, free: string[]): string {
  const step = date >= anchor ? 1 : -1
  let last = anchor
  for (let night = anchor; ; night = addDays(night, step)) {
    if (!free.includes(night)) break
    last = night
    if (night === date) break
  }
  return last
}

/** A half-open range of nights: the departure date is never one of them. */
function span(a: string, b: string): { checkIn: string; checkOut: string } {
  const [first, last] = a <= b ? [a, b] : [b, a]
  return { checkIn: first, checkOut: addDays(last, 1) }
}

/**
 * A selection is a half-open range of nights: picking the 20th and the 21st means arriving on
 * the 20th and leaving on the 22nd, which is why the next guest can arrive that morning.
 *
 * Two gestures reach the same range. A mouse drags from the first night to the last, and a click
 * that never leaves its night is that night alone. A finger cannot drag — the browser keeps a touch
 * on the night it began on, and moving it scrolls — so it taps the first night, then the last.
 * Tapping the same night twice is a one-night stay.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'down': {
      if (!action.free.includes(action.date)) return state
      const resume = state.kind === 'anchored' ? state : undefined

      if (
        resume !== undefined &&
        resume.houseId === action.houseId &&
        reach(resume.anchor, action.date, action.free) === action.date
      ) {
        return {
          kind: 'pressing',
          houseId: action.houseId,
          anchor: resume.anchor,
          ...span(resume.anchor, action.date),
          completes: true,
          resume,
        }
      }

      // Anything else starts again from the night pressed. An unreachable second tap is not
      // clamped: the form would then quietly cover fewer nights than the owner pointed at.
      return {
        kind: 'pressing',
        houseId: action.houseId,
        anchor: action.date,
        ...span(action.date, action.date),
        completes: action.pointerType === 'mouse',
        ...(resume === undefined ? {} : { resume }),
      }
    }

    case 'over': {
      if (state.kind !== 'pressing' || state.houseId !== action.houseId) return state
      const last = reach(state.anchor, action.date, action.free)
      return {
        ...state,
        ...span(state.anchor, last),
        completes: state.completes || action.date !== state.anchor,
      }
    }

    case 'up': {
      if (state.kind !== 'pressing') return state
      const { houseId, anchor, checkIn, checkOut } = state
      return state.completes
        ? { kind: 'chosen', houseId, checkIn, checkOut }
        : { kind: 'anchored', houseId, anchor, checkIn, checkOut }
    }

    case 'abandon':
      if (state.kind !== 'pressing') return state
      return state.resume ?? { kind: 'idle' }

    case 'cancel':
      return { kind: 'idle' }
  }
}

export function useSelection() {
  const [selection, dispatch] = useReducer(selectionReducer, { kind: 'idle' } as SelectionState)
  return { selection, dispatch }
}
