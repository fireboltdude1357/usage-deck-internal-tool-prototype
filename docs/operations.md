# Operations

Dev workflow, env vars, deploys, the monthly snapshot run.

## Dev workflow

```sh
cp .env.example .env       # AUTH_BYPASS=1, SNAPSHOT_SOURCE=s3
npm install
npm run dev                # http://localhost:5173
```

`AUTH_BYPASS=1` means `requireSession` returns a stub user; no WorkOS round-
trip, no `WORKOS_*` env vars needed. `SNAPSHOT_SOURCE=s3` reads from
`s3://${SNAPSHOT_BUCKET}/{client}/{month}/{file}` — credentials come from the
AWS SDK default chain (`~/.aws/credentials`), so no `SNAPSHOT_AWS_*` env vars
are required for local dev as long as your default profile can read the
bucket. The S3 path covers all four clients and every backfilled month;
switch back to `SNAPSHOT_SOURCE=fixtures` (after `npm run gen:fixtures`) only
to develop against the bundled `bsmh/2026-04` JSON without network access.

To exercise the live PostHog path locally, set `POSTHOG_API_KEY`. To exercise
the WorkOS auth flow, unset `AUTH_BYPASS` and set every `WORKOS_*` plus
`WORKOS_REDIRECT_URI=http://localhost:5173/api/auth/callback`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server. |
| `npm run build` | Production build (`@sveltejs/adapter-vercel`). |
| `npm run check` | `svelte-check` against `tsconfig.json`. |
| `npm test` | Vitest unit tests (auth, snapshot source, posthog client, schema, filter). |
| `npm run gen:fixtures` | Encode `src/lib/mock/bsmh-2026-04.ts` → `fixtures/snapshots/bsmh/2026-04/*.json`, schema-validating at write. |
| `npm run snapshot:query -- --client <c> --month <YYYY-MM> [--source rds\|athena\|all] [--query <basename>]` | RDS bastion + Athena → CSV in `tmp/snapshot/<c>/<m>/`. Default `--source all` runs both sides. Roster/metadata SQL filter `run_date = ({{month}} || '-01')::date`; pick a month that has a model run or the CSV will be empty. |
| `npm run snapshot:build -- --client <c> --month <YYYY-MM> [--file <name>]` | CSV → snapshot JSON in `tmp/`. Schema round-trip at write. `--file` scopes to one of `metrics.json` / `market_metrics.json` / `provisioned_users.json` / `success_stories.json`. |
| `npm run snapshot:upload -- --client <c> --month <YYYY-MM> [--file <name>] [--dry-run]` | Re-validate the JSON and `PutObject` to S3. `--file` uploads only one. |
| `scripts/snapshot/backfill-all.sh` | Wipe and re-populate S3 for every `(client, run_date)` pair, then chain into `backfill-success.sh` so the wipe doesn't orphan `success_stories.json`. |
| `scripts/snapshot/backfill-success.sh` | Build `success_stories.json` once per client (canonical month) and upload to that single month-prefix. The snapshot carries the raw per-provider per-month series; pre/post pairing is derived live in the page loader from the picker range, so there's nothing to propagate. Run standalone to refresh only success-stories; otherwise invoked automatically by `backfill-all.sh`. |

All `snapshot:*` scripts source `.env` via `scripts/snapshot/load-env.ts`.

## Environment variables

`.env.example` documents every variable. By role:

### Mode flags

- `AUTH_BYPASS=1` — required to render any page locally without setting up
  WorkOS env vars. Production deploys leave this unset; routes then require
  a WorkOS-issued sealed cookie issued by `/api/auth/callback`.
- `SNAPSHOT_SOURCE=s3` (default; matches Vercel Production) | `fixtures`
  (offline / no-AWS-creds dev). When `s3`, `/api/snapshot/*` reads from
  `s3://${SNAPSHOT_BUCKET}/...` via the AWS SDK; credentials come from
  `SNAPSHOT_AWS_*` if set, otherwise the SDK default chain
  (`~/.aws/credentials`).

