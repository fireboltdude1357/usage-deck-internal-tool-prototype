# 01 — Plan

Implementation plan for the SvelteKit frontend phase. The README states scope; this
doc names the load-bearing decisions, picks defaults where the README is silent,
and lists the work in execution order.

The two artifacts that outlive this phase and become contracts for later phases:

1. **The snapshot JSON envelope** (`src/lib/schema/snapshot.ts`) — phase 03
   writes to it; phase 04 reads through it.
2. **The `requireSession` server seam** (`src/lib/server/auth.ts`) — phase 05
   replaces the body of one function and nothing else changes.

Everything else in this phase is local convenience that gets replaced once real
data and real auth land.

---

## Decisions made here

| Decision | Default | Reason |
|---|---|---|
| Svelte version | Svelte 5 (runes mode) | Stable since late 2024; matches the try-1 codebase the user already worked with. |
| Styling | Tailwind v3 (the LTS line) | Stable, every component library targets it, no v4 migration paper-cuts. |
| URL + navigation | One route per metric (`/platform-engagement`, `/market-engagement`, `/provisioned-users`) wrapped by a sticky top bar. System/market/time-range live in URL **query params** so navigating between metrics preserves the selection and links are shareable. | Per-metric routes match the natural information architecture (each metric is its own "page" in the existing investigation HTML). The top bar is the single place selectors live — no duplicated controls per page. |
| Top bar selectors | System (BSMH only in v1), Market (All + 6 BSMH markets), Time range (start month + end month). All persisted as URL query params. | "system or market and time range" per Tanner. Markets are scoped to the selected system. |
| Snapshot source | Env-flag-switched: `SNAPSHOT_SOURCE=fixtures` (default in dev) reads from `fixtures/snapshots/...` on disk; `SNAPSHOT_SOURCE=s3` (default in prod) hits the bucket directly. | Lets phase 01 be useful before phases 03/04 exist; the switch is a one-line config change after 04. |
| Fixture location | `fixtures/snapshots/{client}/{YYYY-MM}/{file}.json` at repo root (NOT under `static/`) | Mirrors the eventual S3 key shape exactly, so the read code path is identical. Outside `static/` so it doesn't ship to the CDN. |
| Snapshot scope | One snapshot file per system per generation-month, holding the **full window** of data (not pre-filtered by market or sub-range). Market and time-range filtering happens **client-side** on the loaded JSON. | Avoids the combinatoric explosion of `bsmh-lima-2026-04` × every range. Snapshot files stay <50 KB; client-side filtering is instant. |
| Placeholder session | `requireSession(event)` returns a stub user when `AUTH_BYPASS=1`, else 401. Default Vercel env: unset. Default local `.env`: `AUTH_BYPASS=1`. | Production deploy is fail-closed by default. Phase 07 swaps the function body. |
| Effect v3 boundary | Only `+server.ts` route bodies. `+page.svelte` and `+page.server.ts` stay vanilla SvelteKit. Per-handler runtime (no app-wide `ManagedRuntime`). | Per `../DESIGN.md` § 6; no shared warm state to justify `ManagedRuntime` yet. |
| Schema envelope | Stable outer shape (`client`, `month`, `generated_at`, `metrics`); inner shapes are **concrete in v1** so visualizations can render against them. Phase 03 must produce JSON matching these shapes. | The mock data drives the viz design; if Schema is loose, the cards have nothing to bind to. The contract is *tight now, not later*. |
| Visualization primitives | `KpiTile` (one big number + delta), plus chart components built on **LayerChart**: line/area for time series, bar for categorical, plus a simple `DataTable`. | Tanner picked a customizable chart library so phase-03+ metrics aren't constrained by hand-rolled SVG. LayerChart is Svelte-native, D3-based, and easy to drop down to D3 inside when needed. |
| Chart library | **LayerChart** (`layerchart`). Composable Svelte primitives over D3; supports line, area, bar, scatter, pie, and arbitrary custom geoms. | Right balance of declarative ergonomics + D3 escape hatch for future chart types. Apache ECharts considered — heavier, less Svelte-idiomatic, harder to customize at the SVG level. |
| Mock data source | Hand-derived from real CSV outputs at `../../../parent-db-investigations/db-investigation/investigations/bsmh-usage-deck/engagement/`. The mock module pulls real numbers from the latest iteration of each metric. | "Get seeded data from relevant investigations" per Tanner. Real numbers mean the visualizations look like the eventual production output, not toy data. |
| Adapter | `@sveltejs/adapter-vercel` (Node runtime, not Edge) | `node:fs` works for fixtures; `aws-sdk` is fine on Node. Edge would force a fixture rewrite for no current benefit. |
| Tests | Vitest for unit + Schema tests. No browser tests in this phase. | Enough to catch Schema-shape regressions; full E2E waits for phase 04. |

