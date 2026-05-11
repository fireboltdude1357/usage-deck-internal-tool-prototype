# Data flow

Two flows worth tracing end to end: a page load (request path) and the
monthly snapshot regeneration (offline producer).

## Request path: `/platform-engagement` for BSMH

1. **Browser → Vercel.** Same request whether the user just navigated or hit
   Refresh — the difference shows up later via the `refresh.nonce` flag.
2. **`hooks.server.ts`** runs `requireSession`. Page request, no cookie →
   302 to `/api/auth/login?return_to=/platform-engagement`. Cookie present
   and valid → continues.
3. **`+layout.server.ts`** surfaces `locals.session` to the page tree.
4. **`+page.ts` load (browser side)** for `/platform-engagement`:
   - Reads `selection.system` (`bsmh` etc.) from `$lib/selection.svelte.ts`.
   - Reads `refresh.nonce`; appends `&refresh=1` if non-zero.
   - `fetch("/api/posthog/bsmh/metrics?start=2025-08&end=2026-02[&refresh=1]")`.
5. **`/api/posthog/[client]/[metric]/+server.ts`**:
   - Schema-decodes `client` (`Client` literal) and `metric`
     (`"metrics" | "market" | "provisioned"`); 400 on either failure.
   - Schema-decodes `start` / `end` against `Month` regex; 400 on failure.
   - Logs `[posthog] → bsmh/metrics 2025-08..2026-02`.
   - Calls the matching pipeline (`runPlatformPipeline` here).
6. **`runPlatformPipeline`**:
   - Looks up `platform:bsmh:2025-08:2026-02` in the in-process cache. Hit
     (and not bypassed) → returns cached snapshot. Miss or bypass → runs
     `platformImpl`.
   - `platformImpl` runs three concurrent `fetch*` helpers (provider events,
     unit events, monthly activity), each independently cached. Each helper
     calls `fetchByMonth` → `runHogQL` per month with bisection on page-limit hits.
   - Aggregator (`buildPlatformSnapshot`) merges the typed event arrays
     into a `PlatformSnapshot`.
   - Schema-decodes the aggregator output. Mismatch → `PostHogError` `Decode`.
   - Writes the result back to the pipeline cache and returns.
7. **Back in the route handler**:
   - `Configuration` error → 503 (so the page loader knows to fall back to
     fixtures).
   - Anything else → 502 with `${kind}: ${message}`.
   - Otherwise → 200 with the snapshot JSON.
   - Logs `[posthog] ← bsmh/metrics 412ms ok` (or `… fail … kind: msg`).
8. **Page loader** decodes the response with `Schema.decodeUnknownSync(PlatformSnapshot)`
   and returns it to `+page.svelte`.

## Fallback to fixtures

If `/api/posthog/...` returns **503** specifically (PostHog not configured),
the page loader retries `/api/snapshot/bsmh/2026-04/metrics.json`. Any other
PostHog status surfaces as a `loadError` instead — fixtures aren't a generic
fallback for live failures.

The snapshot route's flow:

1. `hooks.server.ts` enforces auth (or 401).
2. `/api/snapshot/[client]/[month]/[file]/+server.ts` schema-decodes the three
   path params (404 on any mismatch) — this is also why `Client`, `Month`,
   `SnapshotFileSchema` are exported, not inlined.
3. Builds an Effect program: `SnapshotSource.read(client, month, file)` →
   `decodeForFile(file, raw)` → returns the typed snapshot.
4. Provides `SnapshotSourceLive` (S3 or fixtures, picked at module load).
5. Translates the tagged error: `NotFound` → 404, `Upstream` → 502, `Decode` → 500.

## Refresh button

`src/lib/refresh.svelte.ts` exports a runed `nonce` counter; `RefreshButton`
increments it. Page loaders check `refresh.nonce > 0` and append `&refresh=1`.
The PostHog route forwards `refresh: true` into the pipeline, which sets
`bypass: true` at both cache layers — fresh fetch, fresh aggregation, fresh
write-back.

The fixture path doesn't need a refresh hook (no cache, no upstream).

## Monthly snapshot pipeline

Manual run, once a month, from Tanner's laptop. Three commands, in order:

```sh
# 1. Pull RDS data through the bastion
npm run snapshot:query -- --client bsmh --month 2026-04

# 2. CSV → snapshot JSON, schema-validated at write
npm run snapshot:build -- --client bsmh --month 2026-04

# 3. Re-validate, PutObject to S3
npm run snapshot:upload -- --client bsmh --month 2026-04
```

Step 1: `scripts/snapshot/query.ts` opens an SSH tunnel via `rds/bastion.ts`,
substitutes `{{client}}` / `{{month}}` placeholders into each
`rds/queries/*.sql`, writes CSVs to `tmp/snapshot/bsmh/2026-04/`. Currently
that's `clinician-roster.csv`; add SQL files to extend.

Step 2: `scripts/snapshot/build.ts` reads `clinician-roster.csv`, runs the
three `shape/roster.ts` aggregators, schema-validates each via `schema-roundtrip.ts`,
writes `metrics.json` / `market_metrics.json` / `provisioned_users.json`
alongside the CSV. A schema mismatch exits non-zero.

Step 3: `scripts/snapshot/upload.ts` re-reads each JSON, decodes against the
schema again (defense in depth — local edits are easy), and `PutObjectCommand`s
to `s3://${SNAPSHOT_BUCKET}/bsmh/2026-04/{file}` with `Cache-Control: public,
max-age=31536000, immutable`. `--dry-run` prints what it would do.

Frequency: source data updates 1–2× per month; missing a Tuesday is fine.
The `Cache-Control: immutable` header is safe because the month is in the
URL — a re-upload would technically need a key bump if any consumer caches
were involved, but at current scale only the Vercel function fetches, and it
doesn't honor `immutable`.

## Why two paths?

- **PostHog is fast and cheap.** Engagement events are granular, the API
  responds in hundreds of ms, and there's no VPC. Snapshotting it would be
  busywork and stale within hours.
- **RDS is in a private VPC.** Live queries from Vercel would need
  VPC-attached compute (Lambda + interface endpoints, ~$60–100/mo idle).
  Monthly snapshot to S3 + IAM-authed S3 read from Vercel sidesteps that
  entirely at ~$0.07/mo storage.

Both paths produce the same `PlatformSnapshot` / `MarketSnapshot` /
`ProvisionedUsersSnapshot` shape, so page components don't care which one
served the data.
