import { browser } from "$app/environment"
import { Schema, Either } from "effect"
import { Client, Market, Month } from "$lib/schema/snapshot"

export const MarketParam = Schema.Union(Schema.Literal("all"), Market)
export type MarketParam = Schema.Schema.Type<typeof MarketParam>

export const Selection = Schema.Struct({
  system: Client,
  market: MarketParam,
  start: Month,
  end: Month,
})
export type Selection = Schema.Schema.Type<typeof Selection>

export const DEFAULT_SELECTION: Selection = {
  system: "bsmh",
  market: "all",
  start: "2025-08",
  end: "2026-02",
}

const STORAGE_KEY = "internal-tool:selection"
const decode = Schema.decodeUnknownEither(Selection)

const loadInitial = (): Selection => {
  if (!browser) return DEFAULT_SELECTION
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SELECTION
    const result = decode(JSON.parse(raw))
    return Either.isRight(result) ? result.right : DEFAULT_SELECTION
  } catch {
    return DEFAULT_SELECTION
  }
}

let state = $state<Selection>(loadInitial())

const persist = (): void => {
  if (!browser) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore quota/availability errors
  }
}

export const selection = {
  get system() {
    return state.system
  },
  get market() {
    return state.market
  },
  get start() {
    return state.start
  },
  get end() {
    return state.end
  },
  set(next: Partial<Selection>): void {
    state = { ...state, ...next }
    persist()
  },
}
