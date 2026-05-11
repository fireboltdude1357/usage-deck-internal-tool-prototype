import { browser } from "$app/environment"
import { Schema } from "effect"
import { MarketSnapshot } from "$lib/schema/snapshot"
import type {
  Market,
  MarketCard,
  MarketSnapshot as MarketSnapshotT,
} from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import { refresh } from "$lib/refresh.svelte"
import { LATEST_SNAPSHOT_MONTH } from "$lib/snapshot-months"
import type { PageLoad } from "./$types"

// Live PostHog drives the three by-market arrays + market_cards; the snapshot
// supplies the roster side (clinicians_by_market + each card's clinicians /
// pct_clinicians_viewed). The roster snapshot is per-client (latest run_date
// in S3) — see $lib/snapshot-months.ts.

const round1 = (n: number) => Math.round(n * 10) / 10

// Merge RDS-derived clinician counts into live PostHog cards. The pipeline
// emits cards with clinicians: 0 / pct_clinicians_viewed: 0; here we patch
// them with the roster snapshot. pct is recomputed (one decimal) so it stays
// consistent with unique_providers.
const mergeWithRoster = (
  live: MarketSnapshotT,
  snap: MarketSnapshotT,
): MarketSnapshotT => {
  const counts: Partial<Record<Market, number>> = {}
  for (const c of snap.metrics.clinicians_by_market) counts[c.market] = c.value
  const cards: MarketCard[] = live.metrics.market_cards.map((card) => {
    const clinicians = counts[card.market] ?? 0
    const pct =
      clinicians === 0 ? 0 : round1((card.unique_providers / clinicians) * 100)
    return { ...card, clinicians, pct_clinicians_viewed: pct }
  })
  return {
    ...live,
    metrics: {
      provider_views_by_market: live.metrics.provider_views_by_market,
      unit_views_by_market: live.metrics.unit_views_by_market,
      users_by_market: live.metrics.users_by_market,
      clinicians_by_market: snap.metrics.clinicians_by_market,
      market_cards: cards,
      calendar_months: live.metrics.calendar_months,
      recurring_window_months: live.metrics.recurring_window_months,
    },
  }
}

export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser)
    return { snapshot: null, loadError: null, source: null as null | "posthog" | "fixture" }

  const refreshFlag = refresh.nonce > 0 ? "&refresh=1" : ""
  const [liveRes, snapRes] = await Promise.all([
    fetch(
      `/api/posthog/${selection.system}/market?start=${selection.start}&end=${selection.end}${refreshFlag}`,
    ),
    fetch(
      `/api/snapshot/${selection.system}/${LATEST_SNAPSHOT_MONTH[selection.system]}/market_metrics.json`,
    ),
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
