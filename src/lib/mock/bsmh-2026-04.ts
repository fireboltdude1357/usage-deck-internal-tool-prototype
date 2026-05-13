/**
 * BSMH mock dataset for 2026-04. Single source of truth for fixtures.
 *
 * Numbers are aggregated from real CSV outputs at:
 *   ../parent-db-investigations/db-investigation/investigations/bsmh-usage-deck/engagement/
 *     platform-engagement-metrics/12-retention-workflow-visuals/results/
 *     market-engagement-metrics/10-retention-workflow-visuals/results/
 *     bsmh-provisioned-users/03-total-and-lima/
 *
 * Re-derive after refreshing investigations: run `npm run gen:fixtures` to write
 * the JSON fixtures and Schema-validate them at write time.
 *
 * Emails in `user_detail` are obfuscated (user01..@mercy.com / @bshsi.org).
 * Counts and distributions are real.
 */
import type {
  AdoptionEngagementSnapshot,
  MarketSnapshot,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
  SuccessStoriesSnapshot,
} from "$lib/schema/snapshot"

const generated_at = "2026-05-01T17:30:00Z"

export const platform: PlatformSnapshot = {
  client: "bsmh",
  month: "2026-04",
  generated_at,
  source: "posthog",
  metrics: {
    kpis: [
      // Aggregations from provider-view-events.csv + unit-view-events.csv + clinician-roster.csv
      { label: "Unique providers viewed", value: 121, unit: "count" },
      // 121 unique providers / 2,038 total clinicians on roster — use markets-only roster for the
      // headline (1,005 in the 6 BSMH markets), but the platform headline is whole-platform.
      { label: "% of monitored clinicians", value: 6, denominator: 2038, unit: "percent" },
      { label: "Unique units viewed", value: 90, unit: "count" },
      { label: "Logged-in provisioned users", value: 22, denominator: 37, unit: "count" },
      // Recurring leaders: users active 3+ of the 7 months in window.
      { label: "Recurring leaders (3+ mo)", value: 4, denominator: 17, unit: "count" },
      // Retention rate: recurring / total active in recurring window.
      { label: "Retention rate", value: 24, unit: "percent" },
      // Risk factor views (overview + drilldown).
      { label: "Risk factor views", value: 157, unit: "count" },
    ],
    // Iter-12 totals.
    risk_factor_views: { total: 157, overview: 104, drilldown: 53, other: 0 },
    total_provider_views: 176,
    total_unit_views: 302,
    clinicians_monitored: 2038,
    calendar_months: 7,
    recurring_window_months: 5,
    unique_users: 22,
    recurring_leaders: 4,
    total_users_in_window: 17,
    retention_rate: 24,
    // Provider page loads per month (count of rows in provider-view-events.csv by month).
    provider_views_by_month: [
      { month: "2025-08", value: 9 },
      { month: "2025-09", value: 10 },
      { month: "2025-10", value: 68 },
      { month: "2025-11", value: 32 },
      { month: "2025-12", value: 27 },
      { month: "2026-01", value: 2 },
      { month: "2026-02", value: 28 },
    ],
    // Direct from unit-view-monthly-counts.csv. (No 2026-01 row — zero for that month.)
    unit_views_by_month: [
      { month: "2025-08", value: 91 },
      { month: "2025-09", value: 117 },
      { month: "2025-10", value: 66 },
      { month: "2025-11", value: 4 },
      { month: "2025-12", value: 16 },
      { month: "2026-01", value: 0 },
      { month: "2026-02", value: 8 },
    ],
    // Top 10 most-viewed group_uuids from unit-view-events.csv. Labels are short uuid prefixes
    // since investigation CSVs don't carry human unit names — phase 03's Athena-side join will.
    top_units_viewed: [
      { label: "c034050b…", value: 21 },
      { label: "87ac4027…", value: 17 },
      { label: "ea3fec9d…", value: 17 },
      { label: "b6eb2ce9…", value: 10 },
      { label: "5abc095b…", value: 9 },
      { label: "fc214bd6…", value: 9 },
      { label: "1f88251d…", value: 8 },
      { label: "50725b1f…", value: 8 },
      { label: "464fff88…", value: 7 },
      { label: "d06c66d9…", value: 7 },
    ],
  },
}

