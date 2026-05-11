# Internal Analytics Dashboard — Design

> Internal MVP for the Customer Success and Product teams to view standardized
> engagement metrics across health-system clients. Replaces ad-hoc SQL/HogQL
> investigations with one-click validated queries — same metric definitions,
> every time.

## What we're building

A SvelteKit web app where 5–20 internal CS/Product users:

1. Sign in with corporate SSO (WorkOS).
2. Pick a client (BSMH/SSM/Duke/UCSF) and a timeframe (typically a calendar month).
3. See standardized engagement metrics rendered against the chosen slice.
4. Compare across clients/timeframes side by side.

Metric definitions live in `market-engagement-metrics.md`,
`platform-engagement-metrics.md`, and `provisioned-users.md`. Source-system
connection details and ID mapping rules live in `data-sources.md`. Those
documents are the source of truth for *what* a metric means; this document is
the source of truth for *how* the app computes and serves it.

---

## Constraints that shaped the design

| Constraint | Implication |
|---|---|
| 5–20 internal users, infrequent visits | Scale is tiny; cost ceiling is "negligible." |
| RDS sits in a private VPC | Anything that queries RDS in real time needs VPC-attached compute. |
| Athena/Glue/S3 are public AWS APIs | A hosted Node service with IAM creds reaches them from anywhere. |
| PostHog is a SaaS API | API key + `fetch` from anywhere. |
| Source data updates 1–2× per month | Pre-computed snapshots are viable; live queries are not load-bearing. |
| Provider risk scores are quasi-PHI | Must be auth-gated; cannot be cached durably on user devices without review. |
| Team prefers low ops burden | Avoid SAM/CloudFormation/VPC complexity if possible. |

These are the constraints driving every architectural choice below. The previous
design (`../../internal-tool-try-1/PROCESS_DOCS/arch/02-three-proxy-aws-dev-slice.md`)
optimized for a different point in the space — three Lambdas + API Gateway +
VPC endpoints + CloudFormation. That design is preserved as a reference; this
document supersedes it.

---

## High-level architecture

```
Browser
  │  HTTPS, WorkOS-authenticated session
  ▼
Vercel  (SvelteKit, single repo)
  ├─ +page.svelte ............. UI
  ├─ /api/auth/*  ............. WorkOS callback + session
  ├─ /api/snapshot/* .......... Auth-gated S3 read (v2: + CloudFront)
  └─ /api/posthog/* ........... PostHog API passthrough (live)
        │                                    │
        │ (auth-gated read)                   │ (api key)
        ▼                                    ▼
S3 (private)                           PostHog API
   snapshots/{client}/{YYYY-MM}/*.json    (live, never snapshotted)

Local machine (Tanner, monthly, manual — v1)
  ├─ Athena export → s3://snapshots/...
  └─ RDS export    → s3://snapshots/...
        (driven by the athena-query / rds-query skills in
         ../../parent-db-investigations/db-investigation/.claude/skills/;
         existing IAM + local RDS access; no VPC bridge needed)
```

---

## Components

### 1. Frontend + serverless backend (Vercel + SvelteKit)

One repo, deployed by `git push`. Server routes (`+server.ts`) hold:

- WorkOS session validation (Auth.js or direct WorkOS SDK).
- AWS credentials (IAM access key + secret) for S3 access — Vercel env vars.
- PostHog API key — Vercel env var.

The frontend (`+page.svelte`) renders dashboards by fetching aggregated metrics
from `/api/snapshot/*` and live data from `/api/posthog/*`. Aggregation happens
at query time (during the manual export) or in the `+server.ts` route for v1
— smaller payloads, simpler client. Client-side re-slicing can come later if
the UX needs it.

### 2. Snapshot store (S3, CloudFront optional in v2)

Private S3 bucket. Object keys encode client + month so each month's data is
at a content-addressed URL:

```
s3://internal-tool-snapshots/bsmh/2026-04/metrics.json
s3://internal-tool-snapshots/bsmh/2026-04/risk_scores.json
s3://internal-tool-snapshots/duke/2026-04/metrics.json
```

