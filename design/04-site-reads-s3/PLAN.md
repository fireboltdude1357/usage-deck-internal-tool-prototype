# 04 — Plan

Implementation plan for wiring Vercel's `/api/snapshot/[client]/[month]/[file]`
to read directly from the S3 bucket created in phase 03. The README states
scope; this doc names the load-bearing decisions, picks defaults where the
README is silent, and lists the work in execution order.

The one artifact that outlives this phase and becomes a contract for phase 05:

1. **The `SNAPSHOT_AWS_*` read-side env contract.** Phase 04 introduces a
   second consumer (the SvelteKit server route) of the same env vars phase 03
   already uses for `scripts/snapshot/upload.ts`. Phase 05 (WorkOS) is the
   cutover deadline for swapping the prototype identity (`tanner.sharon`) to
   a dedicated read-only IAM principal scoped to `internal-tool-snapshots/*`.
   Both call sites carry a `// TODO(phase-05)` marker next to the env read so
   the swap shows up in a grep.

Everything else this phase touches is local — one Layer body in
`snapshot-source.ts`, plus Vercel Production env-var setup.

---

## Load-bearing constraints

| Constraint | Source | Implication |
|---|---|---|
| **The route handler shape is fixed.** | `src/routes/api/snapshot/[client]/[month]/[file]/+server.ts`, phase 01 | The handler already validates params, calls `SnapshotSource.read`, and decodes via `Schema.decodeUnknown`. This phase swaps **only** the Layer body — no route changes, no schema changes. |
| **Snapshot is RDS + Athena only; PostHog is live.** | phase 03 PLAN.md (post-edit), `../DESIGN.md` § 4 | This phase does **not** merge live PostHog into the `/api/snapshot` response. The page loaders already fetch PostHog (`/api/posthog/*`) as a sibling and only fall back to the snapshot's empty-array PostHog placeholders when PostHog isn't configured. |
| **Bucket is private; only the IAM principal can read.** | phase 03 PLAN.md § "Bucket security"; `../DESIGN.md` § 2 | The browser never fetches S3 directly. Reads are always Vercel → S3 with credentials supplied via env. Direct browser GET on the S3 URL must return 403. |
| **Object key shape is the contract.** | `src/lib/schema/snapshot.ts` `SnapshotByFile`; phase 03 README | Reader must `GetObject` from `${client}/${month}/${file}` exactly. Drift breaks the read silently. |
| **Tanner's IAM has S3 GetObject for `internal-tool-snapshots/*` already.** | phase 03 ran `PutObject` end-to-end with `tanner.sharon` | Reader needs `s3:GetObject`. No new IAM ask. We do **not** need `s3:ListBucket` because we fetch by exact key. |
| **Vercel runtime is Node, not Edge.** | phase 01 PLAN.md § "Adapter" | `@aws-sdk/client-s3` runs as-is. No fetch-polyfill or Edge-runtime variant needed. |
| **Schema validation is load-bearing.** | `../DESIGN.md` § 6 | Decode failures must surface as 500 with `{kind: "Decode"}`, not as a partially-rendered page. The route handler already does this; the Layer must classify a JSON-parse error as `Decode` so the existing mapping works. |

---

## Decisions made here

