import { browser } from "$app/environment"
import { Schema, Either } from "effect"
import { Client, Market, Month } from "$lib/schema/snapshot"
import type { Client as ClientT } from "$lib/schema/snapshot"
import { AVAILABLE_MONTHS, defaultRange } from "$lib/snapshot-months"
import { MARKETS_BY_CLIENT } from "$lib/markets"

export const MarketParam = Schema.Union(Schema.Literal("all"), Market)
export type MarketParam = Schema.Schema.Type<typeof MarketParam>

export const Selection = Schema.Struct({
  system: Client,
  market: MarketParam,
  start: Month,
  end: Month,
})
export type Selection = Schema.Schema.Type<typeof Selection>

const bsmhDefault = defaultRange("bsmh")
export const DEFAULT_SELECTION: Selection = {
  system: "bsmh",
  market: "all",
  start: bsmhDefault.start,
  end: bsmhDefault.end,
}

const STORAGE_KEY = "internal-tool:selection"
const decode = Schema.decodeUnknownEither(Selection)

// Older localStorage payloads may carry months/markets no longer valid for
// the chosen client (e.g. user switched from bsmh→duke before this code
// landed, or BSMH's "Hampton Roads" while now on SSM). Clamp to safe values
// rather than rendering broken pickers.
const clamp = (s: Selection): Selection => {
  const months = AVAILABLE_MONTHS[s.system]
  const inRange = months.includes(s.start) && months.includes(s.end)
  const next: Selection = inRange ? s : { ...s, ...defaultRange(s.system) }
  const allowed = MARKETS_BY_CLIENT[next.system]
  const marketOk =
    next.market === "all" || (allowed as readonly string[]).includes(next.market)
  return marketOk ? next : { ...next, market: "all" }
}

const loadInitial = (): Selection => {
  if (!browser) return DEFAULT_SELECTION
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SELECTION
    const result = decode(JSON.parse(raw))
    return Either.isRight(result) ? clamp(result.right) : DEFAULT_SELECTION
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
  // Atomic system switch: reset market to "all" and snap the range to the
  // new client's default. Individual `.set({ system })` calls would leave
  // stale months/markets that fail validation on the next page load.
  setSystem(client: ClientT): void {
    state = { system: client, market: "all", ...defaultRange(client) }
    persist()
  },
}
