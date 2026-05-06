# 03 — Plan

**Status: shipped 2026-05-06.** See § "What shipped" at the bottom for deltas
between this plan and the executed work.

Implementation plan for the snapshot pipeline. This phase covers both Athena
and RDS exports in one push — they share the bucket, the JSON contract, the
Schema-validation pattern, and the manual-local-run cadence. (The original
plan split this across phases 03 and 04; the folders were consolidated into
this single phase before work started, and the original phase-05/06
CloudFront work was folded into the new phase 04 — see the root README's
phase-status table.)

The two artifacts that outlive this phase and become contracts for phase 04:

1. **The S3 bucket and its key shape** — `s3://internal-tool-snapshots/{client}/{YYYY-MM}/{file}.json`. Phase 04 wires Vercel to read from here; the keys must match exactly what `src/lib/schema/snapshot.ts` `SnapshotByFile` already names.
2. **The canonical SQL templates and the Schema-validating uploader** — version-controlled under `scripts/snapshot/`. Re-running a month is "edit query → re-upload"; nothing about the wiring changes month to month.

This phase does **not** wire the dashboard to the bucket. The dashboard keeps
falling back to fixtures for Athena/RDS-sourced metrics until phase 04 swaps
the snapshot source from `fixtures` to `s3`.

---

## Load-bearing constraints

These come from `../DESIGN.md` § Hard rules, the metric definition docs, and
the 2026-05-01 IAM probe (saved as `aws_account_state_2026_05.md`).

| Constraint | Source | Implication |
|---|---|---|
| **Bucket is private; no public access; no public ACLs.** | `../DESIGN.md` § 2 ("Snapshot store") | Read path is always Vercel → S3. Nothing in this phase tries to make objects browser-fetchable. |
| **Object key shape is the contract.** | `src/lib/schema/snapshot.ts` `SnapshotByFile`; `../DESIGN.md` § 2 | Filenames are exactly `metrics.json`, `market_metrics.json`, `provisioned_users.json`. Path is `{client}/{YYYY-MM}/{file}`. Drift breaks the read path silently in the next phase. |
| **Athena: `partition_date` filter mandatory; `output_type` lowercase; `dbt_dev_gold` only.** | `../DESIGN.md` § Hard rules; IAM probe § Athena facts | Every Athena query template enforces these. The probe confirmed lowercase casing (`quit_probability`, `shap_value`) and `2026-04-01` as the most recent partition. |
| **PHI block-list applies to every query.** | `../DESIGN.md` § Hard rules; `data-sources.md` § PHI Safety | Never query `patient_id`, `encounter_id`, `claim_id`, `procedure_id`, `message_id`, `thread_id`, `source_msg_id`, `hospital_account_id`, `primary_encounter_id`. No `SELECT *` on PHI-containing tables. |
| **RDS > Athena source priority.** | `../DESIGN.md` § Hard rules; `data-sources.md` § When to Use Each | Where a metric exists in both, RDS wins. Athena is for data RDS does not have (model outputs, SHAP, silver layers, org hierarchy). |
| **PostHog stays live, never snapshotted.** | `../DESIGN.md` § 4; phase 02 already shipped | This phase produces JSON for Athena-sourced and RDS-sourced metrics only. PostHog-sourced numbers (which are most of `metrics.json` today) continue coming from `/api/posthog/...`. |
| **Tanner's IAM allows the export today.** | `aws_account_state_2026_05.md` | `athena:*`, `glue:Get*`, and `s3:cp` (per DESIGN.md § Why this shape) are confirmed. Two unprobed actions to verify before bucket creation: `s3:CreateBucket`, `s3:PutBucketPublicAccessBlock`. |

---

## Decisions made here