| Decision | Default | Reason |
|---|---|---|
| Read-side IAM principal | **Reuse Tanner's `tanner.sharon` IAM**, same env-var pattern as phase 03 (`SNAPSHOT_AWS_ACCESS_KEY_ID`, `SNAPSHOT_AWS_SECRET_ACCESS_KEY`, `SNAPSHOT_AWS_REGION`, `SNAPSHOT_BUCKET`). Add a `// TODO(phase-05): swap SNAPSHOT_AWS_* to dedicated read-only IAM principal scoped to internal-tool-snapshots/* before WorkOS launch.` next to the env read in `snapshot-source.ts`. | Mirrors phase 03's prototype-creds decision. One credential pair feeds both the writer and the reader. The dedicated read-only principal is one phase-05 swap (env values + TODO removal) instead of two parallel migrations. Reader doesn't need new perms because Tanner already has `s3:GetObject` on this bucket. |
| AWS SDK client construction | `new S3Client({ region, credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined })` — same shape as `scripts/snapshot/upload.ts:67-76`. Construct **once at module scope** so it's reused across requests. | The Vercel Node runtime warm-starts; rebuilding the client per request would defeat keep-alive. Module-scope construction is safe because the SDK client is stateless except for connection pools. |
| Error classification | NoSuchKey / 404 → `NotFound`. JSON parse failure → `Decode`. Any other SDK error (network, AccessDenied, throttling, etc.) → `Upstream`. | Matches the route handler's existing kind-to-HTTP mapping (`NotFound`→404, `Upstream`→502, `Decode`→500). AccessDenied as `Upstream` is correct because to the *route's* caller it's a backend failure, not a "user gave bad input" failure. |
| Body decoding | `await response.Body!.transformToString()` (SDK v3 helper) → `JSON.parse`. | `transformToString` handles the Node stream → string conversion. Wrapping it in `Effect.tryPromise` lets us classify the failure mode (read error vs. parse error) cleanly. |
| Layer construction | `Layer.effect(SnapshotSource, ...)` reading env at Layer-build time so a missing var fails loudly at app startup, not on the first request. The current stub uses `Layer.succeed`; switching to `Layer.effect` lets us pre-validate `SNAPSHOT_BUCKET` and surface a clear `MissingConfig` error if it's unset in prod. | "Fail loudly at startup" is the same posture as phase 01's `AUTH_BYPASS` gating — broken config should be a deploy-time failure, not a 502 surprise per request. |
| Env-var source | `$env/dynamic/private` (already used by the current stub for `SNAPSHOT_SOURCE`). | Consistent with the existing file. `process.env` would also work but mixing the two in one module is unnecessary noise. |
| `SNAPSHOT_SOURCE` switching | Keep the `env.SNAPSHOT_SOURCE === "s3"` check at the bottom of `snapshot-source.ts`. Production sets it to `s3`; Preview leaves it at `fixtures` (or unset, which defaults to fixtures). | Matches phase 01's design and the README's env-table. Preview deploys keep working without S3 creds. |
| Vercel env-var scope | `SNAPSHOT_SOURCE=s3`, `SNAPSHOT_AWS_*`, `SNAPSHOT_BUCKET` — **Production scope only**. Preview and Development stay on fixtures. | Per the README: Preview keeps `SNAPSHOT_SOURCE=fixtures`. Avoids leaking AWS creds into preview deploys for transient PRs. |
| Tests | Vitest unit test for the Layer's error mapping using a mocked `S3Client.send` — confirm `NoSuchKey` → `NotFound`, generic AWS error → `Upstream`, malformed JSON → `Decode`. **No live AWS calls in CI**, same posture as phases 01–03. End-to-end is verified manually by Tanner via `npm run dev` with `SNAPSHOT_SOURCE=s3`. | Schema/error-mapping regression is the load-bearing risk; live integration is a Tanner-runs-once smoke. |
| Frontend page changes | **None.** The three page loaders (`/platform-engagement`, `/market-engagement`, `/provisioned-users`) already fetch `/api/snapshot/...` and decode via Schema. Switching the source from fixtures to S3 is invisible to them. | Phase 01 designed the seam for exactly this swap. Touching pages here would be scope creep. |
| `npm run dev` ergonomics | Local dev defaults stay on `SNAPSHOT_SOURCE=fixtures`. To exercise the S3 path locally before deploying, set `SNAPSHOT_SOURCE=s3` and the four `SNAPSHOT_AWS_*` vars in `.env` — the same creds the deployed Vercel app uses. | Minimum disruption for the day-to-day dev loop; one env flip when verifying the swap. |

---

## Module / artifact layout after this phase

```
src/lib/server/
└── snapshot-source.ts             # SnapshotSourceS3 body filled in
                                   # SnapshotSourceFixtures unchanged
                                   # SnapshotSourceLive switch unchanged

src/lib/server/__tests__/
└── snapshot-source.test.ts        # NEW — error-mapping unit tests
                                   # (or co-located as snapshot-source.test.ts
                                   #  next to the source per the repo's pattern;
                                   #  pick whichever already exists)
```

