import type { Client } from "$lib/schema/snapshot"
import { CLIENTS } from "./config"

const emailFilter = (domains: readonly string[]): string =>
  domains.map((d) => `distinct_id LIKE '%${d}'`).join(" OR ")

export const pageLoadEventsForBehaviorGraphQuery = (
  client: Client,
  from: string,
  to: string,
): string => {
  const cfg = CLIENTS[client]
  return `SELECT
  timestamp,
  distinct_id,
  properties.url AS url
FROM events
WHERE event = 'Page Load'
  AND properties.\`client-username\` = '${cfg.clientUsername}'
  AND (${emailFilter(cfg.emailDomains)})
  AND timestamp >= '${from}'
  AND timestamp < '${to}'
  AND NOT match(properties.url, '^/(ingest|_admin)')
ORDER BY timestamp DESC
LIMIT 20000`
}
