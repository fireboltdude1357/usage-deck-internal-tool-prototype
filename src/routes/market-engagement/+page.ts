import { browser } from "$app/environment"
import { Schema } from "effect"
import { MarketSnapshot } from "$lib/schema/snapshot"
import type { MarketSnapshot as MarketSnapshotT } from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import { refresh } from "$lib/refresh.svelte"
import type { PageLoad } from "./$types"

// Roster snapshot is per-calendar-month and only `2026-04` is uploaded today.
// Live PostHog drives the three by-market arrays; the snapshot supplies just
// `clinicians_by_market` (RDS-derived). Future: pick latest month from S3.
const ROSTER_MONTH = "2026-04"

const mergeWithRoster = (
  live: MarketSnapshotT,
  snap: MarketSnapshotT,
): MarketSnapshotT => ({
  ...live,
  metrics: {
    provider_views_by_market: live.metrics.provider_views_by_market,
    unit_views_by_market: live.metrics.unit_views_by_market,
    users_by_market: live.metrics.users_by_market,
    clinicians_by_market: snap.metrics.clinicians_by_market,
  },
})

export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser)
    return { snapshot: null, loadError: null, source: null as null | "posthog" | "fixture" }

  const refreshFlag = refresh.nonce > 0 ? "&refresh=1" : ""
  const [liveRes, snapRes] = await Promise.all([
    fetch(
      `/api/posthog/${selection.system}/market?start=${selection.start}&end=${selection.end}${refreshFlag}`,
    ),
    fetch(`/api/snapshot/${selection.system}/${ROSTER_MONTH}/market_metrics.json`),
  ])

  const snap = snapRes.ok
    ? Schema.decodeUnknownSync(MarketSnapshot)(await snapRes.json())
    : null

  if (liveRes.ok) {
    const live = Schema.decodeUnknownSync(MarketSnapshot)(await liveRes.json())
    return {
      snapshot: snap ? mergeWithRoster(live, snap) : live,
      loadError: null,
      source: "posthog" as const,
    }
  }

  // 503 = POSTHOG_API_KEY unset. Fall back to the snapshot (which has empty
  // PostHog-derived arrays — same posture as before this change).
  if (liveRes.status === 503 && snap) {
    return { snapshot: snap, loadError: null, source: "fixture" as const }
  }

  return {
    snapshot: snap,
    loadError: `Failed to load market metrics (${liveRes.status})`,
    source: null,
  }
}
