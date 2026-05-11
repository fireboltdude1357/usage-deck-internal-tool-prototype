# internal-tool

SvelteKit dashboard for the Customer Success and Product teams. Auth-gated by
WorkOS (AuthKit + Google social provider, `@atalantech.com` allowlist), live
PostHog data on the engagement pages, monthly RDS-derived snapshots in S3 for
everything that needs the warehouse.

For the **how**, see `docs/`:

- [`docs/architecture.md`](docs/architecture.md) — every server-side seam.
- [`docs/data-flow.md`](docs/data-flow.md) — page loads + monthly snapshot pipeline.
- [`docs/operations.md`](docs/operations.md) — env vars, scripts, deploy.

The phase-by-phase design docs that drove the prototype build are frozen
under [`archive/design/`](archive/design/). Read for history; don't edit.

## Dev workflow

```sh
cp .env.example .env       # AUTH_BYPASS=1, SNAPSHOT_SOURCE=fixtures
npm install
npm run gen:fixtures       # encode mock data → fixtures/snapshots/bsmh/2026-04/*.json
npm run dev                # http://localhost:5173
```

Full env-var reference and script table live in
[`docs/operations.md`](docs/operations.md).

## Layout

```
src/
  hooks.server.ts         WorkOS gate (covers +server.ts too)
  lib/
    schema/snapshot.ts    Single source of truth for snapshot JSON shape
    server/
      auth.ts, workos.ts  requireSession + WorkOS client
      snapshot-source.ts  Effect Layer: fixtures or S3
      posthog/            HogQL client, pagination, queries, aggregator, pipeline, cache
    selection.svelte.ts   localStorage-backed selection state
    ui/                   Top bar, pickers, viz primitives (KpiTile, TimeSeries…)
    mock/                 Fixture data + fixture builder
  routes/
    +layout.{server.ts,svelte}
    +page.server.ts       307 → /platform-engagement
    platform-engagement/, market-engagement/, provisioned-users/
    api/
      auth/{login,callback,logout}/+server.ts
      posthog/[client]/[metric]/+server.ts
      snapshot/[client]/[month]/[file]/+server.ts
scripts/snapshot/         Monthly RDS → CSV → JSON → S3 pipeline
fixtures/snapshots/       Disk-backed fallback when SNAPSHOT_SOURCE=fixtures
docs/                     Living architecture docs
archive/design/           Frozen phase-design docs (history)
CLAUDE.md                 Per-area rules for keeping docs/ in sync with code
```
