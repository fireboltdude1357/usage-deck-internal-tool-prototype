# internal-tool

SvelteKit dashboard for the Customer Success and Product teams. Phase 01 (this
phase) ships the frontend shell against fixture data; later phases swap in
real PostHog, Athena, and CloudFront.

## Dev workflow

```sh
cp .env.example .env       # AUTH_BYPASS=1, SNAPSHOT_SOURCE=fixtures
npm install
npm run gen:fixtures       # encode mock data → fixtures/snapshots/bsmh/2026-04/*.json
npm run dev                # http://localhost:5173
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server. |
| `npm run build` | Production build. |
| `npm run check` | `svelte-check` against `tsconfig.json`. |
| `npm test` | Run Vitest unit tests. |
| `npm run gen:fixtures` | Encode mock dataset into JSON fixtures, Schema-validating at write time. |
| `npm run snapshot:query -- --client <c> --month <YYYY-MM>` | Run RDS queries via the SSH bastion; writes CSV to `tmp/snapshot/<c>/<m>/`. Phase 03. |
| `npm run snapshot:build -- --client <c> --month <YYYY-MM>` | CSV → snapshot JSON in `tmp/`, Schema round-trip at write time. Phase 03. |
| `npm run snapshot:upload -- --client <c> --month <YYYY-MM> [--dry-run]` | Re-validate the local JSON and `PutObject` to `s3://internal-tool-snapshots/<c>/<m>/`. Phase 03. |

## Environment variables

`.env.example` documents every variable. The two that matter in phase 01:

- `AUTH_BYPASS=1` — required to render any page locally. Production deploys
  leave this unset, so every route returns 401 until phase 05 wires WorkOS.
- `SNAPSHOT_SOURCE=fixtures` (default) | `s3` (phase 04).

`POSTHOG_API_KEY` is wired (phase 02). `SNAPSHOT_AWS_*` + `SNAPSHOT_BUCKET` +
`RDS_STAGING_*` are wired for the local snapshot pipeline (phase 03 — see
`design/03-snapshot-pipeline/README.md` § "Monthly run"). `WORKOS_*` waits for
phase 05.

## Mock data

`src/lib/mock/bsmh-2026-04.ts` is the single source of truth for fixture
numbers. The values are aggregated by hand from real CSV outputs at:

```
../parent-db-investigations/db-investigation/investigations/bsmh-usage-deck/engagement/
  platform-engagement-metrics/12-retention-workflow-visuals/results/
  market-engagement-metrics/10-retention-workflow-visuals/results/
  bsmh-provisioned-users/03-total-and-lima/
```

User emails in the `user_detail` table are obfuscated (`user01..@mercy.com`,
`user02..@bshsi.org`); page-load counts and timing distributions are real.

To refresh fixtures after editing the mock module:

```sh
npm run gen:fixtures
```

The build step Schema-validates at write time, so a typo in the mock breaks
the build before reaching the dashboard.

## Routing

| Path | Renders |
|---|---|
| `/` | 307 redirect to `/platform-engagement` with default selection. |
| `/platform-engagement` | Headline KPIs, monthly time series, top units. |
| `/market-engagement` | Per-market bar charts (highlights selected market). |
| `/provisioned-users` | Total + Lima KPI tiles, sortable user roster. |
| `/api/snapshot/[client]/[month]/[file]` | Auth-gated snapshot read (fixtures or S3). |
| `/api/posthog/[client]/[metric]?start=YYYY-MM&end=YYYY-MM[&refresh=1]` | Live PostHog metrics. Returns the same `PlatformSnapshot` shape as `/api/snapshot`. 503 when `POSTHOG_API_KEY` is unset; the frontend falls back to the fixture path. |

Selectors (system / market / time range) live in `localStorage` under `internal-tool:selection`; the URL is just the route. The top bar's **Refresh** button bumps a nonce and bypasses the server cache so the next fetch goes back to PostHog.

## Phase boundaries

- **Schema** (`src/lib/schema/snapshot.ts`) — the contract phase 03 must
  produce JSON against. Don't change a snapshot file shape without updating
  this file first.
- **Auth seam** (`src/lib/server/auth.ts`) — `requireSession()` returns a
  stub user when `AUTH_BYPASS=1`, else 401. Phase 05 replaces only the body.
- **Snapshot source** (`src/lib/server/snapshot-source.ts`) — fixtures Layer
  works today; S3 Layer is a loud stub until phase 04.
- **PostHog seam** (`src/lib/server/posthog/`) — Effect-wrapped HogQL client +
  canonical query builders + aggregator. Phase 02 wired this for `bsmh`
  platform-engagement; later phases reuse it for additional metrics or
  clients without changing the seam.

## Phase status

| Phase | Status | Notes |
|---|---|---|
| 01 — SvelteKit frontend | shipped | Dashboard shell, fixture-backed routes, selectors in `localStorage`. |
| 02 — PostHog linking | shipped 2026-05-06 | Live BSMH platform-engagement; cache + refresh + logging. See `design/02-posthog-linking/PLAN.md` § "What shipped". |
| 03 — Snapshot pipeline | shipped 2026-05-06 | Manual-local RDS export to S3 (Athena query set is empty in v1). Combines the original 03 + 04. See `design/03-snapshot-pipeline/PLAN.md` § "What shipped". |
| 04 — Site reads S3 | not started | Wires Vercel server routes to read snapshots from S3. CloudFront deferred to v2. Combines the original 05 + 06. |
| 05 — WorkOS setup | not started | Conversation with corporate SSO admin is the longest pole; schedule early. |

See each `design/0N-…/PLAN.md` (or `README.md` where no PLAN exists yet) for the full plan and post-build "What shipped" notes.