### PostHog

- `POSTHOG_API_KEY` — bearer for HogQL POSTs. Consumed by the runtime
  client (`src/lib/server/posthog/client.ts`, serving every `/api/posthog/*`
  route including the success-stories cohort). When unset, `/api/posthog/*`
  returns 503 with `Configuration: POSTHOG_API_KEY not set`; the platform /
  market / provisioned page loaders fall back to fixture snapshots, and the
  success-stories page renders the un-filtered snapshot analysis with a
  banner.

### S3 snapshot read + write

The same four vars feed both the writer (`scripts/snapshot/upload.ts`) and
the reader (`src/lib/server/snapshot-source.ts`):

- `SNAPSHOT_AWS_ACCESS_KEY_ID`
- `SNAPSHOT_AWS_SECRET_ACCESS_KEY`
- `SNAPSHOT_AWS_REGION` (default `us-east-1`)
- `SNAPSHOT_BUCKET` (default `internal-tool-snapshots` in the upload script;
  the reader fails per-request with a clear error if unset)

Tanner's IAM is the prototype identity for both. Splitting the reader to a
dedicated read-only IAM principal scoped to `internal-tool-snapshots/*` is a
deferred security-hardening item.

### Athena (snapshot pipeline only)

- `ATHENA_DATABASE` (default `sql_outputs`)
- `ATHENA_WORKGROUP` (default `primary`)
- `ATHENA_OUTPUT_PREFIX` (default `athena-results/`) — sub-prefix inside the
  snapshot bucket where Athena writes its `{qid}.csv` result files. Reuses
  `SNAPSHOT_BUCKET` and `SNAPSHOT_AWS_*` credentials (one IAM identity, one
  bucket; Athena results just live under a different prefix from the snapshot
  JSON).

A query file may override the database for one run with a `-- @database: foo`
header comment.

### RDS (snapshot pipeline only)

`scripts/snapshot/query.ts` reads the same `RDS_*` shape as the
`parent-db-investigations` `rds-query` skill so existing creds work
unchanged. `RDS_INSTANCE` defaults to `staging`; legacy unprefixed `RDS_*` is
also accepted for staging. Full set: `RDS_STAGING_HOST`, `_USER`,
`_PASSWORD`, `_PORT`, `_SSLMODE`, `_SSL_ROOT_CERT`, `_BASTION_HOST`,
`_BASTION_USER`, `_BASTION_KEY_PATH`.

### WorkOS

- `WORKOS_API_KEY` — server-side WorkOS API key.
- `WORKOS_CLIENT_ID` — required at SDK construction.
- `WORKOS_REDIRECT_URI` — must exactly match an entry on AuthKit's redirect-URI
  allowlist in the WorkOS dashboard. Local dev:
  `http://localhost:5173/api/auth/callback`. Production:
  `https://<vercel-prod-host>/api/auth/callback`.
- `WORKOS_COOKIE_PASSWORD` — 32+ bytes (`openssl rand -base64 32`).
  Rotating invalidates all active sessions.
- `ALLOWED_EMAIL_DOMAINS` — comma-separated, leading `@` required. Defaults
  to `@atalantech.com`. Enforced in `/api/auth/callback`, *not* by WorkOS —
  the social-login connection doesn't bind to a Workspace domain.

## Routing

