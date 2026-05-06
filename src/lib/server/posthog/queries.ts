import type { Client } from "$lib/schema/snapshot"
import { CLIENTS } from "./config"

// URL-era catch-all regexes. Critical: a query that matches only `/units/`
// silently drops pre-Oct 2025 data (iter 04 of market-engagement showed 3 Lima
// loads when the true count was 974). Always use these.
const PROVIDER_URL_REGEX =
  "^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}$"
const UNIT_URL_REGEX =
  "^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}$"

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