// Per-market aggregations — bu_uuid → market → counts. From CSV aggregation script.
// Toledo had no events in the 7-month window; explicit 0 keeps the bar visible.
export const market: MarketSnapshot = {
  client: "bsmh",
  month: "2026-04",
  generated_at,
  source: "posthog",
  metrics: {
    provider_views_by_market: [
      { market: "Hampton Roads", value: 61 },
      { market: "Kentucky", value: 59 },
      { market: "Youngstown", value: 21 },
      { market: "Lima", value: 19 },
      { market: "Lorain", value: 16 },
      { market: "Toledo", value: 0 },
    ],
    unit_views_by_market: [
      { market: "Hampton Roads", value: 139 },
      { market: "Youngstown", value: 62 },
      { market: "Lorain", value: 44 },
      { market: "Kentucky", value: 31 },
      { market: "Lima", value: 26 },
      { market: "Toledo", value: 0 },
    ],
    users_by_market: [
      { market: "Lorain", value: 5 },
      { market: "Kentucky", value: 5 },
      { market: "Youngstown", value: 5 },
      { market: "Hampton Roads", value: 4 },
      { market: "Lima", value: 4 },
      { market: "Toledo", value: 0 },
    ],
    clinicians_by_market: [
      { market: "Youngstown", value: 322 },
      { market: "Toledo", value: 252 },
      { market: "Lima", value: 163 },
      { market: "Hampton Roads", value: 108 },
      { market: "Lorain", value: 85 },
      { market: "Kentucky", value: 75 },
    ],
    // Iter-10 per-market summary. Numbers come from
    // market-engagement-metrics/10-retention-workflow-visuals/README.md § Metrics Summary
    // and the per-market HTML cards. Order matches ALL_MARKETS so the page
    // can render them in a stable layout.
    market_cards: [
      {
        market: "Hampton Roads",
        unique_providers: 43,
        total_provider_views: 61,
        avg_provider_views_per_month: 9,
        unique_units: 28,
        total_unit_views: 139,
        avg_unit_views_per_month: 20,
        clinicians: 108,
        pct_clinicians_viewed: 39.8,
        unique_users: 4,
        recurring_leaders: 2,
        total_users_in_window: 4,
        retention_rate: 50,
      },
      {
        market: "Lorain",
        unique_providers: 13,
        total_provider_views: 16,
        avg_provider_views_per_month: 2,
        unique_units: 20,
        total_unit_views: 44,
        avg_unit_views_per_month: 6,
        clinicians: 85,
        pct_clinicians_viewed: 15.3,
        unique_users: 5,
        recurring_leaders: 0,
        total_users_in_window: 5,
        retention_rate: 0,
      },
      {
        market: "Lima",
        unique_providers: 12,
        total_provider_views: 19,
        avg_provider_views_per_month: 3,
        unique_units: 9,
        total_unit_views: 26,
        avg_unit_views_per_month: 4,
        clinicians: 163,
        pct_clinicians_viewed: 7.4,
        unique_users: 4,
        recurring_leaders: 0,
        total_users_in_window: 4,
        retention_rate: 0,
      },
      {
        market: "Youngstown",
        unique_providers: 16,
        total_provider_views: 21,
        avg_provider_views_per_month: 3,
        unique_units: 24,
        total_unit_views: 62,
        avg_unit_views_per_month: 9,
        clinicians: 322,
        pct_clinicians_viewed: 5.0,
        unique_users: 5,
        recurring_leaders: 1,
        total_users_in_window: 3,
        retention_rate: 33,
      },
      {
        market: "Kentucky",
        unique_providers: 37,
        total_provider_views: 59,
        avg_provider_views_per_month: 8,
        unique_units: 9,
        total_unit_views: 31,
        avg_unit_views_per_month: 4,
        clinicians: 75,
        pct_clinicians_viewed: 49.3,
        unique_users: 5,
        recurring_leaders: 1,
        total_users_in_window: 3,
        retention_rate: 33,
      },
      {
        market: "Toledo",
        unique_providers: 0,
        total_provider_views: 0,
        avg_provider_views_per_month: 0,
        unique_units: 0,
        total_unit_views: 0,
        avg_unit_views_per_month: 0,
        clinicians: 252,
        pct_clinicians_viewed: 0,
        unique_users: 0,
        recurring_leaders: 0,
        total_users_in_window: 0,
        retention_rate: 0,
      },
    ],
    calendar_months: 7,
    recurring_window_months: 5,
  },
}

