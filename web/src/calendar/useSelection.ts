import { useReducer } from 'react'
import { addDays } from './nights'

export type SelectionState =
  | { kind: 'idle' }
  | { kind: 'selecting'; houseId: string; anchor: string; checkIn: string; checkOut: string }

export type SelectionAction =
  | { type: 'start'; date: string; houseId?: string; free?: string[] }
  | { type: 'over'; date: string; free: string[] }
  | { type: 'cancel' }

/**
 * A selection is a half-open range of nights: picking the 20th and the 21st means arriving on
 * the 20th and leaving on the 22nd. The departure date is never one of the selected nights,
 * which is why the next guest can arrive that morning.
 */
export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'start': {
      if (action.free !== undefined && !action.free.includes(action.date)) return { kind: 'idle' }
      return {
        kind: 'selecting',
        houseId: action.houseId ?? '',
        anchor: action.date,
        checkIn: action.date,
        checkOut: addDays(action.date, 1),
      }
    }

    case 'over': {
      if (state.kind !== 'selecting') return state

      // Walk out from the anchor and stop at the first night that is not free. Jumping over an
      // occupied night would build a stay the engine is bound to refuse, and the owner would
      // only find out after filling in the whole form.
      const step = action.date >= state.anchor ? 1 : -1
      let last = state.anchor
      for (let date = state.anchor; ; date = addDays(date, step)) {
        if (!action.free.includes(date)) break
        last = date
        if (date === action.date) break
      }

      const [first, final] = last >= state.anchor ? [state.anchor, last] : [last, state.anchor]
      return { ...state, checkIn: first, checkOut: addDays(final, 1) }
    }

    case 'cancel':
      return { kind: 'idle' }
  }
}

export function useSelection() {
  const [selection, dispatch] = useReducer(selectionReducer, { kind: 'idle' } as SelectionState)
  return { selection, dispatch }
}
