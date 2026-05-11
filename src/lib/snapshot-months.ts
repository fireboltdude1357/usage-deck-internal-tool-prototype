import type { Client, Month } from "$lib/schema/snapshot"

// Latest month each client has in S3 (the most-recent `run_date` in
// `public.provider_quit_risk_v2` at the 2026-05-11 backfill). The page
// loaders use this as the fallback snapshot month when PostHog is 503,
// the roster-merge month on the live path, and the only available month
// for the snapshot-only success-stories page.
//
// When a new model run lands in RDS, re-run `scripts/snapshot/backfill-*.sh`
// and bump the matching entry here. Also append the new month to
// AVAILABLE_MONTHS below — the module-load assert at the bottom of this
// file catches drift between the two.
export const LATEST_SNAPSHOT_MONTH: Record<Client, Month> = {
  bsmh: "2026-03",
  ssm: "2026-03",
  duke: "2025-12",
  ucsf: "2025-06",
}

// Every month each client has a snapshot in S3 for. The TimeRangePicker
// reads this to populate its dropdowns; defaultRange() picks the trailing
// 7-month window when a client is selected. `scripts/snapshot/backfill-all.sh`
// also derives its (client, month) iteration list from this object — so
// this is the single source of truth for which months exist. To backfill a
// new month, append it here (bump LATEST_SNAPSHOT_MONTH if it's the new
// tail), then run backfill-all.sh.
export const AVAILABLE_MONTHS: Record<Client, readonly Month[]> = {
  bsmh: [
    "2025-08", "2025-09", "2025-10", "2025-11",
    "2025-12", "2026-01", "2026-02", "2026-03",
  ],
  ssm: ["2025-12", "2026-01", "2026-02", "2026-03"],
  duke: [
    "2023-08", "2023-09", "2023-10", "2023-11", "2023-12",
    "2024-01", "2024-02", "2024-03", "2024-04", "2024-05",
    "2024-06", "2024-07", "2024-08", "2024-09", "2024-10",
    "2024-11", "2024-12",
    "2025-01", "2025-02", "2025-03", "2025-04", "2025-05",
    "2025-06", "2025-07", "2025-08", "2025-09", "2025-10",
    "2025-11", "2025-12",
  ],
  ucsf: [
    "2023-07", "2023-08", "2023-09", "2023-10", "2023-11", "2023-12",
    "2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06",
    "2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12",
    "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  ],
}

// Default range = trailing 7 months ending at the latest available month.
// Small enough to keep PostHog queries fast, long enough to show a trend.
export const defaultRange = (client: Client): { start: Month; end: Month } => {
  const ms = AVAILABLE_MONTHS[client]
  return {
    start: ms[Math.max(0, ms.length - 7)],
    end: ms[ms.length - 1],
  }
}

// Drift guard: the last entry of each AVAILABLE_MONTHS list is the same
// month the loaders use for roster merge and snapshot-only pages. If they
// diverge a TimeRangePicker selection of the latest month can fetch a
// non-existent S3 key. Better to fail at module load than at runtime.
for (const c of Object.keys(LATEST_SNAPSHOT_MONTH) as Client[]) {
  const tail = AVAILABLE_MONTHS[c].at(-1)
  if (tail !== LATEST_SNAPSHOT_MONTH[c]) {
    throw new Error(
      `snapshot-months: LATEST_SNAPSHOT_MONTH[${c}]=${LATEST_SNAPSHOT_MONTH[c]} ` +
        `but AVAILABLE_MONTHS[${c}].at(-1)=${tail}`,
    )
  }
}