| Path | Renders |
|---|---|
| `/` | 307 redirect to `/platform-engagement`. |
| `/platform-engagement` | Headline KPIs, monthly time series, top units. |
| `/market-engagement` | Per-market bar charts (highlights selected market). |
| `/provisioned-users` | Total + Lima KPI tiles, sortable user roster. |
| `/success-stories` | Hero count + per-category bars + provider cards for everyone who improved on ≥ 3 of 5 metrics. Hybrid: snapshot carries the raw per-provider per-month series; the page derives pre/post live from the TimeRangePicker range and intersects with the live PostHog "viewed-providers" cohort. |
| `/api/snapshot/[client]/[month]/[file]` | Auth-gated snapshot read (fixtures or S3). |
| `/api/posthog/[client]/[metric]?start=YYYY-MM&end=YYYY-MM[&refresh=1]` | Live PostHog metrics in the same shape `/api/snapshot` returns. 503 ⇒ frontend falls back to the fixture path. |
| `/api/auth/login?return_to=<path>` | Redirects to AuthKit hosted login. |
| `/api/auth/callback?code=…&state=…` | Exchanges the code, enforces `ALLOWED_EMAIL_DOMAINS`, sets `wos-session`, redirects to `return_to`. |
| `/api/auth/logout` | Clears the session cookie and redirects to `/`. |

Selectors (system / market / time range) live in `localStorage` under
`internal-tool:selection`; the URL is just the route. The top bar's
**Refresh** button bumps a nonce that bypasses the server cache.

## Monthly snapshot run

```sh
npm run snapshot:query -- --client bsmh --month 2026-04
npm run snapshot:build -- --client bsmh --month 2026-04
npm run snapshot:upload -- --client bsmh --month 2026-04 --dry-run   # sanity check
npm run snapshot:upload -- --client bsmh --month 2026-04
```

The three steps and the schema-validation gates are described in
`docs/data-flow.md` § Monthly snapshot pipeline. Each step writes to and
reads from `tmp/snapshot/<client>/<month>/`, so it's safe to inspect the
intermediates before uploading.

The chosen month must match an actual `run_date` in
`public.provider_quit_risk_v2` for the given client — roster and metadata
queries filter on it directly. Probe the available `(client, run_date)`
list with:

```sql
SELECT client_username, MIN(run_date), MAX(run_date), COUNT(DISTINCT run_date)
FROM public.provider_quit_risk_v2
GROUP BY client_username
```

(see `scripts/snapshot/probe-earliest.ts` for the same probe wrapped as a
one-off script).

## Full backfill

`scripts/snapshot/backfill-all.sh` re-populates S3 across every client and
run-date in one shot. It wipes `s3://${SNAPSHOT_BUCKET}/{bsmh,ssm,duke,ucsf}/`
(preserving `athena-results/`), loops query → build → upload over the
hard-coded `(client, run_date)` list, then chains into `backfill-success.sh`
which builds `success_stories.json` once per client at the client's canonical
month and uploads it to that single month-prefix. The
(client, run_date) list and canonical months are hard-coded in the scripts —
update both when the upstream model produces a new run.

Run order if rebuilding from scratch:

```sh
scripts/snapshot/backfill-all.sh
```

Run `scripts/snapshot/backfill-success.sh` directly if you only need to
refresh success-stories without re-uploading the roster files.

## Deploy

Vercel auto-builds on `git push`. The adapter (`@sveltejs/adapter-vercel`) is
already wired. Production env vars live in the Vercel project settings; at
minimum:

- `SNAPSHOT_SOURCE=s3`
- `SNAPSHOT_AWS_*` + `SNAPSHOT_BUCKET`
- `POSTHOG_API_KEY` (otherwise the dashboard shows fixture data forever)
- All five `WORKOS_*` (and **leave `AUTH_BYPASS` unset**)
- `ALLOWED_EMAIL_DOMAINS` if anything other than `@atalantech.com`

## Tests

`npm test` runs Vitest. Existing suites:

- `src/lib/filter.test.ts` — selection-filter helpers.
- `src/lib/schema/snapshot.test.ts` — schema round-trip on every envelope.
- `src/lib/server/auth.test.ts` — `requireSession` paths (bypass, no cookie,
  bad cookie, valid).
- `src/lib/server/snapshot-source.test.ts` — fixture + S3 error mapping.
- `src/lib/server/workos.test.ts` — domain allowlist parsing.
- `src/lib/server/posthog/posthog.test.ts` — pagination, aggregator, client
  retry/timeout.

