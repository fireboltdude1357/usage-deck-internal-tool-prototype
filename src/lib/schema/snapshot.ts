import { Schema } from "effect"

export const Client = Schema.Literal("bsmh", "ssm", "duke", "ucsf")
export type Client = Schema.Schema.Type<typeof Client>

// Market labels are client-specific (BSMH has 6 geographic markets; SSM has
// 7 regional units; Duke/UCSF have none meaningfully — see
// src/lib/server/posthog/config.ts MARKETS_BY_CLIENT). Kept as an open string
// in the schema so each client can publish its own market names without a
// schema migration; the per-client allow-list is enforced upstream by the
// aggregator (it only emits markets it knows about).
// "all" is the page-level "no market filter" sentinel (URL value), not a snapshot value.
export const Market = Schema.String
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

// The improvement labels used by the success-stories card. Lives in the
// schema (not just in derive code) because the page renders/filters by
// these names and they must stay consistent across producer + consumer.
export const SuccessStoryImprovement = Schema.Literal(
  "turnover",
  "volume",
  "time_with_patients",
  "efficiency",
  "rvu",
)
export type SuccessStoryImprovement = Schema.Schema.Type<typeof SuccessStoryImprovement>

// One month of raw, unaggregated metrics for a single provider. The producer
// emits one row per (provider, month) in the analysis window; pre/post pairing
// is decided live by the page loader based on the user-selected date range.
export const SuccessStoryProviderMonth = Schema.Struct({
  month: Month,
  procedures: Schema.NullOr(Schema.Number),
  work_rvu: Schema.NullOr(Schema.Number),
  encounters: Schema.NullOr(Schema.Number),
  enc_duration: Schema.NullOr(Schema.Number),
  doc_time: Schema.NullOr(Schema.Number),
  admin_time: Schema.NullOr(Schema.Number),
  quit_prob: Schema.NullOr(Schema.Number),
})
export type SuccessStoryProviderMonth = Schema.Schema.Type<typeof SuccessStoryProviderMonth>

// One provider's per-month series + display metadata. The pre/post derivation
// (turnover/procedures/rvu/enc_duration/doc_time/admin_time + n_improvements)
// is computed live by `src/lib/success-stories.ts` against the picker range.
export const SuccessStoryProvider = Schema.Struct({
  provider_id: Schema.String,
  name: Schema.String,
  specialty: Schema.String,
  category: Schema.String,
  department: Schema.String,
  // null when the client has no market split (Duke, UCSF) or when the
  // businessunitname for the provider isn't mapped in BU_CODE_MARKET.
  market: Schema.NullOr(Market),
  monthly: Schema.Array(SuccessStoryProviderMonth),
})
export type SuccessStoryProvider = Schema.Schema.Type<typeof SuccessStoryProvider>

const SuccessStoriesMetrics = Schema.Struct({
  // Gate applied live by the page loader: providers whose pre-window
  // procedure average falls below this are excluded (signal-to-noise).
  min_pre_procedures: Schema.Number,
  // Sorted list of every month that appears in any provider's series — the
  // page uses this to clamp the picker range to a valid window when the
  // current selection has no data on either side of the split.
  available_months: Schema.Array(Month),
  providers: Schema.Array(SuccessStoryProvider),
})

// Adoption is definition-independent: a user is "adopted" the first month they
// appear in the picker window. The adoption curve below is shared across every
// engagement view.
export const AdoptionMonthPoint = Schema.Struct({
  month: Month,
  new_adopters: Schema.Number, // first-ever session within the window in this month
  adopters: Schema.Number, // cumulative distinct adopters up to and including M
})
export type AdoptionMonthPoint = Schema.Schema.Type<typeof AdoptionMonthPoint>

// The 9 engagement definitions shipped today. Stable string IDs; the page uses
// them as tab keys and as keys for persisting the selected tab in URL state.
//   mau            — Monthly active: ≥1 session in M itself.
//   rolling_3mo    — ≥1 session in trailing 3 months [M-2, M].
//   rolling_6mo    — ≥1 session in trailing 6 months [M-5, M].
//   l2_3           — Active in ≥2 of the last 3 months.
//   l3_6           — Active in ≥3 of the last 6 months.
//   power_user     — ≥5 page-loads summed across [M-2, M].
//   multi_day      — ≥2 distinct active days summed across [M-2, M].
//   no_gap_3mo     — Never silent for 3 consecutive months since first-seen;
//                    once a user disengages by this rule they're out permanently.
//   ever_3_months  — Once a user has any session in ≥3 distinct months, engaged
//                    permanently from the third such month onward.
export const EngagementDefinition = Schema.Literal(
  "mau",
  "rolling_3mo",
  "rolling_6mo",
  "l2_3",
  "l3_6",
  "power_user",
  "multi_day",
  "no_gap_3mo",
  "ever_3_months",
)
export type EngagementDefinition = Schema.Schema.Type<typeof EngagementDefinition>

export const AdoptionEngagementView = Schema.Struct({
  definition: EngagementDefinition,
  label: Schema.String, // short tab label, e.g. "Rolling 3-mo"
  description: Schema.String, // one-sentence explanation shown above the chart
  kpis: Schema.Array(Kpi),
  engaged_by_month: Series,
})
export type AdoptionEngagementView = Schema.Schema.Type<typeof AdoptionEngagementView>

const AdoptionEngagementMetrics = Schema.Struct({
  adoption: Schema.Array(AdoptionMonthPoint),
  views: Schema.Array(AdoptionEngagementView),
})

export const PlatformSnapshot = envelope(PlatformMetrics)
export const MarketSnapshot = envelope(MarketMetrics)
export const ProvisionedUsersSnapshot = envelope(ProvisionedUsers)
export const SuccessStoriesSnapshot = envelope(SuccessStoriesMetrics)
export const AdoptionEngagementSnapshot = envelope(AdoptionEngagementMetrics)

export type PlatformSnapshot = Schema.Schema.Type<typeof PlatformSnapshot>
export type MarketSnapshot = Schema.Schema.Type<typeof MarketSnapshot>
export type ProvisionedUsersSnapshot = Schema.Schema.Type<typeof ProvisionedUsersSnapshot>
export type SuccessStoriesSnapshot = Schema.Schema.Type<typeof SuccessStoriesSnapshot>
export type AdoptionEngagementSnapshot = Schema.Schema.Type<typeof AdoptionEngagementSnapshot>

// Map file basename → Schema. The /api/snapshot/[file] route uses this to pick
// the right Schema for the requested file.
export const SnapshotByFile = {
  "metrics.json": PlatformSnapshot,
  "market_metrics.json": MarketSnapshot,
  "provisioned_users.json": ProvisionedUsersSnapshot,
  "success_stories.json": SuccessStoriesSnapshot,
  "adoption_engagement.json": AdoptionEngagementSnapshot,
} as const
export type SnapshotFile = keyof typeof SnapshotByFile

export const SnapshotFileSchema = Schema.Literal(
  "metrics.json",
  "market_metrics.json",
  "provisioned_users.json",
  "success_stories.json",
  "adoption_engagement.json",
)
