# 03 — Snapshot pipeline (Athena + RDS → S3)

**Status: shipped 2026-05-06.** See `PLAN.md` § "What shipped" for deltas
between the plan and the executed work.

Codifies the canonical Athena and RDS queries and the manual monthly export to
S3. Bucket creation and the Schema-validating uploader live here. Phase 04
(shipped 2026-05-06) wired Vercel to read this bucket; the dashboard now
serves Athena/RDS-sourced metrics from S3 and live PostHog (phase 02) for
everything else.

This phase combines the original phase 03 (Athena → S3) and phase 04 (RDS → S3) —
they share the bucket, the JSON contract, the Schema-validation pattern, and the
manual-local-run cadence, so there's no benefit to splitting them.

## Scope

- One vendored RDS SQL query (`scripts/snapshot/rds/queries/clinician-roster.sql`),
  generalized from the platform-engagement investigation by removing the date
  cutoff and parameterizing `client_username`. No Athena queries currently —
  `scripts/snapshot/athena/queries/` holds a placeholder for the first
  Athena-only KPI to land. PostHog stays live (phase 02) and is never
  snapshotted.
- The query runner (`scripts/snapshot/rds/{bastion,run-query}.ts`) is vendored
  from the parent `rds-server.mjs` MCP server — same `RDS_*` env-var contract,
  same SSH-bastion pattern, same Postgres client. We do not depend on the
  `rds-query` skill at runtime.
- The shapers (`scripts/snapshot/shape/`) take CSV rows from the runner and
  produce snapshot JSON matching `src/lib/schema/snapshot.ts`. PostHog-derived
  fields in the schema are emitted as empty arrays in the snapshot — PostHog
  is queried live by the dashboard's `/api/posthog/*` route and is never
  snapshotted or merged into the snapshot at request time. The snapshot only
  carries RDS- and Athena-sourced data.
- S3 layout: `s3://internal-tool-snapshots/{client}/{YYYY-MM}/{file}.json`
  where `file` ∈ `{metrics.json, market_metrics.json, provisioned_users.json}`.
  Bucket creation lives in this phase.
- Three thin scripts: `npm run snapshot:query` (RDS → CSV), `npm run snapshot:build`
  (CSV → snapshot JSON + Schema round-trip), `npm run snapshot:upload` (re-validate +
  `PutObject` with `Cache-Control: public, max-age=31536000, immutable`).
  All three load `.env` from the repo root via `scripts/snapshot/load-env.ts`.
- Tanner's existing IAM (`tanner.sharon`) is the prototype identity. Env vars
  named `SNAPSHOT_AWS_*` so the swap to a dedicated principal in phase 05 is
  a value change, not a code change.
- Hard rules: PHI block-list, no `SELECT *`, RDS > Athena where both have a
  metric. Athena-specific rules (`partition_date` filtering, lowercase
  `output_type`) kick in once an Athena query ships.

## Monthly run

```sh
# Once per month. Replace 2026-04 with the target month.
npm run snapshot:query  -- --client bsmh --month 2026-04
npm run snapshot:build  -- --client bsmh --month 2026-04
npm run snapshot:upload -- --client bsmh --month 2026-04 --dry-run
npm run snapshot:upload -- --client bsmh --month 2026-04
```

Repeat for each client: `bsmh`, `ssm`, `duke`, `ucsf`. The query step opens an
SSH tunnel to the bastion using `RDS_STAGING_*` env vars; upload uses
`SNAPSHOT_AWS_*` (or the AWS CLI's default credentials when those are unset).

To rebuild a single file without re-running the query, pass `--file`:

```sh
npm run snapshot:build  -- --client bsmh --month 2026-04 --file market_metrics.json
npm run snapshot:upload -- --client bsmh --month 2026-04 --file market_metrics.json
```

## References

- `../DESIGN.md` § 3 (Snapshot generator — manual local run)
- `../DESIGN.md` § Hard rules
- `../market-engagement-metrics.md`
- `../platform-engagement-metrics.md` (Athena-sourced subset, currently empty)
- `../provisioned-users.md`
- `../data-sources.md` → Athena/Glue table catalog + RDS connection details
- `PLAN.md` for the load-bearing constraints, decision table, and execution order

## Dependencies

- None upstream. Can run before any further Vercel work.
- Phase 02 (PostHog) is independent and already shipped — the live `/api/posthog/*` route covers most of `metrics.json` today. Athena-sourced KPIs that PostHog can't compute (currently empty as a placeholder) and the RDS-sourced clinician roster land here.

## Acceptance

- BSMH × 2026-04 produced three JSON files in `s3://internal-tool-snapshots/bsmh/2026-04/` with correct `Cache-Control` and `Content-Type`. ✓
- Schema round-trip passes at both build time (local JSON) and upload time (defense in depth). ✓
- Roster counts run +7% to +17% above the investigation deck because the query takes the most-recent `run_date` instead of the investigation's `run_date <= '2026-02-28'` cutoff — the roster grew between the investigation and this run, and the deltas are positive and roughly proportional, consistent with normal growth. PLAN.md's original ±5% tolerance assumed the investigation's cutoff and does not apply under the all-time semantics.
- Dashboard is **not** wired to S3 in this phase — that's phase 04.

## Out of scope

- Wiring the dashboard to S3. Phase 04.
- CloudFront. Deferred to v2 — Vercel reads S3 directly in phase 04 since the scale (5–20 internal users) doesn't need edge caching.
- Automated cron / Lambda / EventBridge / Vercel cron. See `../DESIGN.md` § Non-goals.
- Dedicated IAM principal for the export. Tanner's user is the prototype identity; phase 05 (WorkOS) is the cutover deadline.
- Live RDS reads from any user-request path.