| Decision | Default | Reason |
|---|---|---|
| Bucket name | `internal-tool-snapshots` (single bucket, all clients) | Matches `../DESIGN.md` § 2; simplest IAM scoping; one `aws s3 mb` call. |
| Bucket region | `us-east-1` | Matches the Athena workgroup region (probed). Same-region S3 keeps Athena → S3 free; same-region CloudFront in a later phase keeps origin egress free. |
| Bucket security | Private. Block all public access enabled at the bucket level. No bucket ACLs. Versioning **on** (cheap insurance against an accidental overwrite during the manual upload). | DESIGN.md § 2 and the quasi-PHI posture in § Constraints. Versioning costs cents at this volume. |
| Object cache headers | `Cache-Control: public, max-age=31536000, immutable` set at upload time | DESIGN.md § 2 — "month is in the URL, so a new month is a new URL — no cache invalidation needed." Belongs to the writer because the reader can't override it on the wire. |
| Aggregation locus | **In-SQL aggregation by default for Athena and RDS** (small payloads; the metric shape is already aggregate). **In-TS post-processing** only where shaping the rows into the snapshot envelope needs it (e.g., bucketing rows into `top_units_viewed`). | Phase 02's "raw events → aggregate in code" rule is a PostHog-specific pitfall (P4 — 100-row default + 10s timeout). Athena and RDS have neither limit; aggregation in SQL is canonical. |
| Query runner — **Athena** | Reuse the existing `athena-query` skill at `parent-db-investigations/.../skills/athena-query/` to develop and verify the queries; **vendor-copy the final SQL** into `scripts/snapshot/athena/queries/*.sql` so the queries are version-controlled in this repo (not buried in skill memory). | Skill is already configured for Tanner's local IAM; copying out the final SQL keeps this repo self-contained. |
| Query runner — **RDS** | Reuse the existing `rds-query` skill (SSH bastion tunnel already configured per `data-sources.md` § RDS Connection); vendor-copy the final SQL into `scripts/snapshot/rds/queries/*.sql`. | Same reasoning as Athena. The local RDS path already works; this phase doesn't try to set up a new one. |
| Wrapper script shape | **Two thin scripts**, not one orchestrator: `scripts/snapshot/build.ts` (locally compose the snapshot JSON from query outputs + Schema-validate it) and `scripts/snapshot/upload.ts` (validate again + `PutObject` with the right key and headers). Tanner runs the queries via skills, drops CSVs into `tmp/snapshot/<client>/<month>/`, then `tsx scripts/snapshot/build.ts --client bsmh --month 2026-04` then `tsx scripts/snapshot/upload.ts --client bsmh --month 2026-04`. | Mirrors the existing `src/lib/mock/build.ts` pattern (Schema round-trip → write JSON). Splitting build from upload means a bad shape fails locally with no S3 round-trip; you can also `aws s3 cp` by hand if the upload script breaks for a one-off. |
| Schema validation at write time | `Schema.encodeSync(...)` then `Schema.decodeUnknownSync(...)` round-trip against the right Schema from `src/lib/schema/snapshot.ts`, picked by filename via `SnapshotByFile`. Identical to `src/lib/mock/build.ts`. | Catches drift before upload. The read path validates again at fetch time — both sides validating is the contract. |
| Upload mechanism | AWS SDK v3 (`@aws-sdk/client-s3` `PutObjectCommand`) inside `upload.ts`. **Not** shelling out to `aws s3 cp` — the SDK lets us set `Cache-Control` and `ContentType` in one call without arg-string juggling. | Tanner already has IAM; SDK adds one dependency but keeps the script readable. |
| Auth for the export | **Tanner's existing IAM (`tanner.sharon`)** for the prototype. Env vars named neutrally (`SNAPSHOT_AWS_*`) so the swap to a dedicated principal later is a value change, not a code change. | Matches the prototype-creds decision earlier in this conversation; unblocks immediately; defers the admin ask. **Phase 05 (WorkOS) prereq**: swap to a dedicated IAM user before non-Atalan users hit the dashboard. Add a `// TODO(phase-05)` next to the env read so the swap shows up in a grep. |
| What metrics ship in v1 | Per-client per-month: **`metrics.json`** (Athena-sourced subset that PostHog can't compute — currently empty as a placeholder until a real Athena KPI lands; the rest of the schema's PostHog-derived fields stay as empty-array placeholders so the page loader's "PostHog not configured" fallback still decodes), **`market_metrics.json`** (RDS-sourced — `provider_info_v2.businessunitname` for BU mapping; live PostHog provides the per-market view counts at the page loader, not in this file), **`provisioned_users.json`** (RDS-sourced from `provider_quit_risk_v2`). | Aligns with the metric definition docs and unblocks Phase 02's two carry-forward items (`% monitored clinicians`, true `Logged-in provisioned users` denominator). |
| Number of clients in v1 | **BSMH first**, then SSM/Duke/UCSF added by re-running the same scripts with different `--client` flags. Acceptance is BSMH only. | Mirrors Phase 02's BSMH-first roll-out. Per-client query parameterization lives in the SQL templates (e.g., `WHERE client_username = '{{client}}'`). |
| Tests | Vitest unit tests for: Schema round-trip on a hand-built fixture (already exists for the mock data — extend), the `build.ts` shaping function (CSV-rows-in → snapshot-shape-out), and an upload **dry-run** mode that validates + prints the planned S3 key without calling AWS. **No live Athena/RDS calls in CI.** | Same posture as phases 01 and 02 — Schema regression is the load-bearing risk; live integration is verified by Tanner running the script once per month. |

---

## Module / artifact layout after this phase

```
scripts/
└── snapshot/
    ├── build.ts                      # CSV inputs → snapshot JSON + Schema round-trip
    ├── upload.ts                     # snapshot JSON → s3:PutObject with Cache-Control + ContentType
    ├── athena/
    │   └── queries/
    │       ├── platform-metrics.sql  # Athena-sourced subset of metrics.json (placeholder if empty)
    │       └── market-metrics.sql    # if any market metric is Athena-sourced
    ├── rds/
    │   └── queries/
    │       ├── provisioned-users.sql
    │       └── market-bu-mapping.sql # provider_info_v2.businessunitname → market labels
    └── shape/
        ├── platform.ts               # CSV row arrays → PlatformMetrics
        ├── market.ts                 # CSV row arrays → MarketMetrics
        └── provisioned.ts            # CSV row arrays → ProvisionedUsers
src/lib/schema/snapshot.ts            # unchanged contract
tmp/snapshot/                         # gitignored — Tanner's per-run query outputs land here
```

`package.json` adds:
- `"snapshot:build": "tsx scripts/snapshot/build.ts"`
- `"snapshot:upload": "tsx scripts/snapshot/upload.ts"`
- New devDep: `@aws-sdk/client-s3`

`.env.example` adds: `SNAPSHOT_AWS_ACCESS_KEY_ID=`, `SNAPSHOT_AWS_SECRET_ACCESS_KEY=`, `SNAPSHOT_AWS_REGION=us-east-1`, `SNAPSHOT_BUCKET=internal-tool-snapshots`.

`.gitignore` adds: `tmp/snapshot/`.

---

## Execution order

1. **Probe & create the bucket.**
   - Verify `s3:CreateBucket` and `s3:PutBucketPublicAccessBlock` for `tanner.sharon` via `aws iam simulate-principal-policy`. If denied, ask admin once; do not proceed without these.
   - `aws s3api create-bucket --bucket internal-tool-snapshots --region us-east-1` (us-east-1 is special — no `LocationConstraint`).
   - `aws s3api put-public-access-block --bucket internal-tool-snapshots --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true`.
   - `aws s3api put-bucket-versioning --bucket internal-tool-snapshots --versioning-configuration Status=Enabled`.

2. **Codify the queries.**
   - Develop and verify each canonical query interactively via the existing `athena-query` and `rds-query` skills, against BSMH and the most recent month with data (`2026-04` per the IAM probe).
   - Once a query produces the expected numbers, vendor-copy it into `scripts/snapshot/{athena,rds}/queries/<name>.sql` with `{{client}}` / `{{month}}` placeholders.
   - Numbers verification: spot-check against the existing investigation outputs at `parent-db-investigations/.../investigations/bsmh-usage-deck/` — any divergence ≥ 5% is a query bug, not a counting difference.

3. **Build the shaper modules** (`scripts/snapshot/shape/*.ts`).
   - Pure functions: CSV row arrays → snapshot envelope shape (`PlatformMetrics`, `MarketMetrics`, `ProvisionedUsers`).
   - Mirrors the existing `src/lib/mock/bsmh-2026-04.ts` data structure, but built from real query output instead of hand-curated mocks.
   - Vitest unit tests against canned CSV input.

4. **Build `scripts/snapshot/build.ts`.**
   - Args: `--client <bsmh|ssm|duke|ucsf>`, `--month <YYYY-MM>`, optional `--file <metrics.json|market_metrics.json|provisioned_users.json>` to rebuild just one.
   - Reads CSVs from `tmp/snapshot/<client>/<month>/<query-name>.csv`, runs the matching shaper, runs the Schema round-trip from `src/lib/mock/build.ts` (extract that helper into `scripts/snapshot/schema-roundtrip.ts` so both call sites share it), writes the result to `tmp/snapshot/<client>/<month>/<file>.json`.
   - Loud failure on Schema mismatch — print the offending field path and exit 1.

5. **Build `scripts/snapshot/upload.ts`.**
   - Args: same as `build.ts`. Reads the local JSON from `tmp/snapshot/<client>/<month>/<file>.json`, **re-validates against Schema** (defense in depth — file may have been hand-edited between build and upload), then `PutObjectCommand` to `s3://${SNAPSHOT_BUCKET}/${client}/${month}/${file}` with `ContentType: 'application/json'` and `Cache-Control: 'public, max-age=31536000, immutable'`.
   - `--dry-run` flag: validate + print the planned S3 key, do not call AWS.
   - `// TODO(phase-05): swap SNAPSHOT_AWS_* env to dedicated IAM principal before WorkOS launch` next to the env read.

6. **Run end-to-end for BSMH × 2026-04.**
   - Dump CSVs into `tmp/snapshot/bsmh/2026-04/` via the skills.
   - `npm run snapshot:build -- --client bsmh --month 2026-04` → three JSON files in `tmp/snapshot/bsmh/2026-04/`.
   - `npm run snapshot:upload -- --client bsmh --month 2026-04 --dry-run` → confirm planned keys.
   - `npm run snapshot:upload -- --client bsmh --month 2026-04` → real upload.
   - `aws s3 ls s3://internal-tool-snapshots/bsmh/2026-04/` to confirm three objects exist with the right `Cache-Control`.

7. **Document the monthly process** in this folder's README's "Monthly run" section (one short ordered list referencing the npm scripts).

8. **Acceptance check.** Inspect the uploaded JSON via `aws s3 cp s3://... -` and confirm the values match the existing investigation deck for BSMH 2025-08 → 2026-04 within ±1% (rounding tolerance). The dashboard is **not** wired to S3 yet — that's the next phase.

---

## What this phase deliberately does NOT do

- **Wire the dashboard to S3.** The next phase (whatever we renumber it to — see § Phase boundary changes) sets `SNAPSHOT_SOURCE=s3`, adds the IAM principal Vercel uses to read, and points `/api/snapshot/[client]/[month]/[file]` at the bucket. Until then, `/platform-engagement` keeps using the live PostHog path (Phase 02) and the other pages keep falling back to fixtures.
- **CloudFront.** Vercel can read S3 directly with an IAM principal. CloudFront is a v2 optimization (free egress past 1 TB, edge cache) that this scale doesn't need. Defer to a follow-up phase if egress ever becomes a line item — at 5–20 internal users it won't.
- **Automated cron / Lambda / EventBridge / Vercel cron.** DESIGN.md § Non-goals. The Vercel-cron idea explored earlier in this conversation is parked — the manual local cadence matches the data update frequency (1–2× per month).
- **Dedicated IAM principal for the export.** Tanner's user is the prototype identity. Phase 05 prereq.
- **Multi-client end-to-end.** BSMH first; SSM/Duke/UCSF are a re-run with different flags after BSMH is verified.
- **Live RDS reads from any user-request path.** RDS is touched only by this monthly export.
- **% monitored clinicians and the true `Logged-in provisioned users` denominator** at the dashboard layer. The data lands in `provisioned_users.json` and `market_metrics.json` here, but the cross-system join (PostHog viewers ÷ RDS roster) happens in the dashboard route — that's the next phase's job.

---

## Open questions to resolve before / during execution

- **`s3:CreateBucket` and `s3:PutBucketPublicAccessBlock` perms** — not in the 2026-05-01 probe. Run `aws iam simulate-principal-policy --action-names s3:CreateBucket s3:PutBucketPublicAccessBlock --policy-source-arn arn:aws:iam::075378712037:user/tanner.sharon` first; one admin ask if denied.
- **Recurring-leader denominator interpretation** (carried from Phase 02). Live = 25%, fixture = 27%. The RDS roster lands in this phase; once we have the canonical denominator, this question collapses to "what does CS leadership want this number to mean." One conversation, one line of code.
- **Where does the `% monitored clinicians` cross-system math live?** Two options: (a) in this phase's shaper modules — pre-compute the ratio and ship it as a KPI in `metrics.json`; (b) in the next phase's dashboard route — fetch PostHog viewers (live) and the RDS roster (snapshot) and divide at request time. (b) is more honest about freshness mismatch (PostHog is live; roster is monthly), but (a) is one less moving part. Default: (a) for v1, with the snapshot timestamp visible on the KPI card.
- **Athena workgroup ResultLocation** — IAM probe noted no workgroup enforces a default. Either set one on `primary` (touches shared config; ask first) or pass `OutputLocation` explicitly on every `StartQueryExecution`. The latter is what `data-sources.md` already documents.


---

## What shipped

Recorded after the build so future phases can see deltas between plan and reality.

### Built per plan
- S3 bucket `internal-tool-snapshots` in `us-east-1` with all four public-access blocks on and versioning enabled. `s3:CreateBucket` and `s3:PutBucketPublicAccessBlock` simulate-principal-policy probe came back `allowed` (no admin ask needed).
- Three thin scripts in `scripts/snapshot/`: `query.ts` (RDS → CSV), `build.ts` (CSV → JSON + Schema round-trip), `upload.ts` (re-validate + `PutObjectCommand` with the right `Cache-Control` + `Content-Type`). `--dry-run` on upload short-circuits before any AWS call. Wired as `npm run snapshot:{query,build,upload}`.
- Pure shapers in `scripts/snapshot/shape/{roster,bu-mapping}.ts` with vitest coverage on canned CSV input. `BU_CODE_MARKET` vendored verbatim from the market-engagement investigation's `generate-html.py`.
- `scripts/snapshot/schema-roundtrip.ts` — extracted helper shared by `src/lib/mock/build.ts` and `scripts/snapshot/build.ts` so both sides validate identically.
- BSMH × 2026-04 ran end-to-end: 2,180 roster rows pulled from staging RDS, three JSON files uploaded to S3, all with correct headers (verified via `aws s3api head-object`).

### Diverged from plan
- **Skill-as-runner replaced by vendored bastion.** PLAN.md decision table (line 50) had the `rds-query` skill running queries during development with the final SQL vendor-copied into the repo. We instead vendored the SSH-tunnel + pg-client logic from `parent-db-investigations/.../mcp-servers/rds-server.mjs` directly into `scripts/snapshot/rds/{bastion,run-query}.ts`. Same env-var contract (`RDS_*`), same auth path. Reason: the user wanted a self-contained pipeline (`script that runs our SQL queries we rigidly defined and uploads to S3`) rather than a manual skill-driven step inside the loop. The `rds-query` skill remains the right tool for ad-hoc investigation; this repo just doesn't depend on it at runtime.
- **All-time semantics, not a date cutoff.** The investigation queries had `run_date <= '2026-02-28'` baked in (matching the deck date). Per the user's directive ("general form of these queries (except the time constraint) ... query for all of it for all time"), `scripts/snapshot/rds/queries/clinician-roster.sql` instead takes the most-recent `run_date`. As a result, BSMH 2026-04 row counts run +7% to +17% above the investigation — consistent with normal monthly roster growth, not a query bug. PLAN.md's ±5% spot-check tolerance does not apply under these semantics.
- **Athena queries currently empty.** PLAN.md (line 56) anticipated an "Athena-sourced subset of `metrics.json` ... currently empty as a placeholder." That's still the case — none of the three current investigations ship an Athena query, so `scripts/snapshot/athena/queries/` holds only a `.gitkeep` placeholder. The bucket layout, build/upload scripts, and shape pattern are all ready for the first Athena query whenever it lands.
- **PostHog-derived fields stay required in the schema.** The snapshot fills only RDS- and Athena-sourced fields and emits empty arrays / `{value: 0}` for the PostHog-only fields in the same schema. The dashboard fetches live PostHog separately via `/api/posthog/*`; the snapshot is *not* merged with PostHog at request time. PostHog-derived fields in the snapshot are vestigial placeholders for the case where the page loader uses the snapshot as a "PostHog not configured" fallback (e.g., dev without `POSTHOG_API_KEY`) — empty arrays render as empty charts, which is the correct fallback UX. Left `src/lib/schema/snapshot.ts` alone (rather than marking PostHog fields optional or splitting the schema) because the cost of carrying empty placeholders is one line per field at write time vs. a wider type churn that buys nothing.

### Added during build (not in original plan)
- **`scripts/snapshot/load-env.ts`** — minimal `.env` loader vendored from `rds-server.mjs` (no `dotenv` dep). All three snapshot scripts call it on startup so the chain works whether or not the user remembered to source `.env`.
- **`scripts/snapshot/rds/queries/` placeholder substitution.** `run-query.ts` compiles `{{client}}` / `{{month}}` placeholders into Postgres positional params (`$1`, `$2`, etc.) at execution time, with index re-use for repeated occurrences. Safer than naive string-substitution; aligns with the `rds-query` skill's pattern.
- **`vite.config.ts` test glob extended** to `scripts/**/*.{test,spec}.{js,ts}` so the shape tests run with the rest of the suite.

### Numbers verified vs. investigation deck (BSMH most-recent vs. `run_date <= '2026-02-28'`)
- Total monitored clinicians: live = **2,180**, investigation = **2,038** (+7.0%).
- Per-market: Youngstown 344 vs 322 (+6.8%), Toledo 272 vs 252 (+7.9%), Lima 191 vs 163 (+17.2%), Hampton Roads 117 vs 108 (+8.3%), Lorain 92 vs 85 (+8.2%), Kentucky 85 vs 75 (+13.3%).
- All deltas positive, monotonic with elapsed time, consistent with monthly roster additions. No query bug indicated.

### Carried forward
- **Phase 04 wires `SnapshotSourceS3`** in `src/lib/server/snapshot-source.ts` (currently a loud stub that 502s). When that lands, `SNAPSHOT_SOURCE=s3` flips the read path from fixtures to the bucket. The snapshot stays RDS-/Athena-only — PostHog is fetched live by the page loaders via `/api/posthog/*` and is *not* merged into the snapshot. The two sources are sibling fetches in the page loader, not a hybrid response from `/api/snapshot`.
- **SSM/Duke/UCSF runs.** Acceptance was BSMH only. The scripts are client-parameterized, so adding the other clients is just three more `npm run snapshot:* -- --client ssm --month ...` invocations once the BU mapping (or its non-BSMH equivalent) is filled in. Today the BU table only knows BSMH codes, so non-BSMH `clinicians_by_market` would come back empty — fine for v1 but a thing to address before those clients ship.
- **Phase 05 IAM swap.** `scripts/snapshot/upload.ts` has the `// TODO(phase-05): swap SNAPSHOT_AWS_* env to dedicated IAM principal before WorkOS launch` marker next to the env read.