---

## Module layout after this phase

```
internal-tool/
├── package.json
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts                         # if Tailwind v4 needs one (v4 mostly doesn't)
├── .env.example                               # documents every env var; no secrets
├── fixtures/
│   └── snapshots/
│       └── bsmh/
│           └── 2026-04/
│               ├── metrics.json               # platform engagement metrics
│               ├── market_metrics.json        # market engagement metrics
│               └── provisioned_users.json     # provisioned-users metrics
├── src/
│   ├── app.html
│   ├── app.css                                # Tailwind directives
│   ├── lib/
│   │   ├── schema/
│   │   │   ├── snapshot.ts                    # envelope + per-file Schemas (the contract)
│   │   │   └── snapshot.test.ts
│   │   ├── server/
│   │   │   ├── auth.ts                        # requireSession() — phase 05 replaces body
│   │   │   ├── snapshot-source.ts             # Effect service: fixtures | s3 switch
│   │   │   └── posthog.ts                     # Effect service: PostHog query passthrough (stub in this phase)
│   │   ├── ui/
│   │   │   ├── TopBar.svelte              # sticky: system + market + time range
│   │   │   ├── SystemPicker.svelte
│   │   │   ├── MarketPicker.svelte
│   │   │   ├── TimeRangePicker.svelte
│   │   │   ├── ErrorCard.svelte
│   │   │   └── viz/
│   │   │       ├── KpiTile.svelte         # big number + label + optional delta/denominator
│   │   │       ├── TimeSeries.svelte      # LayerChart line/area for monthly series
│   │   │       ├── CategoryBars.svelte    # LayerChart horizontal bars (per-market, per-unit)
│   │   │       └── DataTable.svelte       # sortable rows (per-user roster)
│   │   ├── selection.ts                   # readSelection(url): {system, market, start, end}; writeSelection helper
│   │   ├── filter.ts                      # filterSeries(series, {start,end}); filterByMarket(rows, market)
│   │   └── mock/
│   │       ├── bsmh-2026-04.ts            # typed mock dataset (numbers from real investigation CSVs)
│   │       └── build.ts                   # tsx script: encodes mock → fixture JSON, Schema-validates
│   └── routes/
│       ├── +layout.svelte                     # mounts <TopBar>; wraps every metric route
│       ├── +layout.server.ts                  # session gate (applies to every route under /)
│       ├── +page.server.ts                    # redirect / → /platform-engagement (preserves query)
│       ├── api/
│       │   ├── snapshot/
│       │   │   └── [client]/[month]/[file]/+server.ts
│       │   └── posthog/
│       │       └── +server.ts                 # stub returns 501 with "phase 02 wires this"
│       ├── platform-engagement/
│       │   ├── +page.server.ts                # loads platform metrics.json
│       │   └── +page.svelte                   # KPI grid + time-series + top-units bar chart
│       ├── market-engagement/
│       │   ├── +page.server.ts                # loads market_metrics.json
│       │   └── +page.svelte                   # per-market bar charts (highlights selected market)
│       └── provisioned-users/
│           ├── +page.server.ts                # loads provisioned_users.json
│           └── +page.svelte                   # totals + Lima + user table
└── README.md                                  # repo-level dev workflow
```

---

## Snapshot Schema envelope (`src/lib/schema/snapshot.ts`)

