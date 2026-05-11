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
  MarketSnapshot,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
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
