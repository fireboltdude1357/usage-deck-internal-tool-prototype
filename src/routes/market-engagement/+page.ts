import { browser } from "$app/environment"
import { Schema } from "effect"
import { MarketSnapshot } from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import type { PageLoad } from "./$types"

export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser) return { snapshot: null, loadError: null }
  const res = await fetch(
    `/api/snapshot/${selection.system}/2026-04/market_metrics.json`,
  )
  if (!res.ok) {
    return {
      snapshot: null,
      loadError: `Failed to load market metrics (${res.status})`,
    }
  }
  const raw = await res.json()
  return {
    snapshot: Schema.decodeUnknownSync(MarketSnapshot)(raw),
    loadError: null,
  }
}
