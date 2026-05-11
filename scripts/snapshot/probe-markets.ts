// Ad-hoc probe: for every client, list distinct bu_uuids that appear in
// `/regions|units|physicians/units|nurses/units/...` URLs, with page-load
// counts and distinct-user counts. Used to decide whether non-BSMH clients
// have a "market" axis worth mapping.
//
// Run: npx tsx scripts/snapshot/probe-markets.ts [--from YYYY-MM] [--to YYYY-MM]

import * as path from "node:path"
import { parseArgs } from "node:util"
import { loadEnv } from "./load-env.ts"
import { CLIENTS, POSTHOG_ENDPOINT } from "../../src/lib/server/posthog/config.ts"
import type { Client } from "../../src/lib/schema/snapshot.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
loadEnv(path.join(ROOT, ".env"))

const { values } = parseArgs({
  options: {
    from: { type: "string", default: "2025-08" },
    to: { type: "string", default: "2026-05" },
  },
  strict: true,
})

const from = `${values.from}-01`
const [ty, tm] = values.to!.split("-").map(Number)
const nextMonth = new Date(Date.UTC(ty, tm, 1))
const to = nextMonth.toISOString().slice(0, 10)

const API_KEY = process.env.POSTHOG_API_KEY
if (!API_KEY) {
  console.error("POSTHOG_API_KEY not set")
  process.exit(1)
}

interface HogQLResponse {
  readonly results: readonly (readonly unknown[])[]
  readonly columns: readonly string[]
}

const runHogQL = async (query: string, label: string): Promise<HogQLResponse> => {
  const started = Date.now()
  const res = await fetch(POSTHOG_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`PostHog ${res.status} ${res.statusText} (${label}): ${body.slice(0, 500)}`)
  }
  const json = (await res.json()) as HogQLResponse
  console.error(`[posthog] ${label} ${Date.now() - started}ms rows=${json.results.length}`)
  return json
}

const BU_UUID_EXTRACT =
  "^/(?:regions|units|physicians/units|nurses/units)/([a-f0-9-]{36})/.*$"
const URL_REGEX =
  "^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/.*$"

const emailFilter = (domains: readonly string[]): string =>
  domains.map((d) => `distinct_id LIKE '%${d}'`).join(" OR ")

const buUuidQuery = (client: Client): string => {
  const cfg = CLIENTS[client]
  return `SELECT
    replaceRegexpOne(properties.url, '${BU_UUID_EXTRACT}', '\\\\1') AS bu_uuid,
    count() AS page_loads,
    count(DISTINCT distinct_id) AS distinct_users,
    min(formatDateTime(timestamp, '%Y-%m-%d')) AS first_seen,
    max(formatDateTime(timestamp, '%Y-%m-%d')) AS last_seen
  FROM events
  WHERE event = 'Page Load'
    AND properties.\`client-username\` = '${cfg.clientUsername}'
    AND (${emailFilter(cfg.emailDomains)})
    AND timestamp >= '${from}'
    AND timestamp < '${to}'
    AND match(properties.url, '${URL_REGEX}')
  GROUP BY bu_uuid
  ORDER BY page_loads DESC`
}

const totalsQuery = (client: Client): string => {
  const cfg = CLIENTS[client]
  return `SELECT
    count() AS total_loads,
    count(DISTINCT distinct_id) AS distinct_users,
    countIf(match(properties.url, '${URL_REGEX}')) AS region_loads
  FROM events
  WHERE event = 'Page Load'
    AND properties.\`client-username\` = '${cfg.clientUsername}'
    AND (${emailFilter(cfg.emailDomains)})
    AND timestamp >= '${from}'
    AND timestamp < '${to}'`
}

const topPathsQuery = (client: Client): string => {
  const cfg = CLIENTS[client]
  return `SELECT
    replaceRegexpOne(properties.url, '^(/[^/?]+(?:/[^/?]+)?).*$', '\\\\1') AS prefix,
    count() AS page_loads
  FROM events
  WHERE event = 'Page Load'
    AND properties.\`client-username\` = '${cfg.clientUsername}'
    AND (${emailFilter(cfg.emailDomains)})
    AND timestamp >= '${from}'
    AND timestamp < '${to}'
  GROUP BY prefix
  ORDER BY page_loads DESC
  LIMIT 15`
}

const CLIENT_LIST: readonly Client[] = ["bsmh", "ssm", "duke", "ucsf"]

console.log(`Probing PostHog for ${from} → ${to}\n`)

for (const client of CLIENT_LIST) {
  console.log(`========== ${client} ==========`)

  const totals = await runHogQL(totalsQuery(client), `${client}/totals`)
  const [totalLoads, distinctUsers, regionLoads] = totals.results[0] ?? [0, 0, 0]
  console.log(
    `  total page loads: ${totalLoads}, distinct users: ${distinctUsers}, region/unit loads: ${regionLoads}`,
  )

  const res = await runHogQL(buUuidQuery(client), `${client}/bu-uuids`)
  if (res.results.length === 0) {
    console.log("  no /regions|units/ URLs in window.")
  } else {
    console.log(
      `  distinct bu_uuids: ${res.results.length}\n  uuid | page_loads | distinct_users | first | last`,
    )
    for (const row of res.results) {
      console.log(`  ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]} | ${row[4]}`)
    }
  }

  if (Number(regionLoads ?? 0) < 10) {
    const paths = await runHogQL(topPathsQuery(client), `${client}/paths`)
    console.log(`  top URL prefixes:`)
    for (const row of paths.results) {
      console.log(`    ${row[0]} | ${row[1]}`)
    }
  }
  console.log("")
}
