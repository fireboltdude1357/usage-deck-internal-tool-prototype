import type {
  Client,
  MarketBar,
  MarketSnapshot,
  Month,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
} from "$lib/schema/snapshot"
import { BU_CODE_MARKET } from "./bu-mapping.js"

// Row shape from `scripts/snapshot/rds/queries/clinician-roster.sql`.
// CSV columns parsed by build.ts before being handed to these shapers.
export type RosterRow = {
  provider_id: string
  quit_prob: string // numeric in DB, string from CSV — left as-is; not surfaced today
  run_date: string // ISO date
  businessunitname: string // BSMH BU code (e.g., "1412") — see BU_CODE_MARKET
  department: string
  specialty: string
  provider_name: string
}

export type EnvelopeOpts = {
  client: Client
  month: Month
  generated_at: string // ISO8601
}

// Group by businessunitname → market, count rows. Unmapped BU codes are dropped
// (non-BSMH clients produce []).
export const rosterToMarketCounts = (rows: RosterRow[]): MarketBar[] => {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const market = BU_CODE_MARKET[row.businessunitname]
    if (!market) continue
    counts.set(market, (counts.get(market) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([market, value]) => ({ market: market as MarketBar["market"], value }))
    .sort((a, b) => b.value - a.value)
}

const limaCount = (rows: RosterRow[]): number =>
  rows.reduce(
    (n, r) => (BU_CODE_MARKET[r.businessunitname] === "Lima" ? n + 1 : n),
    0,
  )

export const buildMarketSnapshot = (
  rows: RosterRow[],
  opts: EnvelopeOpts,
): MarketSnapshot => ({
  client: opts.client,
  month: opts.month,
  generated_at: opts.generated_at,
  source: "rds",
  metrics: {
    // RDS-derived; the rest stay empty until phase 04 merges live PostHog.
    clinicians_by_market: rosterToMarketCounts(rows),
    provider_views_by_market: [],
    unit_views_by_market: [],
    users_by_market: [],
  },
})

export const buildProvisionedSnapshot = (
  rows: RosterRow[],
  opts: EnvelopeOpts,
): ProvisionedUsersSnapshot => {
  const total = rows.length
  const lima = limaCount(rows)
  return {
    client: opts.client,
    month: opts.month,
    generated_at: opts.generated_at,
    source: "rds",
    metrics: {
      // value/denominator collapse to roster size — phase 04 fills the
      // PostHog-derived numerator (logged-in count) at request time.
      total: { label: "Provisioned clinicians", value: total, unit: "count" },
      lima: { label: "Lima provisioned", value: lima, unit: "count" },
      user_detail: [],
    },
  }
}

export const buildPlatformSnapshot = (
  rows: RosterRow[],
  opts: EnvelopeOpts,
): PlatformSnapshot => ({
  client: opts.client,
  month: opts.month,
  generated_at: opts.generated_at,
  source: "rds",
  metrics: {
    // One RDS-derivable KPI for v1: total monitored clinicians on the roster.
    kpis: [{ label: "Clinicians monitored", value: rows.length, unit: "count" }],
    provider_views_by_month: [],
    unit_views_by_month: [],
    top_units_viewed: [],
  },
})