No new files outside `src/lib/server/`. No package.json changes — `@aws-sdk/client-s3` is already a devDep from phase 03 (and gets bundled into the Vercel build automatically since the import is in `+server.ts`-reachable code).

`.env.example`: no changes — the four `SNAPSHOT_AWS_*` vars are already documented under "Phase 03 — manual local snapshot uploader" and now serve a second consumer. Add a one-line note that the same vars also feed the read-side in `src/lib/server/snapshot-source.ts`.

---

## Execution order

1. **Verify phase 03 acceptance is intact.**
   - `aws s3 ls s3://internal-tool-snapshots/bsmh/2026-04/` — confirm three keys (`metrics.json`, `market_metrics.json`, `provisioned_users.json`) with the expected `Cache-Control` headers.
   - `aws s3api head-object --bucket internal-tool-snapshots --key bsmh/2026-04/metrics.json` — confirm `ContentType: application/json`, `Cache-Control: public, max-age=31536000, immutable`.
   - If anything is off, re-run the phase 03 upload before starting code work.

2. **Implement `SnapshotSourceS3`** in `src/lib/server/snapshot-source.ts`.
   - Replace the loud-stub `Layer.succeed` with `Layer.effect`.
   - Read `SNAPSHOT_BUCKET`, `SNAPSHOT_AWS_REGION`, `SNAPSHOT_AWS_ACCESS_KEY_ID`, `SNAPSHOT_AWS_SECRET_ACCESS_KEY` from `$env/dynamic/private` at Layer-build time. If `SNAPSHOT_BUCKET` is unset, fail loudly (Layer build returns an error).
   - Construct the `S3Client` once at module scope (or once at Layer-build inside `Layer.effect`).
   - `read(client, month, file)` issues `GetObjectCommand` against `${SNAPSHOT_BUCKET}/${client}/${month}/${file}`, awaits `transformToString()`, parses JSON, returns `unknown`.
   - Error mapping:
     - `err.name === "NoSuchKey"` (or `$metadata.httpStatusCode === 404`) → `SnapshotSourceError({ kind: "NotFound", ... })`.
     - JSON parse failure → `SnapshotSourceError({ kind: "Decode", ... })`.
     - Anything else → `SnapshotSourceError({ kind: "Upstream", ... })`.
   - Add the `// TODO(phase-05): swap SNAPSHOT_AWS_* to dedicated read-only IAM principal scoped to internal-tool-snapshots/* before WorkOS launch.` marker next to the env read.