Cache headers: `Cache-Control: public, max-age=31536000, immutable`. The month
is in the URL, so a new month is a new URL — no cache invalidation needed.

**Read path (v1)**: bucket is private. The browser does not fetch S3
directly. It calls `/api/snapshot/{client}/{month}/{file}.json` on Vercel; the
server route validates the WorkOS session and reads S3 directly via an IAM
principal. At 5–20 internal users with sub-100 KB monthly JSON, edge caching
isn't load-bearing — the Vercel function itself is the only consumer of S3,
so a CloudFront round-trip would just add a hop without buying speed.

**Read path (v2, deferred)**: CloudFront in front of S3 with Origin Access
Control. Same Vercel-mediated auth, but with edge caching and free egress
past the AWS-direct tier. Worth doing only if egress ever becomes a line
item; at current scale it won't.

**Read path (v3, deferred further)**: CloudFront signed cookies issued at
session start. The browser fetches CloudFront directly and the browser's HTTP
cache works perfectly. More setup; defer until v2's egress savings justify
also moving the auth boundary off the server.

### 3. Snapshot generator (manual local run, monthly — v1)

Once a month, Tanner runs the canonical Athena and RDS queries locally and
uploads the resulting JSON to S3 under the `{client}/{YYYY-MM}/` prefix. This
sidesteps both the IAM blocker on `lambda:CreateFunction` and the VPC bridge
problem for RDS — Tanner's local machine already has Athena perms and the
existing RDS access path.

The query tooling already exists at
`../../parent-db-investigations/db-investigation/.claude/skills/`:

- `athena-query` — runs Athena against `dbt_dev_gold.*` with the canonical
  pitfalls already encoded (`partition_date` filtering, lowercase
  `output_type`, PHI block-list).
- `rds-query` — runs Postgres queries against the existing local RDS path.
- `posthog-query` — same flow for ad-hoc PostHog questions, though PostHog
  is queried live by the app and not snapshotted.

