# 04 — Site reads S3

Wire Vercel's `/api/snapshot/*` server route to read snapshots directly from
the S3 bucket created in phase 03. Drop the existing CloudFront stub.

CloudFront is **deferred to v2** — at 5–20 internal users with monthly
sub-100KB JSON, the edge cache and free-egress arguments don't pay rent.
Direct S3 reads keep the read path one IAM principal and one network hop.
The CloudFront option is documented in `../DESIGN.md` § 2 as the eventual
optimization if egress ever becomes a line item.

This phase combines the original phase 05 (CloudFront setup) and phase 06
(end-to-end dev verification).

## Scope

### IAM + env

- Dedicated IAM principal (or, for the prototype, Tanner's user — same env-var swap pattern as phase 03) with read-only access scoped to `internal-tool-snapshots/*`:
  - `s3:GetObject`, `s3:ListBucket` (the latter only if the read code lists keys; prefer fetching by exact key).
- Vercel env vars (Production scope only — Preview keeps `SNAPSHOT_SOURCE=fixtures`):
  - `SNAPSHOT_AWS_ACCESS_KEY_ID`, `SNAPSHOT_AWS_SECRET_ACCESS_KEY`, `SNAPSHOT_AWS_REGION=us-east-1`
  - `SNAPSHOT_BUCKET=internal-tool-snapshots`
  - `SNAPSHOT_SOURCE=s3`

### Code

- Replace the loud-stub `SnapshotSourceS3` Layer in `src/lib/server/snapshot-source.ts` with a real implementation: `@aws-sdk/client-s3` `GetObjectCommand` against `${SNAPSHOT_BUCKET}/${client}/${month}/${file}`. NoSuchKey → `NotFound`; other errors → `Upstream`; JSON parse failure → `Decode`.
- The route handler at `/api/snapshot/[client]/[month]/[file]` is unchanged — it already calls `SnapshotSource.read` then `Schema.decodeUnknown`. The Layer swap is the only behavioral change.
- Frontend pages are unchanged — they already prefer the snapshot path and fall back to fixtures only on 503/404 in dev.

### Verification

**Terminal phase:**
- `aws s3 ls s3://internal-tool-snapshots/bsmh/2026-04/` — confirm phase 03 wrote the expected keys.
- `aws s3api get-object --bucket internal-tool-snapshots --key bsmh/2026-04/metrics.json /dev/stdout` — confirm `ContentType: application/json`, `Cache-Control: public, max-age=31536000, immutable`.

**SvelteKit dev phase:**
- `npm run dev` locally with `SNAPSHOT_SOURCE=s3` and the `SNAPSHOT_AWS_*` vars set — same creds the deployed Vercel app uses.
- Hit `/api/snapshot/bsmh/2026-04/metrics.json` — should return JSON validated by `effect/Schema`, no fixture fallback.
- Force a Schema mismatch (upload an intentionally-broken JSON to a throwaway month) and confirm the route returns 500 with `{kind: "Decode"}` instead of a partially-rendered page.
- Render the BSMH 2026-04 dashboard end-to-end with `SNAPSHOT_SOURCE=s3` — every page that doesn't depend on PostHog (which is already live) should show real data with no fixture fallback.

## References

- `../DESIGN.md` § 2 (Snapshot store — S3 + CloudFront; v1 reads S3 directly, v2 adds CloudFront)
- `../DESIGN.md` § Data flow examples → "User loads BSMH, April 2026, Engagement"
- `../DESIGN.md` § 6 (Effect v3) — Schema validation as the load-bearing read-time contract
- `src/lib/server/snapshot-source.ts` — the seam this phase fills in

## Dependencies

- Phase 01 (the route + Schema + stub Layer all already exist).
- Phase 03 (need the bucket and at least one month of objects to read).

## Acceptance

- `SNAPSHOT_SOURCE=s3` in production. One client × one month renders end-to-end through Vercel → S3 → SvelteKit with no fixtures and no Schema warnings.
- Direct browser request to the S3 URL returns 403 (bucket is private; only the IAM principal can read).

## Out of scope (v2)

- CloudFront in front of S3. The read path is direct S3 in v1; CloudFront is a documented v2 optimization.
- CloudFront signed cookies for direct browser fetches. Same v2 deferral.
- Custom domain on the read path.
- Cross-region S3 / multi-region failover.