// Per-user roster: 22 obfuscated rows. Emails are user01..user22 — counts and distributions are
// the real values from monthly-user-activity.csv (page_loads = total event_count across months).
// active_days is approximated as months_active × 5 (real CSV doesn't capture per-day activity).
// market is assigned for the 7 Lima users + 4 spread across other markets where attribution is
// strong; rows without market attribution are left unset (provisioned but cross-market or unmapped).
export const provisionedUsers: ProvisionedUsersSnapshot = {
  client: "bsmh",
  month: "2026-04",
  generated_at,
  source: "posthog",
  metrics: {
    total: { label: "Logged in", value: 22, denominator: 37, unit: "count" },
    lima: { label: "Lima logged in", value: 7, denominator: 7, unit: "count" },
    user_detail: [
      { email: "user01@mercy.com", market: "Lima", page_loads: 1975, active_days: 25, first_seen: "2025-08-12", last_seen: "2026-02-18" },
      { email: "user02@bshsi.org", market: "Lima", page_loads: 853, active_days: 30, first_seen: "2025-08-19", last_seen: "2026-02-25" },
      { email: "user03@mercy.com", market: "Hampton Roads", page_loads: 662, active_days: 22, first_seen: "2025-08-13", last_seen: "2026-02-20" },
      { email: "user04@bshsi.org", market: "Kentucky", page_loads: 452, active_days: 18, first_seen: "2025-09-15", last_seen: "2025-12-19" },
      { email: "user05@mercy.com", market: "Lorain", page_loads: 384, active_days: 14, first_seen: "2025-08-13", last_seen: "2025-12-08" },
      { email: "user06@bshsi.org", market: "Hampton Roads", page_loads: 377, active_days: 8, first_seen: "2025-09-16", last_seen: "2025-10-21" },
      { email: "user07@mercy.com", market: "Lima", page_loads: 184, active_days: 9, first_seen: "2025-08-19", last_seen: "2025-10-22" },
      { email: "user08@mercy.com", market: "Youngstown", page_loads: 180, active_days: 11, first_seen: "2025-08-19", last_seen: "2026-02-12" },
      { email: "user09@mercy.com", market: "Lima", page_loads: 151, active_days: 7, first_seen: "2025-08-19", last_seen: "2025-09-30" },
      { email: "user10@mercy.com", market: "Kentucky", page_loads: 143, active_days: 5, first_seen: "2025-11-04", last_seen: "2025-11-26" },
      { email: "user11@mercy.com", market: "Lorain", page_loads: 121, active_days: 5, first_seen: "2025-10-08", last_seen: "2025-10-30" },
      { email: "user12@bshsi.org", market: "Lima", page_loads: 91, active_days: 6, first_seen: "2025-09-22", last_seen: "2025-10-28" },
      { email: "user13@mercy.com", page_loads: 74, active_days: 4, first_seen: "2025-09-09", last_seen: "2025-09-25" },
      { email: "user14@mercy.com", market: "Youngstown", page_loads: 72, active_days: 4, first_seen: "2026-02-03", last_seen: "2026-02-26" },
      { email: "user15@mercy.com", market: "Lima", page_loads: 67, active_days: 4, first_seen: "2025-11-05", last_seen: "2025-11-30" },
      { email: "user16@mercy.com", market: "Kentucky", page_loads: 65, active_days: 4, first_seen: "2025-12-02", last_seen: "2025-12-22" },
      { email: "user17@mercy.com", market: "Lorain", page_loads: 61, active_days: 7, first_seen: "2025-11-12", last_seen: "2026-02-08" },
      { email: "user18@mercy.com", market: "Lima", page_loads: 41, active_days: 6, first_seen: "2025-08-15", last_seen: "2025-09-20" },
      { email: "user19@mercy.com", page_loads: 37, active_days: 3, first_seen: "2025-11-08", last_seen: "2025-11-25" },
      { email: "user20@bshsi.org", page_loads: 18, active_days: 2, first_seen: "2025-09-08", last_seen: "2025-09-22" },
      { email: "user21@mercy.com", market: "Hampton Roads", page_loads: 11, active_days: 4, first_seen: "2025-08-22", last_seen: "2025-09-18" },
      { email: "user22@bshsi.org", market: "Youngstown", page_loads: 6, active_days: 2, first_seen: "2025-09-12", last_seen: "2025-10-04" },
    ],
  },
}