When changing a seam, run the matching test file. When touching the schema,
run the schema test plus any aggregator that produces that shape.

## Known operational gotchas

- **`AUTH_BYPASS` in production** would defeat the entire auth gate. The
  variable name is suggestive enough that nobody's set it on Vercel
  accidentally yet, but it's worth a glance during prod-config review.
- **`wos-session` cookie unseal failures** are auto-cleared in
  `requireSession` so users can't get stuck. If you see a user reporting a
  redirect loop, check `WORKOS_COOKIE_PASSWORD` matches the env that issued
  their session — a rotation invalidates everyone.
- **PostHog page-limit silent truncation** — `pagination.ts` bisects when a
  month returns ≥ 100 rows, up to depth 4. If a query has > 1600 rows in a
  month it'll still under-count. None of the current queries are anywhere
  near that, but new queries should aggregate or filter early enough to stay
  in budget.
- **CSV → JSON build is destructive** — `snapshot:build` overwrites
  `tmp/snapshot/<client>/<month>/*.json`. Don't hand-edit the JSON; edit the
  source CSV / SQL / aggregator instead.
- **Athena scans are billed per scanned-byte.** The `sql_outputs.monthly_*`
  tables partition on `(client, run_date, batch_ds)`. The success-stories
  monthly queries filter on `client` only (the page loader splits pre/post
  live), so they scan every available month for the client — heavier than
  the old iter-12 queries but still well under a dollar per run across all
  four clients. `feature_ds` is a regular column and won't prune by itself.
- **Roster/metadata queries are month-filtered.** Calling `snapshot:query`
  with a `{{month}}` that has no `run_date` in `provider_quit_risk_v2`
  silently produces an empty CSV; the subsequent `snapshot:build` errors
  on the empty roster. That's the intended failure mode — there's no
  silent fallback to the latest model run anymore.
- **Persisted selection is clamped at load.** `selection.svelte.ts` keeps
  `system`/`market`/`start`/`end` in `localStorage`. On read, any `start`/`end`
  outside `AVAILABLE_MONTHS[system]` is replaced with `defaultRange(system)`,
  and `market` is forced to `"all"` for non-bsmh systems. This keeps older
  payloads from rendering broken pickers; symptom of a missed clamp would be
  a `/api/snapshot/<c>/<m>/...` 404 on first load after a `snapshot-months`
  edit.
- **`AVAILABLE_MONTHS` is the single source of truth.**
  `scripts/snapshot/backfill-all.sh` derives its `(client, month)` list from
  `AVAILABLE_MONTHS` in `src/lib/snapshot-months.ts` via `npx tsx -e`. To
  backfill a new month: edit `AVAILABLE_MONTHS` (and bump
  `LATEST_SNAPSHOT_MONTH` if it's the new tail — the module-load assert
  enforces those agree), then re-run `backfill-all.sh`. Don't add months to
  the script.
- **Success-stories pre/post is derived live.** The snapshot is the raw
  per-provider per-month series (no pre/post pairing, no cohort
  intersection). The page loader splits the user-selected
  `[selection.start, selection.end]` in half (floor pre, ceil post) and
  computes each provider's scorecard on the fly. The market filter and
  the PostHog cohort intersection also happen at derive time.
  Consequence: any range with fewer than 2 months of available data
  renders a "widen your range" empty state, and PostHog 503 falls
  through to the un-cohort-gated analysis with an amber banner.
- **Success-stories snapshot is large.** Storing the full per-month
  series for ~2000+ providers per client lands at ~18 MB per file for
  BSMH/SSM/Duke (UCSF is ~0.8 MB). Vercel gzips on the wire so the
  observed download is closer to 1–2 MB, but expect the first load of
  `/success-stories` to be noticeably slower than the other tabs. The
  file is per-client (not per-month) and lives at the client's
  `LATEST_SNAPSHOT_MONTH` prefix in S3.
