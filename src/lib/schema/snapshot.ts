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

const PlatformMetrics = Schema.Struct({
  kpis: Schema.Array(Kpi),
  provider_views_by_month: Series,
  unit_views_by_month: Series,
  top_units_viewed: Schema.Array(CategoryBar),
})

const MarketMetrics = Schema.Struct({
  provider_views_by_market: Schema.Array(MarketBar),
  unit_views_by_market: Schema.Array(MarketBar),
  users_by_market: Schema.Array(MarketBar),
  clinicians_by_market: Schema.Array(MarketBar),
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
