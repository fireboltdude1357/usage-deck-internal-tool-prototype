import { browser } from "$app/environment"
import { Schema } from "effect"
import { MarketSnapshot, PlatformSnapshot } from "$lib/schema/snapshot"
import type {
  Client,
  PlatformSnapshot as PlatformSnapshotT,
} from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import { refresh } from "$lib/refresh.svelte"
import { LATEST_SNAPSHOT_MONTH } from "$lib/snapshot-months"
import type { PageLoad } from "./$types"

// Prefer live PostHog data; fall back to the snapshot when the PostHog route
// returns 503 (POSTHOG_API_KEY unset, e.g., dev without a key). The fetch
// window comes from the TimeRangePicker (selection.start/end), matching the
// other three page loaders.

// PostHog doesn't know the roster size; merge it from the sibling market
// snapshot (sum of clinicians_by_market). Pipeline emits clinicians_monitored: 0.
const patchClinicians = (
  platform: PlatformSnapshotT,
  roster: number,
): PlatformSnapshotT =>
  roster === 0 || platform.metrics.clinicians_monitored > 0
    ? platform
    : {
        ...platform,
        metrics: { ...platform.metrics, clinicians_monitored: roster },
      }

const fetchRosterTotal = async (
  fetch: typeof globalThis.fetch,
  client: Client,
): Promise<number> => {
  const res = await fetch(
    `/api/snapshot/${client}/${LATEST_SNAPSHOT_MONTH[client]}/market_metrics.json`,
  )
  if (!res.ok) return 0
  const snap = Schema.decodeUnknownSync(MarketSnapshot)(await res.json())
  return snap.metrics.clinicians_by_market.reduce((n, b) => n + b.value, 0)
}

export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser) return { snapshot: null, loadError: null, source: null }

  const refreshFlag = refresh.nonce > 0 ? "&refresh=1" : ""
  const [live, rosterTotal] = await Promise.all([
    fetch(
      `/api/posthog/${selection.system}/metrics?start=${selection.start}&end=${selection.end}${refreshFlag}`,
    ),
    fetchRosterTotal(fetch, selection.system),
  ])
  if (live.ok) {
    const raw = await live.json()
    const platform = Schema.decodeUnknownSync(PlatformSnapshot)(raw)
    return {
      snapshot: patchClinicians(platform, rosterTotal),
      loadError: null,
      source: "posthog" as const,
    }
  }

  // 503 == PostHog not configured; quietly fall back. Anything else is a real failure.
  if (live.status !== 503) {
    return {
      snapshot: null,
      loadError: `Failed to load platform metrics (${live.status})`,
      source: null,
    }
  }

  const fixture = await fetch(
    `/api/snapshot/${selection.system}/${LATEST_SNAPSHOT_MONTH[selection.system]}/metrics.json`,
  )
  if (!fixture.ok) {
    return {
      snapshot: null,
      loadError: `Failed to load platform metrics (${fixture.status})`,
      source: null,
    }
  }
  const raw = await fixture.json()
  return {
    snapshot: Schema.decodeUnknownSync(PlatformSnapshot)(raw),
    loadError: null,
    source: "fixture" as const,
  }
}
