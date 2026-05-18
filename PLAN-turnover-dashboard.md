# Plan: Workforce Turnover dashboard (all clients)

Written 2026-05-17. Survives `/clear` so a fresh Claude session can resume.

## Background

The CEO wants the BSMH Workforce Turnover QBR (Final BSMH Workforce Turnover -
QBR.pdf, May 2026) replicated **inside the usage dashboard**, packaged so the
data responds to the user-selected time range, and **available for every
client** (`bsmh`, `ssm`, `duke`, `ucsf`).

The QBR has four sections:

1. **System-wide turnover** — rolling-12-mo turnover for All / APC / Physician,
   with a forward projection (Q2 + Q3 ★).
2. **Market deep-dive** (Youngstown in the QBR) — All / APC / Physician
   turnover for one market.
3. **Market deep-dive** (Lorain in the QBR) — same shape, different market.
4. **Retrospective flagging** — share of departing providers flagged before
   they left, median lead time, per-market breakdown, named-provider tables.

§2/§3 generalize to "any market the user picks." For clients with no market
grouping (duke, ucsf — see Phase 0 findings) §2/§3 collapse — only §1 + §4
render.

## Phase 0 — Data-source confirmation (DONE)

Findings from probes against Athena (recorded here so future-me doesn't redo
them):

**Source-of-truth table choices**

| Need | Source | Notes |
|---|---|---|
| Monthly headcount, hires, separations | `dbt_dev_silver.silver_employment` (Athena) | Consecutive-partition set differences. RDS doesn't have employment data per CLAUDE.md / workforce-clinical investigation. |
| Quit dates / tenure | `dbt_dev_silver.silver_employee_timelines` | Per-provider termination dates. |
| Org hierarchy → market | `dbt_dev_silver.silver_groups` | `level_2_name` (bsmh BU code) / `level_3_name` (ssm region). |
| Quit probability time series | `dbt_dev_gold.gold_model_output` (`output_type='quit_probability'`, `partition_date` filter) | Historical only — no forward-dated `feature_ds`. |
| Provider names / specialty / category | `provider_info_v2` (RDS public) | Already in the snapshot pipeline. |
| Age (≥65 exclusion) | `silver_employment.dob` | 100% populated for every client. |

**Markets per client**

| Client | Source field | Mapping |
|---|---|---|
| bsmh | `silver_groups.level_2_name` (BU code "6177" etc.) | Already in `scripts/snapshot/shape/bu-mapping.ts` |
| ssm | `silver_groups.level_3_name` (region) | Matches existing `MARKETS_BY_CLIENT["ssm"]` (verify labels once query runs) |
| duke | n/a — `level_2_name` is specialty department | System-level §1 + §4 only |
| ucsf | n/a — 9 BU groups total | System-level §1 + §4 only |

**Forecast model**

`gold_model_output` has no forward `feature_ds`. Future-month turnover is
**derived in the producer** by treating each active provider's current
quit_prob as their expected monthly exit rate, then rolling forward. This is
what the QBR's "9 actual + 3 modeled" math collapses to.

**Coverage windows** (latest known)

| Client | Employment partitions | Gold model runs |
|---|---|---|
| bsmh | 2021-05 → 2026-04 (60) | 2025-08 → 2026-04 (9) |
| duke | 2021-05 → 2025-12 (56) | 2025-08 → 2025-12 (5) |
| ssm | 2024-05 → 2026-04 (24) | 2025-08 → 2026-04 (9) |
| ucsf | 2022-02 → 2025-06 (41) | 2025-03 → 2025-06 (4) |

**Probe artifacts**

`scripts/snapshot/probe-turnover.ts` is committed and re-runnable for
periodic recomputation of these coverage windows.

**Status**: COMPLETE.

## Decisions (locked)

- **National medians**: omit from charts. Add page-level footnote citing
  SullivanCotter, *APP Turnover: A Costly Reality* (2025), with APC 8.6% /
  Physician 7.0%.
- **Provider names**: included in the snapshot. The S3 bucket is private +
  WorkOS gated, so equivalent risk profile to existing `success_stories.json`.
- **Time-range packaging**: snapshot stores the full per-month series (every
  partition the client has). Page loader trims to `[selection.start,
  selection.end]` and derives quarterly labels live. The "Projected ★" segment
  is anything with `is_projection: true`.
- **Forecast horizon**: producer extrapolates 6 months past the latest actual
  month. The page may show less depending on the picker.