3. **Tests.**
   - Add `src/lib/server/snapshot-source.test.ts` (or matching the repo's existing test colocation pattern).
   - Mock the `S3Client.send` method to throw a fake `NoSuchKey` error — assert `kind: "NotFound"`.
   - Mock to throw a generic `AccessDenied` — assert `kind: "Upstream"`.
   - Mock to return a `Body` whose `transformToString` resolves to non-JSON — assert `kind: "Decode"`.
   - Mock to return valid JSON — assert the parsed object comes back unchanged (the route does its own Schema decode; the Layer just returns `unknown`).
   - `npm test` clean.

4. **Local smoke.**
   - In `.env`, set `SNAPSHOT_SOURCE=s3` and the four `SNAPSHOT_AWS_*` vars (copy from the working values used for `snapshot:upload`).
   - `npm run dev` and hit:
     - `/api/snapshot/bsmh/2026-04/metrics.json` — 200, JSON body matches `PlatformSnapshot`.
     - `/api/snapshot/bsmh/2026-04/market_metrics.json` — 200, matches `MarketSnapshot`.
     - `/api/snapshot/bsmh/2026-04/provisioned_users.json` — 200, matches `ProvisionedUsersSnapshot`.
     - `/api/snapshot/bsmh/2099-01/metrics.json` — 404 with `{kind: "NotFound"}`.
   - Force a Schema mismatch: `aws s3 cp` an intentionally-broken JSON to a throwaway month (e.g., `bsmh/9999-01/metrics.json`), then GET it — expect 500 with `{kind: "Decode"}`. Clean up the throwaway key after.

5. **Render the dashboard locally with `SNAPSHOT_SOURCE=s3`.**
   - `/platform-engagement?system=bsmh&start=2025-08&end=2026-02` — PostHog (live) drives the visible numbers; the snapshot's empty-array PostHog placeholders are not load-bearing here. Confirm no fixture fallback is triggered (no "source: fixture" in the loader output).
   - `/market-engagement` — RDS-sourced bars render from S3 directly. Selecting Lima highlights the Lima bar.
   - `/provisioned-users` — total + Lima KPIs and the user table render from S3 directly.
   - Network tab: the only fixture references should be in source maps, never in served data.

6. **Configure Vercel Production env vars.**
   - `vercel env add SNAPSHOT_SOURCE production` → `s3`
   - `vercel env add SNAPSHOT_BUCKET production` → `internal-tool-snapshots`
   - `vercel env add SNAPSHOT_AWS_REGION production` → `us-east-1`
   - `vercel env add SNAPSHOT_AWS_ACCESS_KEY_ID production` → Tanner's access key
   - `vercel env add SNAPSHOT_AWS_SECRET_ACCESS_KEY production` → Tanner's secret
   - **Preview scope:** leave unset, or explicitly set `SNAPSHOT_SOURCE=fixtures`.
   - **Development scope:** unchanged; local `.env` controls dev.
   - One quick sanity check: `vercel env ls` to confirm the five vars exist for `production` and not `preview`.

7. **Deploy + verify in production.**
   - `git push` triggers the Vercel build.
   - Once deployed, the production URL still returns 401 everywhere (no WorkOS yet). To verify the snapshot path end-to-end before phase 05, *temporarily* set `AUTH_BYPASS=1` for production via `vercel env add AUTH_BYPASS production` → `1`, redeploy, smoke-test the dashboard, then immediately remove the var (`vercel env rm AUTH_BYPASS production`) and redeploy. Document this in the deploy log so phase 05 knows to confirm the flag is not lingering.
   - **Alternative:** smoke-test on a Preview deploy with `AUTH_BYPASS=1` *and* `SNAPSHOT_SOURCE=s3` set on Preview scope only for that one PR. Cleaner — no prod env-flip dance — but requires temporarily exposing the AWS creds to Preview. Pick one; both are acceptable. Default: the production+temporary-bypass path, since it directly exercises the production env config.
   - Browser sanity: hit the deployed S3 URL directly (e.g., `https://internal-tool-snapshots.s3.us-east-1.amazonaws.com/bsmh/2026-04/metrics.json`) — must return 403, proving the bucket is private.

8. **Documentation.**
   - Update `04-site-reads-s3/README.md` § Acceptance to mark items checked.
   - Add a "What shipped" section at the bottom of this PLAN, mirroring phase 03's pattern, recording any deltas between plan and execution.
   - One-line note in `.env.example` near the `SNAPSHOT_AWS_*` block: "Also feeds the read side at `src/lib/server/snapshot-source.ts` when `SNAPSHOT_SOURCE=s3`."

---

## What this phase deliberately does NOT do

- **Merge live PostHog into `/api/snapshot`.** Snapshot stays RDS + Athena only. PostHog is fetched live by the page loaders via `/api/posthog/*` as a sibling. This was a misread of the design in phase 03's plan — the design has always been two sibling sources, not a hybrid response. (Phase 03 PLAN.md and README updated to remove the "merge" language.)
- **CloudFront.** Deferred to v2 per `../DESIGN.md` § 2. At 5–20 internal users with sub-100KB monthly JSON, the edge cache and free-egress arguments don't pay rent.
- **Dedicated read-only IAM principal.** Tanner's user is the prototype identity for both writer and reader. Phase 05 (WorkOS) is the cutover deadline. `// TODO(phase-05)` marker is the single grep target.
- **`s3:ListBucket` permission or any list-keys behavior.** We fetch by exact key. Listing is unnecessary and would require a broader IAM scope.
- **Custom domain on the read path.** Same v2 deferral as CloudFront.
- **Cross-region S3 / multi-region failover.** Out of scope.
- **WorkOS gating in front of `/api/snapshot/*`.** Phase 05. Today the route is gated by `AUTH_BYPASS` via `+layout.server.ts`; phase 05 swaps the body of `requireSession`.
- **Schema changes.** The current `PlatformSnapshot` / `MarketSnapshot` / `ProvisionedUsersSnapshot` shapes are the contract. Empty arrays for PostHog-derived fields stay as-is.

---

## Open questions to resolve before / during execution

- **S3 client construction granularity.** Module-scope vs. Layer-effect-scope. Module-scope is simpler and reuses the connection pool across Layer rebuilds (which shouldn't happen at runtime anyway). Default: module-scope.
- **`SnapshotBucket` env var as `Layer.effect` failure.** If `SNAPSHOT_SOURCE=s3` but `SNAPSHOT_BUCKET` is unset, the Layer's `read` should fail every request with a clear message *or* the Layer build itself should fail at startup. SvelteKit doesn't have a great "fail at startup" surface — the route handler is the first place the Layer is provided. Default: Layer build returns an error; the route handler maps it to a 500 with `{kind: "Upstream", message: "SNAPSHOT_BUCKET not configured"}`. Loud enough.
- **Production verification window.** The temporary `AUTH_BYPASS=1` in production trick (step 7) leaves a 1–2 minute window where the dashboard is publicly accessible. Acceptable risk because the data is BSMH 2026-04 (already in the investigation deck shared with stakeholders) and the window is bounded. If undesirable, use the Preview-scope alternative.
- **Vercel CLI vs. dashboard for env-var setup.** CLI keeps the steps script-able and grep-able; the dashboard is friendlier if Tanner doesn't have the Vercel CLI installed. Default: whichever Tanner already has wired (CLI was used for phase 01).

---

## Acceptance

- [ ] `npm test` passes (existing tests + new error-mapping tests for `SnapshotSourceS3`).
- [ ] `npm run check` clean.
- [ ] `npm run build` clean; the AWS SDK doesn't appear in the client bundle (`grep -r "@aws-sdk" .svelte-kit/output/client/` returns nothing).
- [ ] `npm run dev` with `SNAPSHOT_SOURCE=s3` and the four `SNAPSHOT_AWS_*` vars set:
  - `/api/snapshot/bsmh/2026-04/metrics.json` returns 200 JSON validated by `PlatformSnapshot`.
  - `/api/snapshot/bsmh/2026-04/market_metrics.json` returns 200 JSON validated by `MarketSnapshot`.
  - `/api/snapshot/bsmh/2026-04/provisioned_users.json` returns 200 JSON validated by `ProvisionedUsersSnapshot`.
  - `/api/snapshot/bsmh/2099-01/metrics.json` returns 404 with `{kind: "NotFound"}`.
  - A throwaway broken JSON in S3 returns 500 with `{kind: "Decode"}`.
  - `/platform-engagement`, `/market-engagement`, `/provisioned-users` render BSMH 2026-04 with no fixture fallback (loader's `source` field is `posthog` for platform; the other two pages don't expose source).
- [ ] Direct browser GET on the S3 URL returns 403 (bucket is private).
- [ ] Production Vercel env vars set: `SNAPSHOT_SOURCE=s3`, `SNAPSHOT_BUCKET`, `SNAPSHOT_AWS_*` (4 vars). Preview scope unchanged.
- [ ] One end-to-end production smoke (via temporary `AUTH_BYPASS` or Preview scope) confirms the dashboard renders against S3 from the deployed app.
- [ ] `// TODO(phase-05): swap SNAPSHOT_AWS_* to dedicated read-only IAM principal scoped to internal-tool-snapshots/* before WorkOS launch.` present next to the env read in `src/lib/server/snapshot-source.ts` (matches the existing marker in `scripts/snapshot/upload.ts`).

---

## What shipped

Recorded after the build so future phases can see deltas between plan and reality. (To be filled in once phase 04 lands.)