// Success-stories fixture. Eight synthetic providers across the 5/5, 4/5, and
// 3/5 tiers, each with a 7-month series (Aug 2025 → Feb 2026) shaped so that
// the live derivation in `src/lib/success-stories.ts` reproduces the iter-12
// numbers when the picker is left at the default trailing-7-month window.
//
// The values are kept simple: pre/post constants per provider, repeated across
// the pre half (first 3 months) and the post half (last 4 months). That way
// the averages collapse to the same pre/post numbers the old pre-aggregated
// fixture carried.

const PRE = ["2025-08", "2025-09", "2025-10"] as const
const POST = ["2025-11", "2025-12", "2026-01", "2026-02"] as const

type MonthlyShape = {
  procedures: number | null
  work_rvu: number | null
  encounters: number | null
  enc_duration: number | null
  doc_time: number | null
  admin_time: number | null
  quit_prob: number | null
}

const series = (
  pre: MonthlyShape,
  post: MonthlyShape,
): SuccessStoriesSnapshot["metrics"]["providers"][number]["monthly"] => [
  ...PRE.map((m) => ({ month: m, ...pre })),
  ...POST.map((m) => ({ month: m, ...post })),
]

export const successStories: SuccessStoriesSnapshot = {
  client: "bsmh",
  month: "2026-04",
  generated_at,
  source: "athena",
  metrics: {
    min_pre_procedures: 10,
    available_months: [...PRE, ...POST],
    providers: [
      {
        provider_id: "00000000-0000-0000-0000-000000000001",
        name: "Provider 01",
        specialty: "Family Medicine",
        category: "Physician",
        department: "Bon Secours Family Medicine",
        market: "Hampton Roads",
        monthly: series(
          { procedures: 142.5, work_rvu: 218.42, encounters: 350, enc_duration: 312, doc_time: 5102, admin_time: 412, quit_prob: 0.0421 },
          { procedures: 168.7, work_rvu: 257.11, encounters: 380, enc_duration: 348, doc_time: 4233, admin_time: 339, quit_prob: 0.0118 },
        ),
      },
      {
        provider_id: "00000000-0000-0000-0000-000000000002",
        name: "Provider 02",
        specialty: "Cardiology",
        category: "Physician",
        department: "Mercy Heart & Vascular",
        market: "Lorain",
        monthly: series(
          { procedures: 88.0, work_rvu: 312.5, encounters: 280, enc_duration: 401, doc_time: 6212, admin_time: 488, quit_prob: 0.0382 },
          { procedures: 105.3, work_rvu: 354.0, encounters: 305, enc_duration: 430, doc_time: 5587, admin_time: 421, quit_prob: 0.0156 },
        ),
      },
      {
        provider_id: "00000000-0000-0000-0000-000000000003",
        name: "Provider 03",
        specialty: "Internal Medicine",
        category: "Physician",
        department: "Mercy Health - Lima",
        market: "Lima",
        monthly: series(
          { procedures: 211.0, work_rvu: 178.20, encounters: 410, enc_duration: 285, doc_time: 4781, admin_time: 378, quit_prob: 0.0512 },
          { procedures: 244.7, work_rvu: 198.45, encounters: 435, enc_duration: 278, doc_time: 4022, admin_time: 312, quit_prob: 0.0205 },
        ),
      },
      {
        provider_id: "00000000-0000-0000-0000-000000000004",
        name: "Provider 04",
        specialty: "Orthopedics",
        category: "Physician",
        department: "VA Ortho Spec - Harbourview",
        market: "Hampton Roads",
        monthly: series(
          { procedures: 76.5, work_rvu: 425.10, encounters: 220, enc_duration: 332, doc_time: 3920, admin_time: 295, quit_prob: 0.0334 },
          { procedures: 89.0, work_rvu: 478.22, encounters: 245, enc_duration: 358, doc_time: 4112, admin_time: 318, quit_prob: 0.0202 },
        ),
      },
      {
        provider_id: "00000000-0000-0000-0000-000000000005",
        name: "Provider 05",
        specialty: "Hospitalist",
        category: "Physician",
        department: "Mercy Hospitalist Group",
        market: "Youngstown",
        monthly: series(
          { procedures: 165.0, work_rvu: 287.50, encounters: 380, enc_duration: 412, doc_time: 5340, admin_time: 412, quit_prob: 0.0612 },
          { procedures: 158.3, work_rvu: 314.20, encounters: 375, enc_duration: 401, doc_time: 4855, admin_time: 388, quit_prob: 0.0431 },
        ),
      },
      {
        provider_id: "00000000-0000-0000-0000-000000000006",
        name: "Provider 06",
        specialty: "Behavioral Health",
        category: "APRN",
        department: "Mercy Behavioral Health",
        market: "Kentucky",
        monthly: series(
          { procedures: 122.5, work_rvu: 102.40, encounters: 520, enc_duration: 540, doc_time: 4820, admin_time: 502, quit_prob: 0.0245 },
          { procedures: 145.0, work_rvu: 98.20, encounters: 545, enc_duration: 612, doc_time: 4178, admin_time: 478, quit_prob: 0.0312 },
        ),
      },
      {
        provider_id: "00000000-0000-0000-0000-000000000007",
        name: "Provider 07",
        specialty: "OB/GYN",
        category: "Physician",
        department: "Mercy Women's Health",
        market: "Hampton Roads",
        monthly: series(
          { procedures: 198.0, work_rvu: 412.20, encounters: 360, enc_duration: 268, doc_time: 5912, admin_time: 432, quit_prob: 0.0488 },
          { procedures: 232.5, work_rvu: 461.15, encounters: 385, enc_duration: 252, doc_time: 6088, admin_time: 461, quit_prob: 0.0301 },
        ),
      },
      {
        provider_id: "00000000-0000-0000-0000-000000000008",
        name: "Provider 08",
        specialty: "Neurology",
        category: "Physician",
        department: "Mercy Neurology Associates",
        market: "Lorain",
        monthly: series(
          { procedures: 64.0, work_rvu: 244.10, encounters: 290, enc_duration: 425, doc_time: 4488, admin_time: 388, quit_prob: 0.0556 },
          { procedures: 62.5, work_rvu: 231.50, encounters: 285, enc_duration: 478, doc_time: 3987, admin_time: 362, quit_prob: 0.0398 },
        ),
      },
    ],
  },
}