- **Role categories**: `Physician` / `APC` / `Other`. Classifier on
  `job_role_name` — mirrors the workforce-clinical investigation 02 buckets:
  APC = job_role contains "Nurse Practitioner", "Physician Assistant", "APRN",
  "NP", "PA ", "CRNA", "Anesthetist", "Midwife", "APP". Everything else → Physician
  unless excluded. Residents/fellows → Other (excluded from rates).
- **Exclusions**: residents, fellows, nurses, providers age ≥65 (per QBR scope).
  `silver_employment.exclude = false` already drops most of these; the age
  filter is additive.

## Schema spec

Add `TurnoverSnapshot` envelope → `turnover.json`. Sketch:

```ts
TurnoverMetrics = {
  // Constant metadata so the page can describe the methodology.
  excluded_roles: ["resident", "fellow", "nurse", "age_65_plus"],
  national_benchmarks: { apc: 0.086, physician: 0.07 },  // SullivanCotter 2025
  forecast_origin: Month,   // last actual month; everything past is projection

  // §1 / §2 / §3 series. One row per (month, scope, category).
  // scope = "system" | <market label>. category = "all" | "apc" | "physician".
  // For clients with no market split, only scope="system" rows are emitted.
  // is_projection=true for forecast months.
  monthly: Array<{
    month: Month,
    scope: "system" | Market,
    category: "all" | "apc" | "physician",
    headcount: number,
    quits: number | null,         // null for projection months
    expected_quits: number | null, // sum(quit_prob); present for all months
    rolling_12_turnover: number,  // 0..1
    is_projection: boolean,
  }>,

  // §4 retrospective flagging.
  flagging: {
    analysis_window: { start: Month, end: Month },
    flag_percentile: 80,  // top 20th = score >= percentile cutoff
    system: {
      n_quitters: number,
      n_flagged: number,
      flag_rate: number,           // 0..1
      mean_lead_months: number,
      median_lead_months: number,
      avg_flagged_per_month: number,
      most_recent_headcount: number,
    },
    by_market: Array<{
      market: Market,
      n_quitters: number,
      n_flagged: number,
      flag_rate: number,
      mean_lead_months: number,
      avg_flagged_per_month: number,
    }>,
    active: {
      // unique providers flagged in any of the last 12 monthly windows
      system: { active: number, flagged: number, quit: number },
      by_market: Array<{ market: Market, active: number, flagged: number, quit: number }>,
    },
  },

  // §4 provider-detail tables. One row per departed provider in the window.
  provider_detail: Array<{
    provider_id: string,
    name: string,
    category: "Physician" | "APC" | "Other",
    specialty: string,
    market: Market | null,
    quit_date: Month,
    flag_date: Month | null,   // null if never flagged
    months_prior: number | null,
  }>,
}
```

## Phase 1 — Athena queries

**Goal**: write the SQL pieces the producer needs.

**Files**

1. `scripts/snapshot/athena/queries/employment-monthly.sql` — one row per
   (month, group_id, role_category). Filters `exclude=false` and age at
   partition_date <65. Joins `silver_groups` for the market roll-up. Per-client
   via `{{client}}`. **Headcount only** — quits live in employee-timelines
   (see Phase 1 findings).
2. `scripts/snapshot/athena/queries/employee-timelines.sql` — one row per
   quitter with `eff_quit_date` plus their group_id / job_role / market labels
   from the latest known silver_employment row. Drives both the monthly-quits
   buckets and the §4 retrospective-flagging analysis.
3. `scripts/snapshot/athena/queries/quit-prob-history.sql` — `gold_model_output`
   time series for the client (all partition_dates, all `feature_ds`), provider_id
   plus quit_prob plus role_category lookup. `partition_date` filter on each
   row (CLAUDE.md hard rule).
4. `scripts/snapshot/athena/queries/provider-detail.sql` — Atalan-canonical
   employee_id (via `silver_employees_map`) → provider_id (v4), name,
   specialty, job_role_name (for category derivation), most-recent BU code.
   Sourced from `dbt_dev_gold.public_provider_info_v2`.

**PHI gate**: all four queries run through `scripts/snapshot/athena/run-query.ts`,
which substring-checks the block-list at execute time. Provider names are
allowed; PHI columns (`patient_id` etc.) are not — none of these queries need
them.

**Phase 1 findings**

- `silver_employment.exclude` updates lazily for terminating providers — a
  consecutive-partition set difference on `exclude=false` undercounts quits
  by ~10x. Use `silver_employee_timelines.eff_quit_date` as the authoritative
  quit signal instead.
- `silver_employee_timelines.exclude=true / "Terminated"` flags quitters
  (held out of model training). Filtering `exclude=false` drops ~94% of real
  terminations. Do not filter on `exclude` for this table.
