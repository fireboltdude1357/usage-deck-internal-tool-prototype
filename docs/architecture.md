# Architecture

SvelteKit dashboard for 5–20 internal CS/Product users. One repo, deployed by
`git push` to Vercel. Two data sources: live PostHog (HogQL) for engagement
metrics, and pre-computed S3 snapshots for anything that needs RDS data.

```
Browser
  │  HTTPS, WorkOS-sealed wos-session cookie
  ▼
Vercel  (SvelteKit, single repo)
  ├─ +layout.server.ts ........ surfaces session to pages
  ├─ /platform-engagement ..... headline KPIs + monthly time series + top units
  ├─ /market-engagement ....... per-market bars (highlights selected market)
  ├─ /provisioned-users ....... Total + Lima KPIs, sortable user roster
  ├─ /api/auth/* .............. WorkOS login/callback/logout
  ├─ /api/posthog/* ........... live HogQL through Effect-wrapped client
  └─ /api/snapshot/* .......... auth-gated S3 (or fixture) read
        │                                    │
        │  IAM access key                     │  POSTHOG_API_KEY
        ▼                                    ▼
S3 (private)                          PostHog API (us.posthog.com)
   internal-tool-snapshots/             project 71649
   {client}/{YYYY-MM}/*.json
        ▲
        │  monthly, manual
Local machine (Tanner)
   scripts/snapshot/* — RDS bastion → CSV → schema-validated JSON → S3
```

## Server-side seams

These are the load-bearing modules. Every one of them is the **only** place
its concern is implemented; downstream code uses them through the seam.

### Auth — `src/lib/server/auth.ts` + `src/hooks.server.ts`