```ts
import { Schema } from "effect"

export const Client = Schema.Literal("bsmh", "ssm", "duke", "ucsf")
export type Client = Schema.Schema.Type<typeof Client>

// BSMH markets per market-engagement-metrics.md § "BU Code to Market Mapping".
// "all" is the page-level "no market filter" sentinel (URL value), not a snapshot value.
export const Market = Schema.Literal(
  "Hampton Roads", "Lorain", "Lima", "Youngstown", "Kentucky", "Toledo",
)
export type Market = Schema.Schema.Type<typeof Market>

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
export const Month = Schema.String.pipe(
  Schema.filter((s) =>
    MONTH_PATTERN.test(s) ? undefined : "expected YYYY-MM",
  ),
)
export type Month = Schema.Schema.Type<typeof Month>

// Common envelope every snapshot file shares.
const envelope = <A, I>(metrics: Schema.Schema<A, I>) =>
  Schema.Struct({
    client: Client,
    month: Month,
    generated_at: Schema.String,                         // ISO8601
    source: Schema.Literal("athena", "rds", "posthog"),  // posthog never appears in snapshots in v1
    metrics,
  })

// --- Building blocks reused across the inner shapes ---

const Kpi = Schema.Struct({
  label: Schema.String,
  value: Schema.Number,
  denominator: Schema.optional(Schema.Number),  // for ratios like 22/37
  unit: Schema.optional(Schema.Literal("count", "percent", "per_month")),
  delta: Schema.optional(Schema.Number),        // % change vs. prior month, signed
})
const MonthPoint = Schema.Struct({ month: Month, value: Schema.Number })
const Series = Schema.Array(MonthPoint)
const CategoryBar = Schema.Struct({ label: Schema.String, value: Schema.Number })

// --- Inner shapes per snapshot file ---

const PlatformMetrics = Schema.Struct({
  kpis: Schema.Array(Kpi),                       // headline tiles
  provider_views_by_month: Series,
  unit_views_by_month: Series,
  top_units_viewed: Schema.Array(CategoryBar),   // top 10 by view count
})

// Per-market bars share a `market` key so the page can highlight the selected
// market and (optionally) filter to one row.
const MarketBar = Schema.Struct({ market: Market, value: Schema.Number })
const MarketMetrics = Schema.Struct({
  provider_views_by_market: Schema.Array(MarketBar),
  unit_views_by_market: Schema.Array(MarketBar),
  users_by_market: Schema.Array(MarketBar),
  clinicians_by_market: Schema.Array(MarketBar),
})

const UserRow = Schema.Struct({
  email: Schema.String,
  market: Schema.optional(Market),               // populated for users we can attribute
  page_loads: Schema.Number,
  active_days: Schema.Number,
  first_seen: Schema.String,                     // ISO8601 date
  last_seen: Schema.String,
})
const ProvisionedUsers = Schema.Struct({
  total: Kpi,                                    // 22 of 37 logged in
  lima: Kpi,                                     // 7 of 7
  user_detail: Schema.Array(UserRow),
})

export const PlatformSnapshot = envelope(PlatformMetrics)
export const MarketSnapshot = envelope(MarketMetrics)
export const ProvisionedUsersSnapshot = envelope(ProvisionedUsers)

export type PlatformSnapshot = Schema.Schema.Type<typeof PlatformSnapshot>
export type MarketSnapshot = Schema.Schema.Type<typeof MarketSnapshot>
export type ProvisionedUsersSnapshot = Schema.Schema.Type<typeof ProvisionedUsersSnapshot>

// Map file basename → Schema. The /api/snapshot/[file] route uses this to pick
// the right Schema for the requested file.
export const SnapshotByFile = {
  "metrics.json": PlatformSnapshot,
  "market_metrics.json": MarketSnapshot,
  "provisioned_users.json": ProvisionedUsersSnapshot,
} as const
export type SnapshotFile = keyof typeof SnapshotByFile
```

These inner shapes are the contract. Phases 03 and 04 must produce JSON that
decodes through `PlatformSnapshot` / `MarketSnapshot` / `ProvisionedUsersSnapshot`
without warnings. If a real query output needs a new field, the change happens
here first (PR against `snapshot.ts`) and then the export query is updated to
match — never the reverse.

The shapes were chosen by reading the metric docs and asking "what does the UI
need to render?":

