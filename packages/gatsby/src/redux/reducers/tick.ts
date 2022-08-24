import { IGatsbyState, ActionsUnion } from "../types"

export const tickReducer = (
  state: IGatsbyState["tick"] = new Map(),
  action: ActionsUnion
): IGatsbyState["tick"] => {
  switch (action.type) {
    case `DELETE_CACHE`:
      return new Map()

    case `SET_CHANGED_NODES`: {
      state.set(`changedNodes`, action.payload)
      return state
    }

    case `SET_CHANGED_PAGES`: {
      state.set(`changedPages`, action.payload)
      return state
    }

    default:
      return state
  }
}