`hooks.server.ts` runs `requireSession` against every request, including
`+server.ts` routes (a `+layout.server.ts` load wouldn't cover those). The
only exemption is `/api/auth/*`, which can't require a session to function.

`requireSession` behavior:

- `AUTH_BYPASS=1` → returns `{ user: { email: "dev@local" } }`. Local-dev
  shortcut so the dashboard renders without a WorkOS round-trip.
- Otherwise loads the `wos-session` cookie via
  `workos.userManagement.loadSealedSession` and calls `session.authenticate()`.
- On `authenticated:false` with `reason: "invalid_jwt"` (the short-lived
  access token expired but the refresh token in the sealed cookie is still
  valid), calls `session.refresh()` and writes the new sealed session back
  to the cookie before continuing. This is the difference between a stale
  tab silently re-issuing a session and one bouncing through AuthKit every
  5–10 minutes.
- Page request (route id doesn't start with `/api/`) on miss → 302 to
  `/api/auth/login?return_to=…`.
- API request on miss → `error(401)`.
- Hard failures (unseal throws, refresh fails, or any non-`invalid_jwt`
  reason) clear the cookie before redirect/401, so the next request starts
  a fresh AuthKit handshake instead of looping on a sealed-but-rejected
  cookie.

WorkOS construction lives in `src/lib/server/workos.ts`. Module-scope
caching of the `WorkOS` instance, lazy `env` reads (so `AUTH_BYPASS=1` doesn't
require any `WORKOS_*` env vars to be set), and the
`isEmailAllowed` / `allowedEmailDomains` helpers backed by
`ALLOWED_EMAIL_DOMAINS` (defaults to `@atalantech.com`).

### Snapshot source — `src/lib/server/snapshot-source.ts`

`SnapshotSource` is an Effect `Context.Tag` with two Layers:

- `SnapshotSourceFixtures` (default) — reads from
  `fixtures/snapshots/{client}/{month}/{file}` on disk. Errors map to
  `{kind: "NotFound"}`.
- `SnapshotSourceS3` — `@aws-sdk/client-s3` `GetObjectCommand` against
  `${SNAPSHOT_BUCKET}/{client}/{month}/{file}`. Error mapping is **load-bearing**:
  - `NoSuchKey` (or HTTP 404) → `NotFound`
  - `JSON.parse` failure → `Decode`
  - everything else → `Upstream`

The route handler at `src/routes/api/snapshot/[client]/[month]/[file]/+server.ts`
maps those kinds to HTTP status: `NotFound` → 404, `Upstream` → 502, `Decode` →
500. Don't change one side of that mapping without changing the other.

`SnapshotSourceLive` selects the Layer at module-import time based on
`SNAPSHOT_SOURCE` (`s3` | anything else → fixtures). The S3 client is shared
across requests (`cachedClient`); a request with `SNAPSHOT_BUCKET` unset
returns 502 with a clear message rather than silently falling back.

### Schema — `src/lib/schema/snapshot.ts`

Single source of truth for snapshot JSON shape. Three envelopes
(`PlatformSnapshot`, `MarketSnapshot`, `ProvisionedUsersSnapshot`) plus
`SnapshotByFile` mapping `metrics.json` / `market_metrics.json` /
`provisioned_users.json` to the matching schema.

This file is the contract between *every* producer (the snapshot pipeline,
the PostHog aggregators, the fixture builder) and *every* consumer (the
three page loaders, the snapshot API route). Changing a field type without
updating every producer breaks page rendering loudly, which is the point —
the API route schema-validates on read.

`Client` literal is `"bsmh" | "ssm" | "duke" | "ucsf"`. `Market` is an open
string in the schema — the allow-list is per-client (see `$lib/markets`,
`MARKETS_BY_CLIENT`). BSMH has six geographic markets; SSM has seven regional
units (Wisconsin, St. Louis, Oklahoma, Mid-Missouri, Southern Illinois,
Corporate, Continuum of Care); Duke and UCSF have none — their dashboards
hide the market view entirely. `Month` is a regex-validated `YYYY-MM` string.

`PlatformMetrics` carries (in addition to `kpis` / `provider_views_by_month` /
`unit_views_by_month` / `top_units_viewed`) the Leaders' Retention Workflow
inputs: `risk_factor_views: {total, overview, drilldown, other}`,
`total_provider_views`, `total_unit_views`, `clinicians_monitored`,
`calendar_months`, `recurring_window_months`, `unique_users`,
`recurring_leaders`, `total_users_in_window`, `retention_rate`.
`MarketMetrics` carries the per-market `market_cards: Array<MarketCard>` with
the same retention-workflow fields scoped to one market, plus the unchanged
four `*_by_market` bar arrays for cross-market comparison.
`SuccessStoriesMetrics` carries `min_pre_procedures`, `available_months`,
and `providers: Array<SuccessStoryProvider>`. Each provider is the raw
per-month series — `monthly: Array<{month, procedures, work_rvu,
encounters, enc_duration, doc_time, admin_time, quit_prob}>` — plus
display metadata (name/specialty/category/department) and the resolved
`market` (null for clients without a BU mapping). Pre/post pairing, the
five-category scorecard (`turnover`, `volume`, `time_with_patients`,
`efficiency`, `rvu`), the `n_improvements` tally, and the market /
cohort filters are all derived **live** in
`src/lib/success-stories.ts` against the user-selected date range —
see § Success-stories analysis.

### PostHog client — `src/lib/server/posthog/`

| File | Role |
|---|---|
| `client.ts` | `runHogQL(query, opts)` — Effect-wrapped POST to `${POSTHOG_ENDPOINT}` with 30s timeout, exponential backoff (1s/2s/4s/8s, four retries) on `Network` / `Timeout` / `BadStatus` in {408, 425, 429, ≥500}. Every request is gated by a module-level semaphore with **permits=2**, below PostHog's per-team cap of 3 concurrent HogQL queries — this is the primary 429-avoidance mechanism; retries are the safety net. Returns `{ results, columns }`. `PostHogError` kinds: `Configuration` (no API key) / `Network` / `Timeout` / `BadStatus` / `Decode`. |
| `pagination.ts` | `fetchByMonth(start, end, buildQuery, label)` runs the same template once per calendar month with `concurrency: 4`. Each month that returns ≥ 100 rows (PostHog's default page limit) gets bisected up to depth 4 (~2-day chunks). Returns flattened rows + columns. |
| `queries.ts` | The six canonical HogQL templates: `providerViewEventsQuery`, `unitViewEventsQuery`, `monthlyUserActivityQuery`, `userActivityByMonthQuery`, `riskFactorViewEventsQuery`, and `successStoriesCohortQuery` (provider `legacy_id`s viewed in a window — used by `/success-stories` to gate the snapshot analysis live). All filter on `event = 'Page Load'` + `properties.\`client-username\`` + email-domain prefix + `timestamp` window. URL-era regex matches `/regions|units|physicians/units|nurses/units` — leaving any era out silently drops pre-Oct 2025 data. The risk-factor query classifies each row as `overview` / `drilldown` / `other` via `multiIf`. The cohort query carries an explicit `LIMIT 10000` because the HogQL API otherwise truncates at 100. |
| `aggregator.ts` | Pure functions: `buildPlatformSnapshot`, `buildMarketSnapshot`, `buildProvisionedSnapshot`. Take typed event arrays, return a snapshot object that validates against the matching schema. |
| `pipeline.ts` | `runPlatformPipeline` / `runMarketPipeline` / `runProvisionedPipeline` / `runSuccessStoriesCohortPipeline` — the public entry points. Each composes the right `fetch*` helpers, hands them to the aggregator, and decodes the result against the schema. The cohort pipeline returns a `{ provider_ids: string[] }` envelope and is the only one that doesn't go through an aggregator (the raw HogQL result is already the answer). |
| `cache.ts` | 15-minute in-process `Map` cache. Per-warm-instance only (one map per Vercel function). `cached(key, effect, { bypass })` — `bypass: true` skips the read but still writes the fresh value back. |
| `config.ts` | `POSTHOG_PROJECT_ID = "71649"`, `CLIENTS` (per-client `clientUsername` + `emailDomains` + provisioned-user counts), `BU_UUID_MARKET` (per-client `bu_uuid → market` map for the PostHog path). Re-exports `MARKETS_BY_CLIENT` from `$lib/markets` (browser-safe; the zero-fill list used by the aggregator). |

Caching strategy: each `fetch*` is independently cached by `(event-shape, client, range)`,
and each pipeline result is cached by `(metric, client, range)`. The pipeline
caches dedupe back-to-back identical requests; the per-fetch caches mean a
hit on `runPlatformPipeline(bsmh, …)` warms the provider/unit data for
`runMarketPipeline(bsmh, …)`. The Refresh button (top bar) bumps a nonce that
adds `?refresh=1` and triggers `bypass: true` at both layers.

### Behavior graph — `src/lib/behavior-graph/` + `src/routes/behavior-graph/`

Live PostHog page-load events → state-classified directed graph + synthesized sessions with animated step-through playback. Nothing is snapshotted; the data is cheap enough to compute live on every page load.

| Seam | Role |
|---|---|
| `src/lib/behavior-graph/classify-url.ts` | URL → state classifier. **Must match all 4 URL eras** (`/regions/`, `/units/`, `/physicians/units/`, `/nurses/units/`). Vendored from the parent investigation; canonical case table in `classify-url.test.ts`. |
| `src/lib/server/posthog/behavior-graph-query.ts` | Single HogQL query: page-load events for `(client, from, to)`, ordered by `(distinct_id, timestamp)`. |
| `src/lib/server/posthog/behavior-graph-builder.ts` | Pure: synthesizes sessions from 30-min inactivity gaps (PostHog's `$session_id` is unpopulated for the custom Page Load event); collapses consecutive duplicate states; counts directional transitions. Caps at 100 most-recent sessions with ≥3 page loads. |
| `src/lib/server/posthog/behavior-graph-pipeline.ts` | Effect pipeline, cached via the standard `cached()` helper. |
| `src/routes/api/posthog/behavior-graph/+server.ts` | Single GET endpoint returning `{graph, sessions}`. |
| `src/routes/behavior-graph/+page.{ts,svelte}` | Three-pane UI: filter rail / `@xyflow/svelte` canvas / sessions list. |
| `src/lib/behavior-graph/*.svelte` | `GraphCanvas` (dagre layout + drag persistence), `StateNode`, `CurvedEdge`, `SessionsList`, `SessionAnimator` (animejs step-through). |

Not done and not planned: friction shading (deferred), era selector (the time-range picker already covers it), snapshot path (live compute is fast enough).

## Frontend

`src/routes/+layout.svelte` mounts the top bar; `+layout.server.ts` surfaces
the session from locals. Three pages — `/platform-engagement`,
`/market-engagement`, `/provisioned-users` — each have a `+page.ts` that:

1. `depends("app:selection")` so the page reloads when `selection.set(...)` invalidates.
2. Tries `/api/posthog/{client}/{metric}?start=…&end=…` first.
3. Falls back to `/api/snapshot/{client}/{FIXTURE_SNAPSHOT_MONTH}/{file}` only if PostHog returned **503** (Configuration error). Other failures surface a `loadError`.
4. Decodes the response against the matching schema in `$lib/schema/snapshot.ts` before returning it.

Selection state (`system`, `market`, `start`, `end`) lives in `localStorage` under
`internal-tool:selection`, owned by `src/lib/selection.svelte.ts`. URLs stay
clean; only the route changes between pages. The `setSystem(client)` helper
is an atomic swap — it resets `market` to `"all"` and snaps `start`/`end` to
the client's `defaultRange()` (trailing 7 months from
`AVAILABLE_MONTHS[client]` in `src/lib/snapshot-months.ts`). `loadInitial()`
clamps any persisted payload against the same lists so older localStorage
state can't render a picker pointed at a month with no S3 object.

The market dimension is per-client (BSMH: 6 geographic markets, SSM: 7 SSM
Health regions, Duke/UCSF: none). `TopBar` hides `<MarketPicker />` whenever
`hasMarkets(selection.system)` is false (sourced from `$lib/markets`); the
`/market-engagement` page renders an empty-state card for those clients.
`TimeRangePicker` reads `AVAILABLE_MONTHS[selection.system]` reactively so its
dropdowns repopulate when the system changes.

UI primitives (`KpiTile`, `TimeSeries`, `CategoryBars`, `DataTable`,
`MarketPicker`, `SystemPicker`, `TimeRangePicker`, `TopBar`, `RefreshButton`)
live in `src/lib/ui/`. Visualizations use `layerchart`.

## Snapshot pipeline (offline producer)

`scripts/snapshot/*` is the monthly producer. Same `Schema` definitions as the
runtime, so a malformed export fails at write time before it can hit S3.

| Script | What it does |
|---|---|
| `query.ts` | Runs every `.sql` file under `rds/queries/` and `athena/queries/` (or the one named via `--query`, or scoped via `--source rds\|athena\|all`) with `{{client}}` / `{{month}}` placeholders, writes one CSV per query to `tmp/snapshot/{client}/{month}/`. RDS path opens an SSH tunnel via `rds/bastion.ts`; Athena path uses `@aws-sdk/client-athena` + the snapshot bucket as its `OutputLocation` (prefix `ATHENA_OUTPUT_PREFIX`, default `athena-results/`). |
| `athena/run-query.ts` | PHI block-list pre-flight (substring scan against the CLAUDE.md list) → `StartQueryExecution` → poll `GetQueryExecution` every 2s (max 180s) → `S3 GetObject` on the `{qid}.csv` result → write to local CSV. Optional `-- @database: <name>` header comment overrides `ATHENA_DATABASE` per file. |
| `build.ts` | Reads `clinician-roster.csv`, runs the `shape/roster.ts` aggregators, schema-validates via `schema-roundtrip.ts`, writes `metrics.json` / `market_metrics.json` / `provisioned_users.json` to the same `tmp/snapshot/...` dir. If the five success-stories input CSVs (`provider-metadata`, `quit-prob-trajectories`, `claims-monthly`, `encounters-monthly`, `ehr-monthly`) are all present, also runs `shape/success-stories.ts` (which takes the roster CSV for market lookup) and writes `success_stories.json` carrying the raw per-provider per-month series. Otherwise the success-stories job is skipped quietly. `--file <name>` scopes the build to a single output. |
| `upload.ts` | Re-validates the local JSON, `PutObjectCommand`s to `s3://${SNAPSHOT_BUCKET}/{client}/{month}/{file}` with `Cache-Control: public, max-age=31536000, immutable`. `--file <name>` uploads only one of the four; `--dry-run` prints what it would PUT. |
| `backfill-all.sh` | One-shot orchestrator that wipes `s3://${SNAPSHOT_BUCKET}/{bsmh,ssm,duke,ucsf}/` and re-runs query/build/upload for the hard-coded `(client, run_date)` list (derived from the 2026-05-11 probe of `provider_quit_risk_v2`). Roster-only — does not generate `success_stories.json`. |
| `backfill-success.sh` | Builds `success_stories.json` once per client (at the client's canonical / latest run-date) and uploads it to that single month-prefix only. The snapshot carries the full per-provider per-month series, so the page loader picks up the same file regardless of which month-key the picker has selected. Skips clients whose roster yields zero providers. |

Both runtime and pipeline share the same `SNAPSHOT_AWS_*` IAM key today
(Tanner's prototype identity). Splitting the reader to a dedicated read-only
principal scoped to `internal-tool-snapshots/*` is a deferred security
hardening item — see `archive/design/05-workos-setup/PLAN.md`.

Athena queries live in `scripts/snapshot/athena/queries/` and run through the
SDK path described above. Currently used for the success-stories pipeline
(per-provider per-month features from `sql_outputs.monthly_claims_features` /
`monthly_encounters_features` / `ehr_usage_features`). Partition keys on
those three tables are `(client, run_date, batch_ds)`. The monthly queries
filter on `client` only — pre/post pairing is derived live in the page
loader from the picker range, so the snapshot needs the full per-month
series. `feature_ds` is a regular column and won't prune by itself.

### Success-stories analysis — raw snapshot + live derivation

The page is a **hybrid**:

- **Snapshot producer** — `scripts/snapshot/shape/success-stories.ts`
  joins six CSVs (RDS roster, RDS metadata, RDS monthly quit-prob, three
  Athena monthly feature tables) into one record per provider with the
  raw per-month series (`procedures`, `work_rvu`, `encounters`,
  `enc_duration`, `doc_time`, `admin_time`, `quit_prob`). The roster CSV
  is the source of the `market` field; everything else is keyed on
  `provider_id`. No pre/post pairing, no improvement scoring, no
  filtering — the snapshot is the unfiltered raw input.
- **Live derivation** — `src/lib/success-stories.ts` exposes
  `splitWindow(start, end, available)` and `deriveProviders(providers,
  pre, post, opts)`. The page loader
  (`src/routes/success-stories/+page.ts`) reads `selection.start` /
  `selection.end` (the TimeRangePicker), splits the range in half (floor
  pre, ceil post — post gets the longer side on odd counts), then runs
  each provider's monthly series through the five-category scorecard
  (turnover, patient volume = procedures OR encounters up, time with
  patients = encounter duration up, workflow efficiency = doc time OR
  admin time down, work RVUs). The pre-window procedure gate
  (`min_pre_procedures = 10`) and the providers-missing-trajectory drop
  happen here. Sort order: `n_improvements` desc, then `turnover.pct`
  asc.
- **Live cohort** — `successStoriesCohortQuery` in
  `src/lib/server/posthog/queries.ts` returns provider `legacy_id`s
  viewed in the picker range, exposed at
  `/api/posthog/[client]/success-stories-cohort?start=…&end=…` via
  `runSuccessStoriesCohortPipeline`. The page intersects this with the
  derived providers; PostHog 503 falls through to an un-cohort-gated
  view with a banner.

The page hides itself behind a "widen your range" empty state when the
selection covers fewer than 2 months (one pre + one post is the minimum).
The market filter (`selection.market`) is applied at derive time;
providers without a mapped market are dropped when a specific market is
selected.

### Per-month query semantics

`clinician-roster.sql` and `provider-metadata.sql` filter on
`run_date = ({{month}} || '-01')::date`. A `{{month}}` with no matching
`run_date` returns zero rows; `build.ts` then fails on the empty roster.
That's the intended failure mode — every month-key in S3 is backed by an
actual model run rather than a silently-stale most-recent fallback.

The trajectory + monthly feature queries
(`quit-prob-trajectories.sql`, `claims-monthly.sql`,
`encounters-monthly.sql`, `ehr-monthly.sql`) **do not** filter on
`{{month}}` — they return every month the client has data for, and the
page loader splits pre/post live from the picker range.

## Hard rules carried forward

- **PHI block-list** — never query `patient_id`, `encounter_id`, `claim_id`,
  `procedure_id`, `message_id`, `thread_id`, `source_msg_id`,
  `hospital_account_id`, `primary_encounter_id`. Enforced at query-build time.
- **No `SELECT *`** on PHI-containing tables.
- **PostHog URL eras** — every URL regex must match
  `/regions/`, `/units/`, `/physicians/units/`, and `/nurses/units/`. Missing
  any era silently drops pre-Oct 2025 data.
- **RDS > Athena source priority** when a metric exists in both.
- **Athena partition pruning** — every `dbt_dev_gold.gold_model_output` query
  must filter on `partition_date`. Every `sql_outputs.monthly_*` /
  `sql_outputs.ehr_usage_features` query must filter on `client` + `batch_ds`
  (those tables' partition keys are `(client, run_date, batch_ds)`).
- **Athena `output_type` casing is lowercase** (`quit_probability`, `shap_value`).
- **Credentials never in the browser bundle.** Vercel env vars live in server
  code only; never expose anything via `VITE_*` except non-secret URLs.

## Deferred

Documented for context — none of these are blocking but every one was
considered and parked.

- **CloudFront in front of S3** — at 5–20 users with sub-100 KB monthly JSON,
  edge caching isn't load-bearing. Worth doing only if egress becomes a line item.
- **Real Google Workspace SSO** — phase 05 shipped with AuthKit + Google as a
  *social* provider plus an `@atalantech.com` allowlist. Moving to a Workspace
  SSO connection requires the SSO admin conversation and lets WorkOS enforce
  the domain check natively.
- **Dedicated read-only IAM principal** for the snapshot reader (see above).
- **Automated monthly snapshot run** — GitHub Actions / EventBridge / Lambda.
  Manual local cadence is fine until format and cadence are settled.
- **Sub-monthly data freshness, arbitrary date-range UI in v1, IndexedDB
  caching, multi-region.** None match the use case.
