import type {
  Client,
  Market,
  MarketBar,
  MarketCard,
  MarketSnapshot,
  Month,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
} from "$lib/schema/snapshot"
import { BU_CODE_MARKET, ALL_BSMH_MARKETS } from "./bu-mapping.js"

// Calendar span the v1 BSMH window covers (Aug 2025 – Feb 2026) — mirrored
// from src/lib/server/posthog/config.ts. Used to size PostHog-derived fields
// that an RDS-only snapshot leaves zero.
const CALENDAR_MONTHS = 7
const RECURRING_WINDOW_MONTHS = 5

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

// Build empty market cards seeded with the RDS-derived clinician counts. The
// PostHog-derived numerators (unique_providers, unit views, retention) stay at
// zero — these snapshot files are the *roster* side of the merge, not engagement.
const emptyMarketCards = (counts: readonly MarketBar[]): readonly MarketCard[] => {
  const by: Partial<Record<Market, number>> = {}
  for (const c of counts) by[c.market] = c.value
  return ALL_BSMH_MARKETS.map((market): MarketCard => ({
    market,
    unique_providers: 0,
    total_provider_views: 0,
    avg_provider_views_per_month: 0,
    unique_units: 0,
    total_unit_views: 0,
    avg_unit_views_per_month: 0,
    clinicians: by[market] ?? 0,
    pct_clinicians_viewed: 0,
    unique_users: 0,
    recurring_leaders: 0,
    total_users_in_window: 0,
    retention_rate: 0,
  }))
}

export const buildMarketSnapshot = (
  rows: RosterRow[],
  opts: EnvelopeOpts,
): MarketSnapshot => {
  const counts = rosterToMarketCounts(rows)
  return {
    client: opts.client,
    month: opts.month,
    generated_at: opts.generated_at,
    source: "rds",
    metrics: {
      clinicians_by_market: counts,
      provider_views_by_market: [],
      unit_views_by_market: [],
      users_by_market: [],
      market_cards: emptyMarketCards(counts),
      calendar_months: CALENDAR_MONTHS,
      recurring_window_months: RECURRING_WINDOW_MONTHS,
    },
  }
}

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
    kpis: [{ label: "Clinicians monitored", value: rows.length, unit: "count" }],
    provider_views_by_month: [],
    unit_views_by_month: [],
    top_units_viewed: [],
    risk_factor_views: { total: 0, overview: 0, drilldown: 0, other: 0 },
    total_provider_views: 0,
    total_unit_views: 0,
    clinicians_monitored: rows.length,
    calendar_months: CALENDAR_MONTHS,
    recurring_window_months: RECURRING_WINDOW_MONTHS,
    unique_users: 0,
    recurring_leaders: 0,
    total_users_in_window: 0,
    retention_rate: 0,
  },
})