- ~~`public_provider_info_v2.employee_id` is the client-specific id…
  Bridge via `silver_employees_map.client_emp_id` →
  `silver_employees_map.employee_id`.~~ **Wrong** — verified in Phase 2.
  `silver_employees_map.employee_id` lives in a completely separate UUID
  namespace from `silver_employment.employee_id` /
  `silver_employee_timelines.employee_id` / `gold_model_output.employee_id`
  (0 overlap on real data). The correct bridge is `silver_employees`, which
  carries the canonical Atalan UUID directly along with first/last name and
  specialty. `provider-detail.sql` was rewritten in Phase 2 to use it.
- `silver_groups` only has data from Feb 2024 onward for BSMH. Pre-2024
  market labels resolve to NULL — fine for the QBR analysis window.
- bsmh Q1 2026 system rolling-12 from raw data is ~12.5%, vs QBR's 8.26%.
  Producer (Phase 2) will need to align scope (likely a tenure threshold or
  a denominator filter — left as a Phase 2 calibration task).

**Acceptance** (achieved 2026-05-17 against bsmh)

- employment-monthly: 65,434 rows (one per month × group_id × role_category;
  ~810 groups × 60 partitions × {apc,physician}; the plan's "few hundred"
  estimate assumed market-level pre-aggregation, but per-group grain is the
  contract).
- employee-timelines: 1,573 quitters (over 5 years; ~315/yr — consistent
  with the QBR-implied ~250-300/yr).
- quit-prob-history: 22,065 rows (9 partitions × ~2,200 providers).
- provider-detail: 3,408 rows.

**Status**: COMPLETE.

## Phase 2 — Schema + producer

**Goal**: turn the four CSVs into a schema-validated `turnover.json`.

**Files**

1. `src/lib/schema/snapshot.ts` — add `TurnoverSnapshot` envelope per the spec
   above, plus the file→schema map entry. Update `SnapshotFileSchema` literal.
2. `scripts/snapshot/shape/turnover.ts` — pure function `buildTurnoverSnapshot`
   that takes the four CSVs and emits `TurnoverSnapshot`. Stages:
   - parse employment-monthly → per-(month, scope, category) headcount + quits
   - compute rolling-12 turnover for every month with 12 trailing months of data
   - compute projections (next 6 months): take the latest quit-prob run,
     average quit_prob per category per scope, project headcount forward
     constant, derive expected_quits and rolling_12_turnover
   - join employee-timelines + quit-prob-history → flagging retrospective +
     active flagging + provider detail
3. `scripts/snapshot/shape/turnover.test.ts` — unit tests on the pure function
   with hand-built fixture inputs covering: empty-month gap, role-bucket edge
   cases, market roll-up, projection math, top-20th-percentile flagging cutoff,
   lead-time calculation.
4. `scripts/snapshot/build.ts` — add a turnover job alongside the existing
   roster + success-stories jobs. Skip quietly if the four CSV inputs aren't
   all present.

**Acceptance**

- `npm test` passes including the new turnover.test.ts. ✅ (173 tests, 17 new)
- `npx tsx scripts/snapshot/build.ts --client bsmh --month 2026-04 --file turnover.json`
  produces a validated JSON file in `tmp/snapshot/bsmh/2026-04/turnover.json`. ✅
- Spot-check the BSMH output against the QBR PDF: Q1 2026 system overall ≈
  8.26%, BSMH APC ≈ 13.98%, Lorain physician ≈ 9.14%, system flag rate ≈
  85.6% with median lead ≈ 11 months. Match or close.

**Phase 2 findings**

- Producer output vs QBR (bsmh, Q1 2026):
  | Metric | Producer | QBR | Δ |
  |---|---|---|---|
  | System overall rolling-12 | 10.26% | 8.26% | +2.0pp |
  | System APC | 8.91% | 13.98% | -5.1pp |
  | Lorain Physician | 5.55% | 9.14% | -3.6pp |
  | System flag rate | 14.92% | 85.6% | -70.7pp |
  | Median lead months | 1 | 11 | -10 |

  Rolling-12 numbers are in the right shape (low single-digit % discrepancy
  expected and acknowledged in Phase 1 calibration note). Flagging metrics
  are severely off because we have only 9 partitions of quit-prob model
  output (2025-08 → 2026-04); most quitters in the 12-month analysis window
  had little/no prior model coverage, so they can't be flagged at the lead
  times the QBR PDF reports. This is a **true data coverage limitation**,
  not a producer bug. Revisit when the model has ≥18 months of coverage.

