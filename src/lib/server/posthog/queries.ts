import type { Client } from "$lib/schema/snapshot"
import { CLIENTS } from "./config"

// URL-era catch-all regexes. Critical: a query that matches only `/units/`
// silently drops pre-Oct 2025 data (iter 04 of market-engagement showed 3 Lima
// loads when the true count was 974). Always use these.
const PROVIDER_URL_REGEX =
  "^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}$"
const UNIT_URL_REGEX =
  "^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}$"

// Extracts the first UUID after the URL prefix (the bu_uuid / region UUID).
// Used by both provider and unit queries — the first UUID segment is the same
// in both URL shapes.
const BU_UUID_EXTRACT =
  "^/(?:regions|units|physicians/units|nurses/units)/([a-f0-9-]{36})/.*$"

const emailFilter = (domains: readonly string[]): string =>
  domains.map((d) => `distinct_id LIKE '%${d}'`).join(" OR ")

const baseFilter = (client: Client, from: string, to: string): string => {
  const cfg = CLIENTS[client]
  return `event = 'Page Load'
    AND properties.\`client-username\` = '${cfg.clientUsername}'
    AND (${emailFilter(cfg.emailDomains)})
    AND timestamp >= '${from}'
    AND timestamp < '${to}'`
}

// Provider page loads (3-segment URL with legacy_id as the last UUID).
// Returns one row per page load. Aggregation is done in TypeScript, per the
// P4 pitfall ("don't aggregate in SQL").
export const providerViewEventsQuery = (
  client: Client,
  from: string,
  to: string,
): string => `SELECT
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  replaceRegexpOne(properties.url, '${BU_UUID_EXTRACT}', '\\\\1') AS bu_uuid,
  extract(properties.url, '([a-f0-9-]{36})$') AS provider_legacy_id
FROM events
WHERE ${baseFilter(client, from, to)}
  AND match(properties.url, '${PROVIDER_URL_REGEX}')
ORDER BY timestamp`

// Unit page loads (2-segment URL with group_uuid as the last UUID).
// Excludes the `/units/overview` landing page.
export const unitViewEventsQuery = (
  client: Client,
  from: string,
  to: string,
): string => `SELECT
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  replaceRegexpOne(properties.url, '${BU_UUID_EXTRACT}', '\\\\1') AS bu_uuid,
  replaceRegexpOne(properties.url, '^.*/([a-f0-9-]{36})$', '\\\\1') AS group_uuid
FROM events
WHERE ${baseFilter(client, from, to)}
  AND match(properties.url, '${UNIT_URL_REGEX}')
  AND NOT properties.url LIKE '%/units/overview%'
ORDER BY timestamp`

// Monthly user activity. ALLOWED P4 exception: raw page-load rows would explode
// (thousands of rows/month for active platforms). Aggregating per (month, user)
// is the canonical pattern in platform-engagement-metrics.md Query 4 and is
// still granular enough for downstream re-aggregation (recurring leaders /
// retention computed in TS from this output).
export const monthlyUserActivityQuery = (
  client: Client,
  from: string,
  to: string,
): string => `SELECT
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  count() AS event_count
FROM events
WHERE ${baseFilter(client, from, to)}
  AND NOT match(properties.url, '^/(ingest|_admin)')
GROUP BY month, user_email
ORDER BY month, user_email`

// Risk factor page loads. Returns one row per view classified by view_type:
//   - "overview"  → /risk-factors landing page
//   - "drilldown" → /risk-factors/{id}/(interventions|benchmarks)
//   - "other"     → everything else under /risk-factors/{id}
// Filtered to the same client + email-domain filter as the other queries.
// Aggregation (totals per type) is done in TypeScript.
export const riskFactorViewEventsQuery = (
  client: Client,
  from: string,
  to: string,
): string => `SELECT
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  properties.url AS url,
  multiIf(
    properties.url = '/risk-factors', 'overview',
    match(properties.url, '^/risk-factors/[0-9]+/(interventions|benchmarks)'), 'drilldown',
    'other'
  ) AS view_type
FROM events
WHERE ${baseFilter(client, from, to)}
  AND (properties.url = '/risk-factors' OR match(properties.url, '^/risk-factors/[0-9]+'))
ORDER BY timestamp`

// Provider legacy_ids viewed externally in a window — the "treatment cohort"
// for the success-stories page. Same URL-era coverage and `client-username`
// filter as the other queries. Internal viewers are excluded using the same
// email-domain inclusion list (i.e. only the client's own users count). The
// HogQL API caps results at 100 unless an explicit LIMIT is set higher;
// 10000 is well above any realistic per-client cohort.
//
// `from`/`to` are inclusive-month boundaries that the caller converts to
// the half-open `[from-01, next-month-01)` range used elsewhere.
export const successStoriesCohortQuery = (
  client: Client,
  from: string,
  to: string,
): string => `SELECT
  extract(properties.url, '([a-f0-9-]{36})$') AS legacy_id,
  count() AS total_views
FROM events
WHERE ${baseFilter(client, from, to)}
  AND match(properties.url, '${PROVIDER_URL_REGEX}')
GROUP BY legacy_id
ORDER BY total_views DESC
LIMIT 10000`

// Per-(month, user) day-level activity summary used to populate the user-detail
// table on /provisioned-users. Returns one row per (month, user) with that
// month's page-load count, distinct active days, first/last seen dates. The
// loader merges across months in TS: page_loads sum, active_days sum (distinct
// days never overlap across months), min(first_seen), max(last_seen).
//
// ALLOWED P4 exception, same reasoning as monthlyUserActivityQuery: raw events
// would be thousands of rows/month/user; this aggregate is what downstream
// needs and stays under the page limit at realistic user counts.
export const userActivityByMonthQuery = (
  client: Client,
  from: string,
  to: string,
): string => `SELECT
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  count() AS page_loads,
  count(DISTINCT toDate(timestamp)) AS active_days,
  formatDateTime(min(timestamp), '%Y-%m-%d') AS first_seen,
  formatDateTime(max(timestamp), '%Y-%m-%d') AS last_seen
FROM events
WHERE ${baseFilter(client, from, to)}
  AND NOT match(properties.url, '^/(ingest|_admin)')
GROUP BY month, user_email
ORDER BY month, user_email`