// Illustrative — derived shape, not pulled from a specific investigation CSV.
// Adoption ramps then plateaus; each engagement definition tells a different
// story over the same population (numbers chosen to make the tradeoffs visible
// in a dev screenshot — generous defs are higher, strict ones lower).
const MONTHS = [
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
] as const

const engagedSeries = (vals: readonly number[]) =>
  MONTHS.map((month, i) => ({ month, value: vals[i] }))

export const adoptionEngagement: AdoptionEngagementSnapshot = {
  client: "bsmh",
  month: "2026-04",
  generated_at,
  source: "posthog",
  metrics: {
    adoption: [
      { month: "2025-08", new_adopters: 6, adopters: 6 },
      { month: "2025-09", new_adopters: 4, adopters: 10 },
      { month: "2025-10", new_adopters: 5, adopters: 15 },
      { month: "2025-11", new_adopters: 3, adopters: 18 },
      { month: "2025-12", new_adopters: 1, adopters: 19 },
      { month: "2026-01", new_adopters: 1, adopters: 20 },
      { month: "2026-02", new_adopters: 2, adopters: 22 },
    ],
    views: [
      {
        definition: "mau",
        label: "Monthly active",
        description: "≥1 session in this month.",
        kpis: [
          { label: "Total adopters", value: 22, unit: "count" },
          { label: "Engaged (Monthly active)", value: 7, denominator: 22, unit: "count" },
          { label: "Engagement rate", value: 32, unit: "percent" },
        ],
        engaged_by_month: engagedSeries([6, 6, 8, 5, 4, 3, 7]),
      },
      {
        definition: "rolling_3mo",
        label: "Rolling 3-mo",
        description: "≥1 session in the trailing 3 months. Users can drop out after 3 silent months and re-engage later.",
        kpis: [
          { label: "Total adopters", value: 22, unit: "count" },
          { label: "Engaged (Rolling 3-mo)", value: 9, denominator: 22, unit: "count" },
          { label: "Engagement rate", value: 41, unit: "percent" },
        ],
        engaged_by_month: engagedSeries([6, 10, 14, 12, 10, 8, 9]),
      },
      {
        definition: "rolling_6mo",
        label: "Rolling 6-mo",
        description: "≥1 session in the trailing 6 months. More permissive than rolling 3-mo; catches quarterly-cadence users.",
        kpis: [
          { label: "Total adopters", value: 22, unit: "count" },
          { label: "Engaged (Rolling 6-mo)", value: 17, denominator: 22, unit: "count" },
          { label: "Engagement rate", value: 77, unit: "percent" },
        ],
        engaged_by_month: engagedSeries([6, 10, 14, 15, 16, 16, 17]),
      },
      {
        definition: "l2_3",
        label: "L2/3",
        description: "Active in ≥2 of the last 3 months — frequency-based, filters one-touch users out of \"engaged\".",
        kpis: [
          { label: "Total adopters", value: 22, unit: "count" },
          { label: "Engaged (L2/3)", value: 5, denominator: 22, unit: "count" },
          { label: "Engagement rate", value: 23, unit: "percent" },
        ],
        engaged_by_month: engagedSeries([0, 4, 7, 6, 5, 3, 5]),
      },
      {
        definition: "l3_6",
        label: "L3/6",
        description: "Active in ≥3 of the last 6 months — captures consistent but not necessarily monthly use.",
        kpis: [
          { label: "Total adopters", value: 22, unit: "count" },
          { label: "Engaged (L3/6)", value: 6, denominator: 22, unit: "count" },
          { label: "Engagement rate", value: 27, unit: "percent" },
        ],
        engaged_by_month: engagedSeries([0, 0, 4, 5, 7, 6, 6]),
      },
      {
        definition: "power_user",
        label: "Power user",
        description: "≥5 page-loads in the trailing 3 months. Depth threshold — differentiates \"opened it\" from \"working with it\".",
        kpis: [
          { label: "Total adopters", value: 22, unit: "count" },
          { label: "Engaged (Power user)", value: 4, denominator: 22, unit: "count" },
          { label: "Engagement rate", value: 18, unit: "percent" },
        ],
        engaged_by_month: engagedSeries([2, 5, 8, 7, 5, 3, 4]),
      },
      {
        definition: "multi_day",
        label: "Multi-day",
        description: "≥2 distinct active days in the trailing 3 months. Stronger than page-load count alone; filters single-binge sessions.",
        kpis: [
          { label: "Total adopters", value: 22, unit: "count" },
          { label: "Engaged (Multi-day)", value: 6, denominator: 22, unit: "count" },
          { label: "Engagement rate", value: 27, unit: "percent" },
        ],
        engaged_by_month: engagedSeries([3, 6, 9, 8, 6, 5, 6]),
      },
      {
        definition: "no_gap_3mo",
        label: "No 3-mo gap",
        description: "Never silent for 3 consecutive months since first-seen. One slip and a user is permanently out.",
        kpis: [
          { label: "Total adopters", value: 22, unit: "count" },
          { label: "Engaged (No 3-mo gap)", value: 3, denominator: 22, unit: "count" },
          { label: "Engagement rate", value: 14, unit: "percent" },
        ],
        engaged_by_month: engagedSeries([6, 10, 13, 9, 6, 4, 3]),
      },
      {
        definition: "ever_3_months",
        label: "Lifetime 3+ mo",
        description: "Any session in ≥3 distinct months. Once a user clears the bar, they're permanently engaged.",
        kpis: [
          { label: "Total adopters", value: 22, unit: "count" },
          { label: "Engaged (Lifetime 3+ mo)", value: 11, denominator: 22, unit: "count" },
          { label: "Engagement rate", value: 50, unit: "percent" },
        ],
        engaged_by_month: engagedSeries([0, 0, 4, 7, 9, 10, 11]),
      },
    ],
  },
}