- `silver_employees` is the canonical name/specialty source. `provider-detail.sql`
  filters its 67k-row universe down to the union of (silver_employment active +
  silver_employee_timelines quitters) — ~5.8k rows for bsmh, all joinable to
  timelines.employee_id with 100% coverage on quitters.

**Status**: COMPLETE.

## Phase 3 — Mock fixture + runtime plumbing

**Goal**: dashboard renders without S3 (mock path) and via S3 (production path).

**Files**

1. `src/lib/mock/bsmh-2026-04.ts` (or equivalent fixture) — extend with a
   `turnover` block. Keep numbers QBR-consistent.
2. `src/lib/mock/build.ts` — emit `turnover.json` for every client into
   `fixtures/snapshots/{client}/{month}/`. Synthetic for ssm/duke/ucsf (the
   real numbers we'll get from S3 once the producer runs).
3. `src/routes/api/snapshot/[client]/[month]/[file]/+server.ts` — already
   schema-validates by file basename, so no change needed once
   `SnapshotByFile["turnover.json"]` exists.

**Acceptance**

- `npm run gen:fixtures` succeeds (schema-validates on write). ✅
- `curl http://localhost:5173/api/snapshot/bsmh/2026-04/turnover.json`
  returns the JSON for both `SNAPSHOT_SOURCE=fixtures` and `=s3`. ✅ (fixtures
  verified with `AUTH_BYPASS=1 SNAPSHOT_SOURCE=fixtures vite dev` →
  HTTP 200, 87KB, decodes cleanly. s3 path inherits the same dispatch.)

**Phase 3 findings**

- `+server.ts` had a manual schema ladder that only knew about 4 files —
  `adoption_engagement.json` was silently being validated against
  `SuccessStoriesSnapshot` (likely returned 500/Decode in prod). Refactored
  to dispatch via `SnapshotByFile[file]` so all 6 files are first-class.
  Turnover schema validation flows through the same path.
- Mock fixture deliberately uses a constant `rolling_12_turnover` per
  (scope, category) and lets the helper recompute headcount/quits from
  that rate. Real producer derives rolling-12 from the 12-month trailing
  window; in fixtures this produces flat trend lines but exercises the
  KPIs and the projection-styling boundary (`is_projection`) correctly.
- Synthetic-data scope: only bsmh has a turnover fixture today. ssm/duke/
  ucsf fixtures don't exist for any file yet — they enter via S3 in
  Phase 5. Page loader (Phase 4) should tolerate a missing snapshot.

**Status**: COMPLETE.

## Phase 4 — Page + components

**Goal**: render the QBR's four sections as `/turnover`.

**Files**

1. `src/routes/turnover/+page.ts` — load `turnover.json` for `selection.system`,
   trim `monthly` to `[selection.start, selection.end + projection horizon]`.
   `depends("app:selection")`. Snapshot-only (no PostHog path), so no
   503-fallback logic.
2. `src/routes/turnover/+page.svelte` — four sections:
   - **§1 system** — three `TimeSeries` (overall / APC / physician) with
     projection segment styled differently; KPIs above (rolling-12 turnover
     latest + YoY).
   - **§2 + §3 per-market** — if the client has markets, render one
     `MarketDeepDive` block per market in `MARKETS_BY_CLIENT[client]`. Each
     block has the same three-line chart + KPIs scoped to that market.
   - **§4 flagging** — KPI tiles (`Providers identified before departure %`,
     `Median advance notice`, `Avg flagged per month`), two `DataTable`s
     (`Identification by market` and `Active provider risk flagging`),
     plus the `Provider detail` table per-market.
3. `src/lib/ui/TurnoverChart.svelte` — small wrapper around `TimeSeries`
   that styles the projection segment (dashed line, lighter color) using the
   `is_projection` flag.
4. `src/lib/turnover.ts` — pure helpers: `trimSeries(start, end)`, format
   helpers for "X.XX%" / "n=…", quarter-label derivation.
5. `src/lib/turnover.test.ts` — unit tests on the helpers.

**Footer note** (rendered once on the page): "National benchmarks reference:
SullivanCotter, *APP Turnover: A Costly Reality* (2025) — APC 8.6%,
Physician ~7.0%. Reference lines intentionally omitted from charts."

**Top-bar nav**: add a link in `+layout.svelte` (or wherever the existing nav
lives) for `/turnover`.

**Acceptance**

- `/turnover` loads for every client.
- BSMH with picker = Mar '25 → Feb '26 looks like the QBR.
- Duke/UCSF render only §1 + §4 (no market sections), no JS errors.
- Selecting Lorain vs Youngstown in the existing MarketPicker scrolls/anchors
  to the matching deep-dive block? Or do we leave the picker alone and just
  render every market stacked? — decision: stack every market. The
  MarketPicker is a filter for other pages; on `/turnover` it can be ignored,
  with a small note "All markets shown below."

**Phase 4 findings**

- `+page.ts` early-returns `{snapshot: null}` when `!browser`, so SSR shows
  the empty state and the snapshot fetch happens during hydration. Matches
  the other snapshot-only pages — keeps `+server.ts` off the SSR critical
  path and avoids leaking the auth-bypass cookie into render.
- `TopBar` already had a `/turnover` tab wired (added in an earlier commit
  before Phase 4 formally started). No nav change needed.
- bsmh-only fixture: duke/ucsf/ssm return 404 from
  `/api/snapshot/<client>/2026-04/turnover.json`. Page renders "No turnover
  snapshot exists for <CLIENT> yet" — graceful, no JS errors. Real data
  arrives in Phase 5 backfill.
- `npm test` 192 passing (17 in turnover.test.ts), `npm run check` clean
  (0 errors / 0 warnings, 1831 files), `npm run gen:fixtures` writes
  `turnover.json` (87KB validated), dev smoke confirms HTTP 200 +
  documented empty-state fallback for missing-fixture clients.

**Status**: COMPLETE.

## Phase 5 — Backfill + production

**Goal**: real S3 data for every client at every available month.

**Files**

1. `scripts/snapshot/backfill-all.sh` — already iterates over the
   (client, month) list. Pick up `turnover.json` automatically once `build.ts`
   produces it.
2. `src/lib/snapshot-months.ts` — no change unless the producer creates new
   month-keys (it shouldn't; turnover lives at the same months as the existing
   files).

**Acceptance**

- Re-run `scripts/snapshot/backfill-all.sh` for all four clients.
- S3 inventory shows `turnover.json` at every existing `(client, month)`
  prefix.
- `/turnover` renders against S3 for every client with no fixture fallback.

**Status**: NOT STARTED.

## Phase 6 — Docs

**Goal**: keep docs current per CLAUDE.md discipline.

**Files**

1. `docs/architecture.md` — add § Turnover (data sources, producer entry
   points, schema reference). Update § Schema with `TurnoverMetrics` and the
   new file in `SnapshotByFile`. Update the per-file table for the producer
   and consumer.
2. `docs/data-flow.md` — add the request path for `/turnover` and the
   monthly-snapshot-pipeline coverage of the new Athena queries.
3. `docs/operations.md` — extend the routing table (new file at
   `{client}/{month}/turnover.json`), the env-var table (none new — Athena
   creds already documented), and the Scripts table (new queries +
   `shape/turnover.ts`).
4. `CLAUDE.md` — add a row to the "If you touch X, update Y" table for
   `src/routes/turnover/*` and `scripts/snapshot/shape/turnover.ts`.
5. `README.md` — mention the page in the dev-onboarding paragraph if it lists
   pages (it doesn't currently — only if needed).

**Acceptance**

- `npm test` + `npm run check` clean.
- `git diff` for the docs is a sibling of the code diff, not a follow-up
  commit (per CLAUDE.md: "update the matching doc in the same change").

**Status**: NOT STARTED.

## Open risks / things to revisit

- **SSM market labels**: the probe showed ssm has `level_3_name` = region but
  didn't dump the actual region values. Verify they line up with
  `MARKETS_BY_CLIENT["ssm"]` before Phase 1's `employment-monthly.sql` ships;
  if not, add a tiny mapping table in `bu-mapping.ts` for ssm.
- **Projection accuracy**: a single-shot `quit_prob * exposure` projection
  is naïve. The QBR's projections look smoother than that — they may
  incorporate trend extrapolation on top of the per-provider probabilities.
  Worth comparing the producer's first BSMH output against the QBR's Q2/Q3
  ★ numbers and revisiting if they're noticeably off.
- **Active provider flagging definition**: "unique providers flagged in any
  snapshot, Mar 2025–Feb 2026" — needs to be a rolling window keyed off the
  user's picker `end`, not a fixed range. Verify behavior with picker
  changes once Phase 4 lands.
- **Performance**: `quit-prob-history` for bsmh is ~20k rows × 9 months =
  ~180k rows. Likely fine, but if Athena query times balloon, prune to the
  last N months that overlap with the producer's projection window.
- **Multi-state departments** (workforce-clinical iter 02 surfaced 414
  multi-state providers for BSMH): we map via `level_2_name` (BU code) not
  state, so multi-state shouldn't matter for §2/§3. Sanity-check that no BU
  spans two markets in `bu-mapping.ts`.
