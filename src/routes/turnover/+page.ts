import { browser } from "$app/environment"
import { Schema } from "effect"
import { TurnoverSnapshot } from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import { LATEST_SNAPSHOT_MONTH } from "$lib/snapshot-months"
import { trimMonthly } from "$lib/turnover"
import type { PageLoad } from "./$types"

// Turnover is snapshot-only — no PostHog path. We always pull the most
// recent producer run (turnover.json contains the full per-month series) and
// trim live to the user's picker range. The producer's projection horizon is
// preserved past the picker `end` so the "projected ★" segment is visible.
export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser) {
    return { snapshot: null, monthly: null, loadError: null }
  }

  const client = selection.system
  const month = LATEST_SNAPSHOT_MONTH[client]
  const res = await fetch(`/api/snapshot/${client}/${month}/turnover.json`)

  if (res.status === 404) {
    return { snapshot: null, monthly: null, loadError: null }
  }
  if (!res.ok) {
    return {
      snapshot: null,
      monthly: null,
      loadError: `Failed to load turnover snapshot (${res.status})`,
    }
  }

  const raw = await res.json()
  const snapshot = Schema.decodeUnknownSync(TurnoverSnapshot)(raw)
  const monthly = trimMonthly(snapshot.metrics.monthly, selection.start, selection.end)

  return { snapshot, monthly, loadError: null }
}
