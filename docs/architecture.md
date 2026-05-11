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
- Otherwise unseals the `wos-session` cookie via
  `workos.userManagement.authenticateWithSessionCookie`.
- Page request (route id doesn't start with `/api/`) on miss → 302 to
  `/api/auth/login?return_to=…`.
- API request on miss → `error(401)`.
- Bad cookie (unseal throws or `authenticated:false`) → cookie gets cleared
  before redirect/401, so the next request starts a fresh AuthKit handshake
  instead of looping on a sealed-but-rejected cookie.

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

`Client` literal is `"bsmh" | "ssm" | "duke" | "ucsf"`. `Market` literal is
the six BSMH markets. `Month` is a regex-validated `YYYY-MM` string.

`PlatformMetrics` carries (in addition to `kpis` / `provider_views_by_month` /
`unit_views_by_month` / `top_units_viewed`) the Leaders' Retention Workflow
inputs: `risk_factor_views: {total, overview, drilldown, other}`,
`total_provider_views`, `total_unit_views`, `clinicians_monitored`,
`calendar_months`, `recurring_window_months`, `unique_users`,
`recurring_leaders`, `total_users_in_window`, `retention_rate`.
`MarketMetrics` carries the per-market `market_cards: Array<MarketCard>` with
the same retention-workflow fields scoped to one market, plus the unchanged
four `*_by_market` bar arrays for cross-market comparison.

### PostHog client — `src/lib/server/posthog/`

| File | Role |
|---|---|
| `client.ts` | `runHogQL(query, opts)` — Effect-wrapped POST to `${POSTHOG_ENDPOINT}` with 30s timeout, exponential backoff (500ms / 1s / 2s, two retries) on `Network` / `Timeout` / `BadStatus ≥ 500`. Returns `{ results, columns }`. `PostHogError` kinds: `Configuration` (no API key) / `Network` / `Timeout` / `BadStatus` / `Decode`. |
| `pagination.ts` | `fetchByMonth(start, end, buildQuery, label)` runs the same template once per calendar month with `concurrency: 4`. Each month that returns ≥ 100 rows (PostHog's default page limit) gets bisected up to depth 4 (~2-day chunks). Returns flattened rows + columns. |
| `queries.ts` | The five canonical HogQL templates: `providerViewEventsQuery`, `unitViewEventsQuery`, `monthlyUserActivityQuery`, `userActivityByMonthQuery`, `riskFactorViewEventsQuery`. All filter on `event = 'Page Load'` + `properties.\`client-username\`` + email-domain prefix + `timestamp` window. URL-era regex matches `/regions|units|physicians/units|nurses/units` — leaving any era out silently drops pre-Oct 2025 data. The risk-factor query classifies each row as `overview` / `drilldown` / `other` via `multiIf` so the aggregator can tally without re-matching URLs. |
| `aggregator.ts` | Pure functions: `buildPlatformSnapshot`, `buildMarketSnapshot`, `buildProvisionedSnapshot`. Take typed event arrays, return a snapshot object that validates against the matching schema. |
| `pipeline.ts` | `runPlatformPipeline` / `runMarketPipeline` / `runProvisionedPipeline` — the public entry points. Each composes the right `fetch*` helpers, hands them to the aggregator, and decodes the result against the schema. |
| `cache.ts` | 15-minute in-process `Map` cache. Per-warm-instance only (one map per Vercel function). `cached(key, effect, { bypass })` — `bypass: true` skips the read but still writes the fresh value back. |
| `config.ts` | `POSTHOG_PROJECT_ID = "71649"`, `CLIENTS` (per-client `clientUsername` + `emailDomains` + provisioned-user counts), `BU_UUID_MARKET` for BSMH market attribution, `ALL_MARKETS` zero-fill list. |

Caching strategy: each `fetch*` is independently cached by `(event-shape, client, range)`,
and each pipeline result is cached by `(metric, client, range)`. The pipeline
caches dedupe back-to-back identical requests; the per-fetch caches mean a
hit on `runPlatformPipeline(bsmh, …)` warms the provider/unit data for
`runMarketPipeline(bsmh, …)`. The Refresh button (top bar) bumps a nonce that
adds `?refresh=1` and triggers `bypass: true` at both layers.

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
clean; only the route changes between pages.

UI primitives (`KpiTile`, `TimeSeries`, `CategoryBars`, `DataTable`,
`MarketPicker`, `SystemPicker`, `TimeRangePicker`, `TopBar`, `RefreshButton`)
live in `src/lib/ui/`. Visualizations use `layerchart`.

## Snapshot pipeline (offline producer)

`scripts/snapshot/*` is the monthly producer. Same `Schema` definitions as the
runtime, so a malformed export fails at write time before it can hit S3.

| Script | What it does |
|---|---|
| `query.ts` | Opens an SSH tunnel to the RDS bastion (`rds/bastion.ts`), runs every `.sql` file under `rds/queries/` (or the one named via `--query`) with `{{client}}` / `{{month}}` placeholders, writes one CSV per query to `tmp/snapshot/{client}/{month}/`. |
| `build.ts` | Reads `clinician-roster.csv`, runs the `shape/roster.ts` aggregators, schema-validates via `schema-roundtrip.ts`, writes `metrics.json` / `market_metrics.json` / `provisioned_users.json` to the same `tmp/snapshot/...` dir. |
| `upload.ts` | Re-validates the local JSON, `PutObjectCommand`s to `s3://${SNAPSHOT_BUCKET}/{client}/{month}/{file}` with `Cache-Control: public, max-age=31536000, immutable`. `--dry-run` prints what it would PUT. |

Both runtime and pipeline share the same `SNAPSHOT_AWS_*` IAM key today
(Tanner's prototype identity). Splitting the reader to a dedicated read-only
principal scoped to `internal-tool-snapshots/*` is a deferred security
hardening item — see `archive/design/05-workos-setup/PLAN.md`.

The `scripts/snapshot/athena/queries/` directory exists but is empty in v1;
RDS covers everything currently rendered. Athena reads land when (and if) a
metric requires `dbt_dev_gold.*` data.

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
  must filter on `partition_date`.
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