- `Kpi` covers every "one big number" tile in the docs ("Unique providers
  viewed: 142", "% of monitored clinicians: 38%", "22 of 37 provisioned").
- `Series` (12 months of `{month, value}`) feeds the sparkline; matches the
  monthly aggregations in `platform-engagement-metrics.md` queries 1 and 2.
- `CategoryBar` feeds the horizontal bar charts; matches the per-market and
  per-unit breakdowns in `market-engagement-metrics.md`.
- `UserRow` matches BSMH user-detail query 2 in `provisioned-users.md`
  one-for-one.

---

## Mock data (`src/lib/mock/bsmh-2026-04.ts` → fixture JSON)

A single TypeScript module is the canonical source of mock numbers. A small
build step (`npm run gen:fixtures`, executes `tsx src/lib/mock/build.ts`)
serializes the typed objects into the three fixture JSON files at
`fixtures/snapshots/bsmh/2026-04/`. Single source of truth, edits are
type-checked against the Schema, no JSON-by-hand.

**Numbers come from the real investigation CSVs**, not invented. Source paths
(all relative to repo root):

```
../parent-db-investigations/db-investigation/investigations/bsmh-usage-deck/engagement/
├── platform-engagement-metrics/12-retention-workflow-visuals/results/
│   ├── monthly-user-activity.csv          → KPIs (unique users, retention) + monthly series
│   ├── provider-view-events.csv           → unique providers, provider views/month
│   ├── unit-view-monthly-counts.csv       → unit views by month (already aggregated)
│   ├── risk-factor-view-events.csv        → not surfaced in v1 UI
│   └── clinician-roster.csv               → denominator for % monitored clinicians
├── market-engagement-metrics/10-retention-workflow-visuals/results/
│   ├── provider-view-events.csv           → per-market provider views (group by bu_uuid → market)
│   ├── unit-view-events.csv               → per-market unit views
│   └── clinician-roster.csv               → clinicians by market (group by bu_code → market)
└── bsmh-provisioned-users/03-total-and-lima/outputs/provisioned-usage.html
                                           → 22/37 total, 7/7 Lima, per-user table
```

The mock module imports nothing from those paths at runtime — Tanner reads the
CSVs once, transcribes the relevant aggregations into the typed objects, and
commits both the mock module and the generated JSON. The investigation paths
are documented in a comment at the top of `bsmh-mock.ts` so a future maintainer
can re-derive.

```ts
// src/lib/mock/bsmh-2026-04.ts (excerpt — full numbers seeded from CSVs above)
import type { PlatformSnapshot, MarketSnapshot, ProvisionedUsersSnapshot } from "$lib/schema/snapshot"

export const platform: PlatformSnapshot = {
  client: "bsmh",
  month: "2026-04",
  generated_at: "2026-05-01T17:30:00Z",
  source: "posthog",
  metrics: {
    kpis: [
      // values: derived from monthly-user-activity.csv + provider-view-events.csv
      { label: "Unique providers viewed", value: 142, unit: "count" },
      { label: "% of monitored clinicians", value: 38, denominator: 374, unit: "percent" },
      { label: "Unique units viewed", value: 90, unit: "count" },
      { label: "Unique platform users", value: 22, denominator: 37, unit: "count" },
      { label: "Recurring leaders (3+ mo)", value: 14, denominator: 22, unit: "count" },
      { label: "Retention rate", value: 64, unit: "percent" },
    ],
    // monthly-user-activity.csv aggregated by month (real values)
    provider_views_by_month: [
      { month: "2025-08", value:  9 },   // 9 distinct user-sessions in Aug
      { month: "2025-09", value: 11 },
      // ... through 2026-02
    ],
    // unit-view-monthly-counts.csv straight transcription
    unit_views_by_month: [
      { month: "2025-08", value: 91 },
      { month: "2025-09", value: 117 },
      { month: "2025-10", value: 66 },
      { month: "2025-11", value: 4 },
      { month: "2025-12", value: 16 },
      { month: "2026-02", value: 8 },
    ],
    // top BUs from provider-view-events grouped by bu_uuid (use bu_name from clinician-roster as the label)
    top_units_viewed: [/* 10 items */],
  },
}

export const provisionedUsers: ProvisionedUsersSnapshot = {
  client: "bsmh",
  month: "2026-04",
  generated_at: "2026-05-01T17:30:00Z",
  source: "posthog",
  metrics: {
    total: { label: "Logged in", value: 22, denominator: 37, unit: "count" },
    lima:  { label: "Lima logged in", value: 7, denominator: 7, unit: "count" },
    // user_detail from per-user query in provisioned-users.md (rlreed had 1,975 page loads, etc.)
    user_detail: [/* 22 rows, real emails redacted to <prefix>@mercy.com / @bshsi.org */],
  },
}

export const market: MarketSnapshot = {
  client: "bsmh",
  month: "2026-04",
  generated_at: "2026-05-01T17:30:00Z",
  source: "posthog",
  metrics: {
    // group market-engagement-metrics CSVs by bu_code → market via the BU_CODE_MARKET map
    // in market-engagement-metrics.md § "BU Code to Market Mapping"
    provider_views_by_market: [/* 6 markets */],
    unit_views_by_market: [/* 6 markets */],
    users_by_market: [/* 6 markets */],
    clinicians_by_market: [/* 6 markets */],
  },
}
```

**On PII**: provisioned-users source data has real emails (`rlreed@mercy.com`,
etc.). The mock module uses obfuscated forms (`user01@mercy.com`,
`user02@bshsi.org`) so the fixture JSON in the repo doesn't carry PII. The
*counts and distributions* (1,975 page loads for the top user, 10 active days,
etc.) are real.

Updating mock numbers means editing this one file and re-running
`npm run gen:fixtures`. The Schema check at fixture-write time catches any
drift between the mock module and the contract.

---

## Selection state & top bar

The sticky top bar is the single source of UI state. It reads/writes URL
query params; pages bind to them. Schema:

```ts
// src/lib/selection.ts
import { Schema } from "effect"
import { Client, Market, Month } from "$lib/schema/snapshot"

export const Selection = Schema.Struct({
  system: Client,                                // v1: only "bsmh" selectable
  market: Schema.Union(Schema.Literal("all"), Market),
  start: Month,
  end: Month,
})
export type Selection = Schema.Schema.Type<typeof Selection>

export const DEFAULT_SELECTION: Selection = {
  system: "bsmh",
  market: "all",
  start: "2025-08",
  end: "2026-02",
}

export const readSelection = (url: URL): Selection => { /* parse + fall back to defaults */ }
export const writeSelection = (url: URL, partial: Partial<Selection>): string => { /* return new URL string */ }
```

`<TopBar>` renders three sub-components and calls `goto(writeSelection(...))`
on every change with `{ keepFocus: true, noScroll: true, replaceState: true }`
so the back button doesn't get spammed.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  internal-tool                  [BSMH ▾]  [All markets ▾]  Aug 2025 → Feb 2026 │
│  ─────────────────────────────────────────────────────────────────────── │
│  Platform engagement   Market engagement   Provisioned users             │
└──────────────────────────────────────────────────────────────────────────┘
```

Tabs are `<a href>` links so each metric route is independently navigable
(SvelteKit preserves the query string across `<a>` clicks within the same
origin, but we explicitly thread the current `url.search` into each tab's
`href` to make this guarantee load-bearing rather than coincidental).

---

## Per-metric page composition

Each `+page.server.ts` does:

1. `await requireSession(event)` — handled by the parent `+layout.server.ts`,
   so this is automatic.
2. `selection = readSelection(event.url)`.
3. `event.fetch('/api/snapshot/' + selection.system + '/2026-04/' + file)` for
   the file relevant to this page (`metrics.json` /`market_metrics.json` /
   `provisioned_users.json`).
4. Pass `{ selection, snapshot }` to the page.

Each `+page.svelte` applies the selection's `market` and `start/end` to the
snapshot client-side via helpers in `src/lib/filter.ts`, then renders.

### `/platform-engagement`

- 6 `<KpiTile>` driven by `metrics.kpis`.
- `<TimeSeries>` for `provider_views_by_month` and `unit_views_by_month`,
  filtered to `[start, end]`.
- `<CategoryBars>` for `top_units_viewed` (top 10).
- Market filter: shown but inert on this page (a "(market filter not applied
  to platform-wide metrics)" annotation under the top bar). Honest about what
  the data supports.

### `/market-engagement`

- 4 `<CategoryBars>` (provider views, unit views, users, clinicians) — one
  bar per market.
- When `selection.market !== "all"`, the selected market's bar is highlighted
  (`fill-blue-600` vs. `fill-blue-300`); other bars dim.
- Time range filter: also inert on this page in v1 (the market snapshot
  is already aggregated over the snapshot's window; per-month per-market
  series is a phase 03 enhancement). Show the same annotation.

### `/provisioned-users`

- Two `<KpiTile>`: `total` and `lima`.
- `<DataTable>` of `user_detail`. When `selection.market !== "all"`, filter
  rows to that market via `UserRow.market`.

If a snapshot fetch fails → `<ErrorCard>` for that page (the other tabs are
still navigable).

---

## Visualization primitives

Built on **LayerChart** (`layerchart` npm package, Svelte-native, D3-based).
Each component takes typed props from the Schema and is roughly 30–80 lines.

- **`KpiTile`** — pure Tailwind, no chart lib. Props `{ kpi: Kpi }`. Renders
  `value` large, `label` small, `value / denominator (pct%)` when denominator
  is present, optional ▲/▼ pill for `delta`.
- **`TimeSeries`** — LayerChart `<Chart><Svg><Axis/><Line/><Points/></Svg></Chart>`
  composition. Props `{ series: Series; label: string }`. Linear X scale
  over months, linear Y from `[0, max]`. Smooth area fill optional via
  prop. ~70 lines.
- **`CategoryBars`** — horizontal LayerChart bars. Props
  `{ bars: { label: string; value: number; highlight?: boolean }[] }`.
  Label column on the left, bars in the middle, value at the right edge.
  `highlight` controls fill color (used by market-engagement's selection
  highlight). ~60 lines.
- **`DataTable`** — plain `<table>` with click-to-sort headers. Props
  `{ rows: UserRow[]; columns: { key, label }[] }`. Tailwind row striping.
  No pagination (22 rows).

LayerChart's "drop down to D3" surface is the escape hatch for future chart
types. For v1 the three composed components above cover every visualization
the metric docs describe.

---

## Snapshot source switch (`src/lib/server/snapshot-source.ts`)

```ts
import { Effect, Layer, Context, Schema } from "effect"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { SnapshotByFile, type SnapshotFile } from "$lib/schema/snapshot"

export class SnapshotSourceError extends Schema.TaggedError<SnapshotSourceError>()(
  "SnapshotSourceError",
  { kind: Schema.Literal("NotFound", "Upstream", "Decode"), message: Schema.String },
) {}

export interface SnapshotSource {
  readonly read: (
    client: string,
    month: string,
    file: SnapshotFile,
  ) => Effect.Effect<unknown, SnapshotSourceError>
}
export const SnapshotSource = Context.GenericTag<SnapshotSource>("SnapshotSource")

// Fixtures: read from disk relative to repo root.
export const SnapshotSourceFixtures = Layer.succeed(SnapshotSource, {
  read: (client, month, file) =>
    Effect.tryPromise({
      try: () =>
        fs.readFile(
          path.join(process.cwd(), "fixtures", "snapshots", client, month, file),
          "utf8",
        ).then(JSON.parse),
      catch: (e) =>
        new SnapshotSourceError({ kind: "NotFound", message: String(e) }),
    }),
})

// S3: stub in this phase — throws to make accidental prod use loud.
// Phase 04 fills in the body once the bucket exists.
export const SnapshotSourceS3 = Layer.succeed(SnapshotSource, {
  read: () =>
    Effect.fail(
      new SnapshotSourceError({
        kind: "Upstream",
        message: "S3 source not wired yet — phase 04",
      }),
    ),
})

export const SnapshotSourceLive =
  process.env.SNAPSHOT_SOURCE === "s3"
    ? SnapshotSourceS3
    : SnapshotSourceFixtures
```

The `/api/snapshot/[client]/[month]/[file]/+server.ts` route then:

1. Calls `requireSession(event)` — 401 on miss.
2. Validates the route params (`client`, `month`, `file`) against `Client`,
   `Month`, `Schema.KeyOf(SnapshotByFile)`.
3. `yield* SnapshotSource.read(...)`, then `Schema.decodeUnknown(SnapshotByFile[file])`.
4. Returns the decoded JSON. On `SnapshotSourceError` — 404 (NotFound), 502
   (Upstream), 500 (Decode) — with a small JSON error body that includes the
   error kind.

`Effect.runPromise(program.pipe(Effect.provide(SnapshotSourceLive)))`.

---

## Placeholder session gate (`src/lib/server/auth.ts`)

```ts
import type { RequestEvent } from "@sveltejs/kit"
import { error } from "@sveltejs/kit"

export type Session = { user: { email: string } }

// Phase 05 replaces the body of this function with a real WorkOS check.
// The signature is the contract: keep it.
export async function requireSession(event: RequestEvent): Promise<Session> {
  if (process.env.AUTH_BYPASS === "1") {
    return { user: { email: "dev@local" } }
  }
  throw error(401, "Not signed in")
}
```

`AUTH_BYPASS` is unset by default on Vercel, so the production deploy returns
401 on every request until phase 05 wires WorkOS. That's the intended
fail-closed posture.

---

## Routes

### `+layout.server.ts` (root)

```ts
import { requireSession } from "$lib/server/auth"
export const load = async (event) => {
  await requireSession(event)
  return {}  // session shape can be added here when phase 05 lands
}
```

Applies to every route, including `/api/*`. One gate, no per-route
duplication.

### `+layout.svelte` (root)

Mounts `<TopBar>` (sticky) and `<slot />`. The TopBar reads
`$page.url` reactively — every metric route under it is wrapped.

### `/` → redirect

`src/routes/+page.server.ts`:

```ts
import { redirect } from "@sveltejs/kit"
import { writeSelection, DEFAULT_SELECTION } from "$lib/selection"
export const load = ({ url }) => {
  const target = "/platform-engagement" + writeSelection(url, DEFAULT_SELECTION)
  redirect(307, target)
}
```

### `/platform-engagement`, `/market-engagement`, `/provisioned-users`

Each per "Per-metric page composition" above. The three pages share the
same `+page.server.ts` shape; only the file fetched and the page body differ.

### `/api/snapshot/[client]/[month]/[file]/+server.ts`

Effect program: validate route params (`client`, `month`, `file` against
their Schemas) → `yield* SnapshotSource.read` → `Schema.decodeUnknown` against
`SnapshotByFile[file]` → return JSON. On `SnapshotSourceError`: 404
(`NotFound`), 502 (`Upstream`), 500 (`Decode`). `Effect.runPromise` provides
`SnapshotSourceLive`.

The session gate is applied by `+layout.server.ts`, not duplicated here.

### `/api/posthog/+server.ts`

Stub: returns `501 { error: "phase 02 wires this" }`. Mount point exists so
phase 02 has a known URL and the platform-engagement page can render an
"awaiting PostHog" empty state without a 404.

---

## Vercel deployment

This phase ends with a deployed (broken-but-routable) Vercel app. "Broken" =
returns 401 everywhere because `AUTH_BYPASS` isn't set. That's correct.

Steps:

1. `npm install -g vercel` (if not present); `vercel login`.
2. From the repo root: `vercel link` (creates the project).
3. `vercel env add AUTH_BYPASS development` → `1`. Leave `production` and
   `preview` unset.
4. `vercel env add SNAPSHOT_SOURCE development` → `fixtures`. Leave the others
   unset (defaults to fixtures, but the stub S3 Layer fails loudly if accidentally
   set in prod).
5. `vercel env add` for the eventual real vars, all left blank or marked as
   "fill in phase X":
   - `SNAPSHOT_AWS_ACCESS_KEY_ID`, `SNAPSHOT_AWS_SECRET_ACCESS_KEY`,
     `SNAPSHOT_AWS_REGION`, `SNAPSHOT_BUCKET` — phase 03 (writer) and phase 04 (reader).
   - `POSTHOG_API_KEY` — phase 02.
   - `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`,
     `WORKOS_COOKIE_PASSWORD` — phase 05.
6. `git push` triggers the Vercel build and deploy.
7. **Verify**: production URL returns 401 on every route (`AUTH_BYPASS` not
   set in prod). `vercel dev` locally with `.env` containing `AUTH_BYPASS=1`
   renders the BSMH dashboard against the fixture.

---

## Tasks (execution order)

1. **Scaffold.** `npm create svelte@latest`, add `@sveltejs/adapter-vercel`,
   `effect`, `@effect/platform`, `tailwindcss@^3`, `postcss`, `autoprefixer`,
   `layerchart`, `vitest`, `tsx`, `@types/node`. Configure Tailwind v3
   (`tailwind.config.ts` + `app.css` directives), Svelte 5 runes mode,
   `svelte.config.js` with `adapter-vercel` (Node runtime), `tsconfig.json`
   with `strict: true`.
2. **Schema.** Author `src/lib/schema/snapshot.ts` (envelope + `Kpi`,
   `Series`, `CategoryBar`, `MarketBar`, `UserRow`, `Market`, three snapshot
   Schemas) and `snapshot.test.ts` covering: each Schema round-trips its mock
   object; rejects a malformed inner field; rejects an unknown `Market`
   literal.
3. **Selection state.** Author `src/lib/selection.ts` (`Selection` Schema,
   `DEFAULT_SELECTION`, `readSelection`, `writeSelection`) and
   `src/lib/filter.ts` (`filterSeries`, `filterByMarket`). Unit tests in
   `selection.test.ts` and `filter.test.ts`.
4. **Mock + fixture build.** Read the CSVs at the investigation paths
   listed in **Mock data**. Aggregate the per-month / per-market values by
   hand into `src/lib/mock/bsmh-2026-04.ts`. Author
   `src/lib/mock/build.ts` — a `tsx` script that
   `Schema.encodeSync`s the typed mocks and writes the three JSON files
   under `fixtures/snapshots/bsmh/2026-04/`. Wire `npm run gen:fixtures`.
   Run it; commit both the mock module and the generated JSON.
5. **Auth seam + layout gate.** Author `src/lib/server/auth.ts` and
   `src/routes/+layout.server.ts` calling it.
6. **Snapshot source.** Author `src/lib/server/snapshot-source.ts` with the
   fixtures Layer working and the S3 Layer as a loud stub.
7. **Snapshot route.** Author
   `src/routes/api/snapshot/[client]/[month]/[file]/+server.ts` — Effect
   program that validates params → reads → decodes → returns. Manual smoke:
   `curl http://localhost:5173/api/snapshot/bsmh/2026-04/metrics.json` with
   `AUTH_BYPASS=1` returns the fixture.
8. **PostHog stub.** Author `src/routes/api/posthog/+server.ts` returning
   `501 { error: "phase 02 wires this" }`.
9. **Viz primitives.** Author `KpiTile`, `TimeSeries`, `CategoryBars`,
   `DataTable` in `src/lib/ui/viz/`. Each takes typed props from the Schema
   types — no `any`. LayerChart components verified against the official
   docs via the svelte MCP server's `get-documentation` tool. Verify in
   isolation by importing into a throwaway `/test-viz` route.
10. **Top bar + sub-pickers.** Author `TopBar`, `SystemPicker`,
    `MarketPicker`, `TimeRangePicker`, `ErrorCard` in `src/lib/ui/`. The
    pickers read `$page.url`, write via `goto(writeSelection(url, partial))`
    with `replaceState: true`. Use the svelte MCP `svelte-autofixer` after
    each component.
11. **Layout shell.** Author `src/routes/+layout.svelte` mounting `<TopBar>`
    + tab nav + `<slot />`.
12. **Per-metric pages.** Author the three pages
    (`/platform-engagement`, `/market-engagement`, `/provisioned-users`),
    each with its `+page.server.ts` (load snapshot + selection) and
    `+page.svelte` (apply filters, render viz). Verify in `npm run dev` with
    `AUTH_BYPASS=1` that each page renders against the BSMH mock.
13. **Root redirect.** `src/routes/+page.server.ts` redirects to
    `/platform-engagement` with default selection in the query string.
14. **Vercel link + deploy.** Per "Vercel deployment" above. Confirm the
    production URL returns 401 and the preview URL with `AUTH_BYPASS=1` set
    serves the dashboard.
15. **Repo README.** One-page dev workflow: `cp .env.example .env`,
    `npm install`, `npm run gen:fixtures`, `npm run dev`. Document
    `AUTH_BYPASS`, `SNAPSHOT_SOURCE`, where mock data lives (and where the
    investigation CSVs live), and how to regenerate fixtures after editing.

Tasks 2–6 have no inter-dependencies and can be parallelized if a build
agent splits them. Task 9 (viz primitives) and Task 10 (pickers) can run
in parallel with 5–8. Tasks 7, 11, 12, 13 are sequential.

---

## Acceptance

- [ ] `npm test` passes (Schema, selection, filter unit tests).
- [ ] `npm run gen:fixtures` regenerates the three JSON files from
  `src/lib/mock/bsmh-2026-04.ts` and Schema-validates them at write time.
- [ ] `npm run check` (svelte-check) clean.
- [ ] `npm run build` clean; `grep -r "AWS_SECRET\|POSTHOG_API_KEY" .svelte-kit/output/client/` returns nothing.
- [ ] `npm run dev` with `AUTH_BYPASS=1` and `SNAPSHOT_SOURCE=fixtures`:
  - `/` redirects to `/platform-engagement?system=bsmh&market=all&start=2025-08&end=2026-02`.
  - All three metric pages render against the BSMH mock with no empty cards:
    - `/platform-engagement`: 6 KPI tiles, two LayerChart time series,
      top-units bar chart.
    - `/market-engagement`: four per-market bar charts.
    - `/provisioned-users`: total + Lima tiles, user-detail table.
  - Tab clicks preserve the query string across navigation.
  - Changing the market picker to "Lima" highlights the Lima bar on
    `/market-engagement` and filters the user table on `/provisioned-users`.
  - Changing the time range filters the time-series charts on
    `/platform-engagement`.
- [ ] `npm run dev` without `AUTH_BYPASS`: every route returns 401, including
  the metric pages and `/api/snapshot/*`.
- [ ] Vercel production URL deploys and returns 401 on every route.
- [ ] Forcing a Schema mismatch (rename `client` → `clientz` in the fixture)
  causes the snapshot route to return 500 with `{kind: "Decode"}`, not a
  partially-rendered page.
- [ ] Editing a value in `src/lib/mock/bsmh-2026-04.ts`, re-running
  `npm run gen:fixtures`, and reloading reflects the new number on the page
  it appears on — proves the mock pipeline is the single source of truth.
- [ ] No raw email addresses from real investigations appear in the committed
  fixture JSON (all obfuscated to `userNN@<domain>` form).

---

## Decisions resolved with Tanner (2026-05-01)

| Question | Resolution |
|---|---|
| URL shape | Per-metric routes (`/platform-engagement`, `/market-engagement`, `/provisioned-users`) under a sticky top bar; system/market/time-range live in URL query params. |
| Default redirect target | Hardcoded `/platform-engagement` with `DEFAULT_SELECTION` query string. |
| Tailwind | v3 (LTS), not v4. |
| Chart library | LayerChart — Svelte-native, D3-based, customizable for future chart types. |
| Mock data fidelity | Seed from real CSVs in `../parent-db-investigations/db-investigation/investigations/bsmh-usage-deck/engagement/`. Real numbers, obfuscated emails. |
| Multi-client fixtures | BSMH only for v1. Other systems return 404 if selected (sentinel for "not yet snapshotted"). |
| Vercel runtime | Node (not Edge). |
| Effect runtime composition | Per-handler `runPromise` with `SnapshotSourceLive`. No app-wide `ManagedRuntime` until shared warm state exists. |

Remaining open question, not blocking start of work:

- **System picker UX in v1**: BSMH is the only selectable system. Should
  the picker show SSM/Duke/UCSF as disabled options ("data not yet
  available") or hide them entirely? Default proposal: show as disabled
  with a tooltip. Easy change either way.

---

## Out of scope for this phase (carry-overs from the README)

- WorkOS — phase 05.
- Live PostHog — phase 02.
- Real S3 — phases 03 (writer) and 04 (reader). CloudFront deferred to v2.
- More than one client's fixture data.
- Per-user permissions beyond "is signed in".
- Custom domain on the Vercel project.
