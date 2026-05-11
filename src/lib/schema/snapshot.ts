import { Schema } from "effect"

export const Client = Schema.Literal("bsmh", "ssm", "duke", "ucsf")
export type Client = Schema.Schema.Type<typeof Client>

// BSMH markets per market-engagement-metrics.md § "BU Code to Market Mapping".
// "all" is the page-level "no market filter" sentinel (URL value), not a snapshot value.
export const Market = Schema.Literal(
  "Hampton Roads",
  "Lorain",
  "Lima",
  "Youngstown",
  "Kentucky",
  "Toledo",
)
export type Market = Schema.Schema.Type<typeof Market>

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
export const Month = Schema.String.pipe(
  Schema.filter((s) => (MONTH_PATTERN.test(s) ? undefined : "expected YYYY-MM")),
)
export type Month = Schema.Schema.Type<typeof Month>

// Common envelope every snapshot file shares.
const envelope = <A, I>(metrics: Schema.Schema<A, I>) =>
  Schema.Struct({
    client: Client,
    month: Month,
    generated_at: Schema.String, // ISO8601
    source: Schema.Literal("athena", "rds", "posthog"),
    metrics,
  })

// --- Building blocks reused across the inner shapes ---

export const Kpi = Schema.Struct({
  label: Schema.String,
  value: Schema.Number,
  denominator: Schema.optional(Schema.Number),
  unit: Schema.optional(Schema.Literal("count", "percent", "per_month")),
  delta: Schema.optional(Schema.Number),
})
export type Kpi = Schema.Schema.Type<typeof Kpi>

export const MonthPoint = Schema.Struct({ month: Month, value: Schema.Number })
export type MonthPoint = Schema.Schema.Type<typeof MonthPoint>

export const Series = Schema.Array(MonthPoint)
export type Series = Schema.Schema.Type<typeof Series>

export const CategoryBar = Schema.Struct({ label: Schema.String, value: Schema.Number })
export type CategoryBar = Schema.Schema.Type<typeof CategoryBar>

export const MarketBar = Schema.Struct({ market: Market, value: Schema.Number })
export type MarketBar = Schema.Schema.Type<typeof MarketBar>

export const UserRow = Schema.Struct({
  email: Schema.String,
  market: Schema.optional(Market),
  page_loads: Schema.Number,
  active_days: Schema.Number,
  first_seen: Schema.String, // ISO8601 date
  last_seen: Schema.String,
})
export type UserRow = Schema.Schema.Type<typeof UserRow>

// --- Inner shapes per snapshot file ---

// Risk-factor view counts, classified by view_type. Sourced from PostHog
// (riskFactorViewEventsQuery); not present in the RDS snapshot path.
export const RiskFactorViews = Schema.Struct({
  total: Schema.Number,
  overview: Schema.Number,
  drilldown: Schema.Number,
  other: Schema.Number,
})
export type RiskFactorViews = Schema.Schema.Type<typeof RiskFactorViews>

const PlatformMetrics = Schema.Struct({
  kpis: Schema.Array(Kpi),
  provider_views_by_month: Series,
  unit_views_by_month: Series,
  top_units_viewed: Schema.Array(CategoryBar),
  // Iter-12 additions (Leaders' Retention Workflow card). Totals are produced
  // by the aggregator; calendar-month count is supplied here so per-month
  // averages can be derived consistently with the investigation script.
  risk_factor_views: RiskFactorViews,
  total_provider_views: Schema.Number,
  total_unit_views: Schema.Number,
  clinicians_monitored: Schema.Number,
  calendar_months: Schema.Number,
  recurring_window_months: Schema.Number,
  unique_users: Schema.Number,
  recurring_leaders: Schema.Number,
  total_users_in_window: Schema.Number,
  retention_rate: Schema.Number, // 0-100
})

// Per-market retention card data (iter-10 of market-engagement-metrics).
// Mirrors the per-market dict the investigation's generate-html.py emits.
export const MarketCard = Schema.Struct({
  market: Market,
  unique_providers: Schema.Number,
  total_provider_views: Schema.Number,
  avg_provider_views_per_month: Schema.Number,
  unique_units: Schema.Number,
  total_unit_views: Schema.Number,
  avg_unit_views_per_month: Schema.Number,
  clinicians: Schema.Number,
  pct_clinicians_viewed: Schema.Number, // 0-100 (one decimal)
  unique_users: Schema.Number,
  recurring_leaders: Schema.Number,
  total_users_in_window: Schema.Number,
  retention_rate: Schema.Number, // 0-100
})
export type MarketCard = Schema.Schema.Type<typeof MarketCard>

const MarketMetrics = Schema.Struct({
  provider_views_by_market: Schema.Array(MarketBar),
  unit_views_by_market: Schema.Array(MarketBar),
  users_by_market: Schema.Array(MarketBar),
  clinicians_by_market: Schema.Array(MarketBar),
  market_cards: Schema.Array(MarketCard),
  calendar_months: Schema.Number,
  recurring_window_months: Schema.Number,
})

const ProvisionedUsers = Schema.Struct({
  total: Kpi,
  lima: Kpi,
  user_detail: Schema.Array(UserRow),
})

export const PlatformSnapshot = envelope(PlatformMetrics)
export const MarketSnapshot = envelope(MarketMetrics)
export const ProvisionedUsersSnapshot = envelope(ProvisionedUsers)

export type PlatformSnapshot = Schema.Schema.Type<typeof PlatformSnapshot>
export type MarketSnapshot = Schema.Schema.Type<typeof MarketSnapshot>
export type ProvisionedUsersSnapshot = Schema.Schema.Type<typeof ProvisionedUsersSnapshot>

// Map file basename → Schema. The /api/snapshot/[file] route uses this to pick
// the right Schema for the requested file.
export const SnapshotByFile = {
  "metrics.json": PlatformSnapshot,
  "market_metrics.json": MarketSnapshot,
  "provisioned_users.json": ProvisionedUsersSnapshot,
} as const
export type SnapshotFile = keyof typeof SnapshotByFile

export const SnapshotFileSchema = Schema.Literal(
  "metrics.json",
  "market_metrics.json",
  "provisioned_users.json",
)
