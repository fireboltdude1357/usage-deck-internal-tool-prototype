import type { Client, Market } from "$lib/schema/snapshot"

// Markets each client's dashboard renders, including those with zero events
// in a given window. Aggregators zero-fill against this list. Empty list ⇒
// no market split for the client (Duke, UCSF) — pages hide the market view.
//
// Imported from both browser (selection.svelte.ts, MarketPicker) and server
// (posthog config + aggregator, scripts/snapshot/shape) so it lives in
// $lib root rather than $lib/server.
export const MARKETS_BY_CLIENT: Record<Client, readonly Market[]> = {
  bsmh: ["Hampton Roads", "Lorain", "Lima", "Youngstown", "Kentucky", "Toledo"],
  ssm: [
    "SSM Health St. Louis",
    "SSM Health Wisconsin",
    "SSM Health Oklahoma",
    "SSM Health Mid-Missouri",
    "SSM Health Southern Illinois",
    "SSM Health Corporate",
    "SSM Health Continuum of Care",
  ],
  duke: [],
  ucsf: [],
}

export const hasMarkets = (client: Client): boolean =>
  MARKETS_BY_CLIENT[client].length > 0