Upload step is `aws s3 cp` (Tanner's IAM allows it). A small wrapper
(`scripts/upload-snapshot.ts`) can wrap the upload with `effect/Schema`
write-time validation later; for the first one or two months, raw JSON in
the right S3 key shape is sufficient.

Frequency: once a month, ad hoc. Source data only updates 1–2×/month, so a
missed Tuesday is fine.

Automating this (GitHub Actions, Lambda, EventBridge) is a v2 concern — see
"Non-goals."

### 4. PostHog (live, never snapshotted)

A Vercel `+server.ts` route holds the API key and proxies queries. PostHog
handles real-time event analytics — engagement events, page views, behavioral
funnels — and the PostHog query API returns fast enough for live use. There is
no snapshot file for PostHog data.

### 5. Auth (WorkOS)

WorkOS provides corporate SSO. Sessions live in HTTP-only cookies validated by
the Vercel server routes. WorkOS free tier covers the user count.

### 6. Server-side runtime (Effect v3)

Server routes use Effect v3 at the integration boundaries: AWS SDK calls (S3
reads from `/api/snapshot/*`), the PostHog API proxy, and `effect/Schema`
validation of the snapshot JSON before it reaches the UI — a malformed
export fails loudly instead of rendering empty cells.

The monthly export itself is a manual local process for v1 (§ 3) and does
not use Effect. When that gets automated, the same Schema definitions and
retry/timeout patterns will move into the wrapper script — but the
read-time validation contract is the load-bearing piece and lives in the
server routes today.

Out of scope for Effect: WorkOS session validation, SvelteKit page/server
glue, and any client-side code. Those stay vanilla SvelteKit. Effect lives
in `+server.ts` route bodies (and in any future `scripts/upload-snapshot.ts`
wrapper) — not in `+page.svelte` or `+page.server.ts`.

**Why v3, not v4 beta**: v3 is stable, has mature AI/docs support, and ships
a released ecosystem. v4 beta would add API-churn risk on top of normal
greenfield risk and degrade AI assistance during the build. Plan to upgrade
to v4 once it goes stable — the v3→v4 codemod plus AI migration skill make
the later upgrade short for a codebase this size, and the upgrade surface is
limited to server code + the Schema usage in the snapshot pipeline.

---

## Data flow examples

### User loads "BSMH, April 2026, Engagement"

1. Browser requests `/dashboard/bsmh/2026-04` from Vercel.
2. SvelteKit `+page.server.ts` checks the WorkOS session; if valid, renders.
3. Frontend fetches:
   - `/api/snapshot/bsmh/2026-04/metrics.json` — server route validates session,
     reads S3 directly, returns JSON. (v2: CloudFront in front of S3.)
   - `/api/posthog?client=bsmh&start=2026-04-01&end=2026-04-30&query=...`
     — server route hits the PostHog API, returns aggregated rows.
4. SvelteKit renders the page client-side.

### Monthly snapshot regeneration (manual, v1)

1. Tanner runs the `athena-query` and `rds-query` skills against the
   canonical query set for each client.
2. Output JSON is reviewed and uploaded with `aws s3 cp` (or
   `npm run snapshot:upload`) under
   `s3://internal-tool-snapshots/{client}/{YYYY-MM}/...`.
3. Existing object cache continues serving prior months unchanged. The
   new month's URL is fresh on first request and then cached.

---

## Why this shape

| Choice | Reason | Alternative considered | Why not |
|---|---|---|---|
| Vercel + SvelteKit | One repo, `git push` to deploy, env vars for secrets, no AWS deploy permissions needed | SAM stack: 3 Lambdas + API GW + VPC endpoints | Required ~10 IAM actions the developer doesn't currently have; ~$60–100/mo idle (VPC interface endpoints alone are ~$22/mo each); slow to ship |
| Pre-computed S3 snapshots vs. live queries | RDS forces VPC; data updates monthly so "live" buys nothing here; CloudFront makes S3 fast and free at scale | Live queries via VPC-attached Lambda or Fargate | Adds infrastructure for a UX gain (sub-monthly freshness) the use case does not need |
| PostHog stays live | API is fast, key is one env var, no VPC dependency | Snapshot PostHog too | More export jobs to maintain; PostHog data is granular and queries are cheap |
| WorkOS for auth | Real SSO, audit trail, fits quasi-PHI posture | Basic auth, IP allow-list, URL obscurity | Fails the quasi-PHI risk-acceptance bar; not auditable |
| CloudFront in front of S3 | First 1 TB/month egress is permanently free; edge caches; cheaper per-GB even past free tier | Direct S3 presigned URLs | Same auth posture, but $0.09/GB egress instead of $0; CloudFront strictly better |
| Manual local export for v1 | Tanner's IAM already allows Athena + S3 puts; existing query skills already work; monthly cadence makes "5 minutes once a month" trivial; sidesteps the Lambda IAM blocker and the VPC bridge for RDS | GitHub Actions cron / EventBridge + Lambda | Both add CI/AWS infra (Lambda also hits the IAM blocker); not worth automating before the format and cadence have been shaken out in the real world |
| Effect v3 at integration boundaries only | Composable retry/timeout/error modeling + `effect/Schema` validation where it actually pays off (S3 reads, PostHog proxy, snapshot validation at the read boundary) | Effect across the whole app, incl. page server and browser bundle | Page-server glue is already simple; Effect in the browser bundle isn't worth the size hit for a handful of pages |
| Pin Effect to v3, not v4 beta | v3 is stable, has mature AI/docs support, released ecosystem packages | Adopt v4 beta now | API churn during the build + degraded AI assistance; v3→v4 codemod and AI migration skill make the later upgrade short |

---

## Cost estimate

| Line item | Monthly |
|---|---|
| S3 storage (~3 GB) | $0.07 |
| CloudFront egress (under 1 TB free tier) | $0.00 |
| CloudFront requests | < $0.01 |
| Athena export query (1 run/month, ~1 GB scanned) | $0.01 |
| Vercel Pro (commercial use, custom domain, password gating) | $20.00 |
| WorkOS (under 1M MAU free tier) | $0.00 |
| Snapshot generation (manual local run, no infra) | $0.00 |
| **Total** | **~$20** |

For comparison, the prior SAM-based design ran ~$60–100/month idle just for VPC
interface endpoints — before any user traffic.

---

## Hard rules carried over from the original design

These were correct then, are correct now, and apply to the export queries and
to anything the Vercel routes do:

- **PHI block-list**: never query `patient_id`, `encounter_id`, `claim_id`,
  `procedure_id`, `message_id`, `thread_id`, `source_msg_id`,
  `hospital_account_id`, `primary_encounter_id`. Enforced at query-build time
  in the export job. See `data-sources.md`.
- **No `SELECT *` on PHI-containing tables.** Enumerate columns explicitly.
- **PostHog URL eras**: any query spanning pre-Oct 2025 must match `/regions/`,
  `/units/`, `/physicians/units/`, and `/nurses/units/`. Missing eras silently
  drops data.
- **RDS > Athena source priority**: when a metric exists in both, RDS wins.
  Athena is for data RDS does not have (model outputs, SHAP, silver layers,
  org hierarchy).
- **Athena partition pruning**: every query against `dbt_dev_gold.gold_model_output`
  must filter on `partition_date`. Confirmed during 2026-05 probe; canonical
  recent partition is `2026-04-01`.
- **Athena `output_type` casing is lowercase** (`quit_probability`, `shap_value`).
  Confirmed during 2026-05 probe.
- **Credentials never in the browser bundle.** Vercel env vars live in
  `+server.ts` only; never expose anything via `VITE_*` except non-secret URLs.

---

## Open questions for v1

- **Aggregation locus**: aggregate at query time during the manual export
  (smaller files, simpler frontend) vs. ship raw rows + aggregate
  client-side (larger files, arbitrary re-slicing). Default: aggregate at
  query time for v1.

### Resolved

- ~~**Which IdP does WorkOS connect to?**~~ Resolved 2026-05-06: phase 05
  shipped with AuthKit + Google as a *social* provider plus a domain
  allowlist (`@atalantech.com`) enforced in `/api/auth/callback`. A real
  Google Workspace SSO connection (which would have required the SSO admin
  conversation) is deferred to a future hardening pass. See
  `05-workos-setup/PLAN.md` § "What shipped".
- ~~**Risk-acceptance language rewrite.**~~ Folded into `README.md`'s
  auth-seam phase boundary and environment-variable sections; no
  `CLAUDE.md` exists in this repo to update separately.

---

## Non-goals (deferred)

- Live RDS queries from any user-request path. RDS is touched only by the
  monthly export.
- Automated monthly snapshot generation. Manual local runs are the v1
  contract; GitHub Actions / Lambda / EventBridge automation is deferred
  until the format and cadence have been shaken out, and (for Lambda) until
  the IAM blocker is cleared.
- Sub-monthly data freshness.
- Arbitrary date-range UI in v1. Timeframes are calendar months; week and
  quarter views land later if needed.
- IndexedDB or any durable client-side cache. CloudFront edge cache + browser
  HTTP cache is sufficient.
- Multi-region, blue/green, staging vs. prod separation.
- Production observability (CloudWatch dashboards, alarms, X-Ray tracing).
- Custom domain (Vercel default is fine; custom is a five-minute DNS change
  later).
- Backwards compatibility with the SAM-stack design preserved in
  `../internal-tool-try-1/`.

---

## What's preserved from `internal-tool-try-1`

The previous architecture round produced four documents that remain canonical
and were copied into this folder verbatim:

- `data-sources.md` — connection details, query syntax, ID mapping rules, PHI
  rules.
- `market-engagement-metrics.md` — market-level metric definitions.
- `platform-engagement-metrics.md` — platform-level metric definitions.
- `provisioned-users.md` — user-provisioning metric definitions.

Code, infrastructure, and process documents from the previous round are not
copied. They are available for reference at
`/Users/tannersharon/atalan/internal-tool-try-1/`.
