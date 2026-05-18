import { browser } from "$app/environment"
import { Schema } from "effect"
import { SuccessStoriesSnapshot } from "$lib/schema/snapshot"
import type { Month } from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import { refresh } from "$lib/refresh.svelte"
import { LATEST_SNAPSHOT_MONTH } from "$lib/snapshot-months"
import {
  deriveProviders,
  splitWindow,
  type ProviderDerived,
} from "$lib/success-stories"
import type { PageLoad } from "./$types"

// The success-stories page is a hybrid:
//   - snapshot of raw per-provider per-month metrics (RDS + Athena pre-compute)
//   - live PostHog cohort of providers viewed in the selected range
//
// Pre/post derivation happens here, against the user-selected `[start, end]`
// from the TimeRangePicker — the range is split in half (floor pre, ceil post)
// and each provider's improvement scorecard is recomputed on the fly.

export type FunnelCounts = {
  cohort: number
  analyzed: number
  improved_three_plus: number
  by_improvement_count: Record<"five" | "four" | "three" | "two" | "one" | "zero", number>
}

export type CategoryCounts = {
  turnover: number
  volume: number
  time_with_patients: number
  efficiency: number
  rvu: number
}

type DerivedShape = {
  pre_months: readonly Month[]
  post_months: readonly Month[]
  min_pre_procedures: number
  providers: readonly ProviderDerived[]
  funnel: FunnelCounts
  categories: CategoryCounts
  cohortApplied: boolean
}

const tallyImprovements = (
  providers: readonly ProviderDerived[],
): FunnelCounts["by_improvement_count"] => {
  const out = { five: 0, four: 0, three: 0, two: 0, one: 0, zero: 0 }
  for (const p of providers) {
    if (p.n_improvements === 5) out.five++
    else if (p.n_improvements === 4) out.four++
    else if (p.n_improvements === 3) out.three++
    else if (p.n_improvements === 2) out.two++
    else if (p.n_improvements === 1) out.one++
    else out.zero++
  }
  return out
}

const tallyCategories = (
  providers: readonly ProviderDerived[],
): CategoryCounts => ({
  turnover: providers.filter((p) => p.turnover.improved).length,
  volume: providers.filter((p) => p.volume_improved).length,
  time_with_patients: providers.filter((p) => p.enc_duration.improved).length,
  efficiency: providers.filter((p) => p.efficiency_improved).length,
  rvu: providers.filter((p) => p.rvu.improved).length,
})

export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser) {
    return {
      derived: null,
      snapshotError: null,
      cohortError: null,
      rangeTooSmall: false,
    }
  }

  const client = selection.system
  const start = selection.start
  const end = selection.end
  const market = selection.market === "all" ? null : selection.market
  const snapshotMonth = LATEST_SNAPSHOT_MONTH[client]
  const refreshFlag = refresh.nonce > 0 ? "&refresh=1" : ""

  const [snapshotRes, cohortRes] = await Promise.all([
    fetch(`/api/snapshot/${client}/${snapshotMonth}/success_stories.json`),
    fetch(
      `/api/posthog/${client}/success-stories-cohort?start=${start}&end=${end}${refreshFlag}`,
    ),
  ])

  if (snapshotRes.status === 404) {
    return {
      derived: null,
      snapshotError: null,
      cohortError: null,
      rangeTooSmall: false,
    }
  }
  if (!snapshotRes.ok) {
    return {
      derived: null,
      snapshotError: `Failed to load success stories (${snapshotRes.status})`,
      cohortError: null,
      rangeTooSmall: false,
    }
  }

  const rawSnapshot = await snapshotRes.json()
  const snapshot = Schema.decodeUnknownSync(SuccessStoriesSnapshot)(rawSnapshot)

  const { pre, post } = splitWindow(start, end, snapshot.metrics.available_months)
  if (pre.length === 0 || post.length === 0) {
    return {
      derived: null,
      snapshotError: null,
      cohortError: null,
      rangeTooSmall: true,
    }
  }

  let cohort: ReadonlySet<string> | null = null
  let cohortError: string | null = null
  if (cohortRes.ok) {
    const raw = (await cohortRes.json()) as { provider_ids?: readonly string[] }
    cohort = new Set(raw.provider_ids ?? [])
  } else {
    cohortError = `cohort unavailable (${cohortRes.status}) — showing un-filtered analysis`
  }

  // Apply market filter at derive time; cohort intersection (when available)
  // happens after derivation since the cohort id-set is independent.
  const analyzed = deriveProviders(snapshot.metrics.providers, pre, post, {
    minPreProcedures: snapshot.metrics.min_pre_procedures,
    marketFilter: market,
  })
  const filtered = cohort === null ? analyzed : analyzed.filter((p) => cohort!.has(p.provider_id))

  const derived: DerivedShape = {
    pre_months: pre,
    post_months: post,
    min_pre_procedures: snapshot.metrics.min_pre_procedures,
    providers: filtered,
    funnel: {
      cohort: cohort?.size ?? 0,
      analyzed: filtered.length,
      improved_three_plus: filtered.filter((p) => p.n_improvements >= 3).length,
      by_improvement_count: tallyImprovements(filtered),
    },
    categories: tallyCategories(filtered),
    cohortApplied: cohort !== null,
  }

  return {
    derived,
    snapshotError: null,
    cohortError,
    rangeTooSmall: false,
  }
}
