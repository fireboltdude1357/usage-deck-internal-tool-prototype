# Operations

Dev workflow, env vars, deploys, the monthly snapshot run.

## Dev workflow

```sh
cp .env.example .env       # AUTH_BYPASS=1, SNAPSHOT_SOURCE=fixtures
npm install
npm run gen:fixtures       # encode mock data → fixtures/snapshots/bsmh/2026-04/*.json
npm run dev                # http://localhost:5173
```

`AUTH_BYPASS=1` means `requireSession` returns a stub user; no WorkOS round-
trip, no `WORKOS_*` env vars needed. `SNAPSHOT_SOURCE=fixtures` means the
snapshot route reads from disk under `fixtures/snapshots/`.

To exercise the live PostHog path locally, set `POSTHOG_API_KEY`. To exercise
the S3 read path, set `SNAPSHOT_SOURCE=s3` + `SNAPSHOT_AWS_*` + `SNAPSHOT_BUCKET`.
To exercise the WorkOS auth flow, unset `AUTH_BYPASS` and set every `WORKOS_*`
plus `WORKOS_REDIRECT_URI=http://localhost:5173/api/auth/callback`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server. |
| `npm run build` | Production build (`@sveltejs/adapter-vercel`). |
| `npm run check` | `svelte-check` against `tsconfig.json`. |
| `npm test` | Vitest unit tests (auth, snapshot source, posthog client, schema, filter). |
| `npm run gen:fixtures` | Encode `src/lib/mock/bsmh-2026-04.ts` → `fixtures/snapshots/bsmh/2026-04/*.json`, schema-validating at write. |
| `npm run snapshot:query -- --client <c> --month <YYYY-MM>` | RDS bastion → CSV in `tmp/snapshot/<c>/<m>/`. |
| `npm run snapshot:build -- --client <c> --month <YYYY-MM>` | CSV → snapshot JSON in `tmp/`. Schema round-trip at write. |
| `npm run snapshot:upload -- --client <c> --month <YYYY-MM> [--dry-run]` | Re-validate the JSON and `PutObject` to S3. |

All `snapshot:*` scripts source `.env` via `scripts/snapshot/load-env.ts`.

## Environment variables

`.env.example` documents every variable. By role:

### Mode flags

- `AUTH_BYPASS=1` — required to render any page locally without setting up
  WorkOS env vars. Production deploys leave this unset; routes then require
  a WorkOS-issued sealed cookie issued by `/api/auth/callback`.
- `SNAPSHOT_SOURCE=fixtures` (default for local dev) | `s3` (Vercel
  Production). When `s3`, `/api/snapshot/*` reads from
  `s3://${SNAPSHOT_BUCKET}/...` via the AWS SDK.

### PostHog

- `POSTHOG_API_KEY` — bearer for HogQL POSTs. When unset, `/api/posthog/*`
  returns 503 with `Configuration: POSTHOG_API_KEY not set`, and the page
  loaders fall back to fixture snapshots.

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
