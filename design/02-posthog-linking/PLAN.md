# 02 — Plan

**Status: shipped 2026-05-06.** See § "What shipped" at the bottom for deltas
between this plan and the executed work.

Implementation plan for the PostHog live-data integration. The README states
scope; this doc captures the load-bearing constraints (PostHog row & timeout
limits, project-rule on aggregation locus), names the defaults where the README
is silent, and lists the work in execution order.

The two artifacts that outlive this phase and become contracts for later phases:

1. **The metric-response JSON shapes** returned by `/api/posthog/[client]/[metric]`
   — they must match the existing `src/lib/schema/snapshot.ts` envelope so the
   frontend consumes one shape regardless of source. Phase 06 swaps in the
   S3-backed snapshot reader; nothing on the page-side changes.
2. **The PostHog client seam** (`src/lib/server/posthog/`) — the Effect-wrapped
   HogQL executor + canonical query builders. Same module is reusable when
   future metrics get added.

---

## Load-bearing constraints

These come from `parent-db-investigations/db-investigation/.claude/skills/posthog-query/`
(`SKILL.md`, `memory.md`) and `pitfalls.md`. They drive every other decision in
this plan, so they are surfaced first.

| Constraint | Source | Implication |
|---|---|---|
| **HogQL returns at most 100 rows by default.** | `data-sources.md` § PostHog Pagination | Every query that *might* return more must be paginated. Default strategy: per-month batching (one query per calendar month, concatenate). Sub-month split as fallback if a single month exceeds 100 rows (e.g., week-by-week). |
| **HogQL has a hard 10s server-side execution limit per query.** | `posthog-query/memory.md` § Timeout Behavior | We cannot extend it; we design around it. Many `OR`/`LIKE` clauses in one query will time out — loop per-ID instead. Pre-scope with `count()` + `GROUP BY` before pulling raw rows. |
| **P4: pull raw rows from PostHog, aggregate in code.** | `pitfalls.md` § P4 | Reverses the naive design (pre-aggregate via `GROUP BY` in HogQL, return small JSON). The `+server.ts` route fetches raw events month-by-month and aggregates in TypeScript before responding. Exceptions where SQL aggregation is allowed: row count would exceed pagination practicality (e.g., per-user monthly activity → `GROUP BY month, user_email` is canonical), or cross-system joins that can only happen in the database. |
| **URL-era catch-all is mandatory.** | `posthog-query/memory.md` § App URL Format Changes | Any query spanning pre-Oct 2025 must match `/regions/`, `/units/`, `/physicians/units/`, `/nurses/units/`. Missing eras silently drops data — iter 04 of market-engagement showed only 3 Lima loads when the true count was 974. The catch-all regex is baked into every query builder. |
| **One PostHog project, four clients.** | `data-sources.md` § PostHog Connection | Project ID `71649` for everyone. Clients are distinguished by `properties.\`client-username\`` (`bsmh` / `ssm` / `duke` / `ucsf`) and email-domain filters (`@mercy.com`/`@bshsi.org` for BSMH, etc.). The phase-02 README's "client → project mapping" wording predates this discovery — the actual mapping is `client → {client-username, email domains}`. |

---

## Decisions made here

| Decision | Default | Reason |
|---|---|---|
| Aggregation locus | **Raw events from PostHog → aggregate in TypeScript on the server route**, before returning dashboard JSON. Allowed exceptions: `GROUP BY month, user_email` for monthly-user-activity (raw page-loads explode), and any cross-system query that can only join in SQL. | P4 pitfall is explicit. Iteration history (iter 10 of platform-engagement) moved this direction for the same reasons: re-slicing without re-querying, auditability, and dodging the 100-row default. |
| Pagination strategy | **Per-month batching** (one HogQL query per calendar month in the requested range, results concatenated). Sub-month split (`timestamp >= '...-01' AND timestamp < '...-15'`) only kicks in if a month overflows. | Matches the existing investigation playbook and keeps each query well under both the 10s execution limit and the 100-row response limit. |
| Client-side fetch timeout | **30s per HogQL request.** | PostHog's own 10s execution limit is the ceiling for any single query, plus queue/network slack. 30s gives headroom without making a stuck connection hang the dashboard. |
| Retry policy | **1–2 retries on transient errors only** (5xx, network errors, fetch timeouts). **No retry on 4xx.** If PostHog reports a query timeout (4xx-style payload), surface it as an error rather than retry — the query itself is too expensive. | Avoids retry storms on bad queries; safe for transient blips. |
| Response caching | **In-process LRU cache, 15-minute TTL, keyed on `(client, metric, start, end)`.** Single Vercel serverless instance per request, so cache benefit is per-warm-instance only — that's still meaningful for back-to-back dashboard loads. | PostHog data updates monthly; sub-minute cache TTL is overkill, hour+ TTL risks staleness during the brief window a fresh export lands. 15 min is a comfortable middle ground; revisit after first month of production use. |
| Schema validation | `effect/Schema` decode of every PostHog response. The decoded shape feeds the aggregator; the aggregator's output is then validated against the `PlatformSnapshot` (etc.) Schema before responding. **Fail loudly on either side.** | A malformed PostHog response reaching the dashboard renders empty cells with no signal; the validation seam catches it at the integration boundary. |
| API surface | `GET /api/posthog/[client]/[metric]?start=YYYY-MM&end=YYYY-MM` — one route per metric. Returns the same JSON shape the existing `metrics.json` snapshot returns (matching `PlatformSnapshot`). | Simplest route shape; the frontend can swap a fixture-fetch for a PostHog-fetch with no other changes. Schema-compatible means phase 04 (S3 swap) is also a one-line change. |
| Auth | Inherits from `hooks.server.ts` — every route is auth-gated by `requireSession()`. No additional checks at the metric-route level. | Single auth seam; phase 05 swaps `requireSession` body and this route is unaffected. |
| Effect boundary | All HogQL execution + retry/timeout + schema decode in `src/lib/server/posthog/` using Effect v3. The route handler invokes the Effect program and converts to a Response. **No Effect in the browser bundle, no Effect in `+page.svelte`.** | Per `../DESIGN.md` § 6 — Effect lives at integration boundaries only. |
| API key handling | `POSTHOG_API_KEY` read via `$env/dynamic/private` only. **Never** `VITE_*`; never logged; never returned in responses. If unset, the route returns 503 with a clear message rather than crashing. | Per `../DESIGN.md` § Hard rules → "Credentials never in the browser bundle." |
| Frontend wiring | `/platform-engagement` page swaps its `+page.ts` fetch from `/api/snapshot/.../metrics.json` to `/api/posthog/[client]/metrics`. Other pages stay on fixtures (they need RDS / Athena, which is phase 03). | Phase 02 proves the live data path on one page; phase 03 widens it. |
| Fixture fallback | When `POSTHOG_API_KEY` is unset, `/api/posthog/...` returns 503 and the frontend falls back to the fixture path. Local dev without a key still renders. | Keeps the dev story working; matches the existing `SNAPSHOT_SOURCE=fixtures \| s3` flag pattern. |
| Tests | Vitest unit tests for: query builders (URL-era regex, date-range expansion, client-username injection), the aggregator (raw-event input → snapshot-shaped output), Schema decode of canned PostHog responses. **No live PostHog calls in CI.** | Same posture as phase 01 — Schema regression is the main risk; live integration is verified in dev. |

---

## Module layout after this phase

```
src/
├── lib/
│   ├── server/
│   │   ├── posthog/
│   │   │   ├── config.ts             # project ID, endpoint, per-client filter values
│   │   │   ├── client.ts             # Effect-wrapped HogQL executor: retry + 30s timeout + Schema decode
│   │   │   ├── queries.ts            # canonical HogQL builders per metric (URL-era catch-all baked in)
│   │   │   ├── pagination.ts         # per-month batcher with sub-month-split fallback
│   │   │   ├── aggregator.ts         # raw events → PlatformSnapshot-shaped JSON
│   │   │   ├── cache.ts              # in-process LRU, 15-min TTL
│   │   │   └── posthog.test.ts       # builders, aggregator, Schema decode (no live calls)
│   │   └── ...
│   ├── schema/
│   │   └── snapshot.ts               # unchanged — PostHog responses validate against the same shape
│   └── ...
├── routes/
│   └── api/
│       └── posthog/
│           └── [client]/
│               └── [metric]/
│                   └── +server.ts    # GET handler; auth via hooks.server.ts; calls into lib/server/posthog
```

---

## Execution order

1. **Config + client seam** (`config.ts`, `client.ts`).
   Effect-wrapped POST to `/api/projects/71649/query/`, 30s timeout, retry policy,
   API-key handling, Schema-decode of the PostHog response envelope.
2. **Pagination helper** (`pagination.ts`).
   Per-month iterator over a `{start, end}` range; sub-month split fallback when a
   month returns ≥ 100 rows. Used by every multi-month query.
3. **Query builders** (`queries.ts`).
   Canonical HogQL strings for the four platform-engagement queries
   (`provider-view-events`, `unit-view-events`, `monthly-user-activity`,
   `risk-factor-view-events` — last is optional in v1). URL-era catch-all regex
   baked in. Client-username + email-domain filters parameterized per client.
4. **Aggregator** (`aggregator.ts`).
   Pure function: `RawEvents → PlatformSnapshot` (KPIs, monthly series, top units).
   Mirrors the Python aggregation in `platform-engagement-metrics.md` § Build Script.
   Tested against canned event arrays.
5. **Cache** (`cache.ts`).
   Tiny in-process LRU keyed on `(client, metric, start, end)`. 15-min TTL.
6. **Route handler** (`/api/posthog/[client]/[metric]/+server.ts`).
   Wires it all together. Returns 503 if API key unset; 4xx for bad params; 200 + Schema-validated JSON otherwise.
7. **Frontend wiring** (`/platform-engagement/+page.ts`).
   Swap fetch URL from snapshot to PostHog path. Fall back to fixtures when the
   PostHog route returns 503.
8. **Tests + dev verification.**
   Vitest unit tests; one manual smoke test against the real PostHog project with
   a dev API key.

---

## What this phase deliberately does NOT do

- **Market engagement metrics from PostHog.** Per-market bars need RDS BU mapping (`provider_info_v2.businessunitname`); waits for phase 03.
- **Provisioned users from PostHog.** Sourced from RDS `provider_quit_risk_v2`; phase 03.
- **% of monitored clinicians.** Cross-system metric (PostHog viewers ÷ RDS roster); waits for phase 03 so both sides are live.
- **Multi-client.** v1 ships BSMH only — the config supports SSM/Duke/UCSF, but the dashboard only flips BSMH live this phase.
- **Cross-instance shared cache.** In-process LRU only. Redis/Upstash if usage justifies it later.
- **Background snapshot generation from PostHog.** PostHog stays live (per `../DESIGN.md` § 4); never snapshotted to S3.

---

## Open questions to resolve before / during execution

- **Dev API key.** `.env` has `POSTHOG_API_KEY=` blank; needs a real key before end-to-end smoke test. The unit tests don't need one.
- **Cache invalidation on selection change.** SystemPicker already calls `invalidate("app:selection")`; the PostHog route's cache key must include `client` so cache hits don't leak across clients. (Already in the plan; flagged here so it doesn't get missed in implementation.)
- **PostHog rate-limit posture.** Open question in the README. Not blocking v1 (5–20 internal users, infrequent visits) but worth measuring on first production day; if we get throttled, the cache TTL is the first knob.
- **Sub-month split threshold.** First implementation: if a month returns ≥ 100 rows, re-fetch as two halves. Revisit if any month routinely exceeds 200 rows — at that point per-week batching may be cheaper than two-pass.

---

## What shipped

Recorded after the build so future phases can see deltas between plan and reality.

### Built per plan
- `src/lib/server/posthog/{config,client,pagination,queries,aggregator,cache,pipeline}.ts` — module layout matches the plan exactly.
- `src/routes/api/posthog/[client]/[metric]/+server.ts` — replaces the 501 stub.
- Effect v3 wraps the HogQL POST: 30s `timeoutFail`, exponential retry × 2, `Schema.decodeUnknownEither` of `{results, columns}`, tagged `PostHogError` with `Configuration | Network | Timeout | BadStatus | Decode`.
- Per-month batching with recursive bisection (max depth 4) when a window hits the 100-row limit.
- Aggregator skips the two RDS-dependent KPIs (% monitored clinicians, true Logged-in provisioned users denominator); ships 5 KPIs + both monthly series + top-10 units (UUID-prefix labels until phase 03 swaps in human names).
- 15-minute in-process cache keyed on `(client, metric, start, end)`, success-only writes.
- Frontend prefers PostHog; falls back to fixture snapshot only on **503** so dev without a key still works.

### Added during build (not in original plan)
- **Server-side logging** at every layer — request/response, cache HIT/MISS/BYPASS, per-HogQL-query duration + row count, bisection events. Visible in `npm run dev` terminal and Vercel runtime logs.
- **Refresh button + `?refresh=1`** — `src/lib/refresh.svelte.ts` nonce store; `RefreshButton.svelte` lives in the top bar; `+page.ts` appends `&refresh=1` when the nonce is > 0; route + cache support a `bypass` flag that skips reads but still writes the fresh value back. Shows "Refreshing…" + spinner via `navigating` from `$app/state`.
- **`Schema.decodeUnknownSync` of the aggregator's output** against `PlatformSnapshot` inside the pipeline (caught and surfaced as a `Decode` error if invalid). Plan only specified Schema-decoding the PostHog response, but validating both sides of the boundary turned out cheap and useful.

### Numbers verified vs. fixture (BSMH 2025-08 → 2026-02)
- `Unique providers viewed`: **121** ✓ (matches fixture)
- `Unique units viewed`: **90** ✓
- `Active platform users`: **22** ✓
- `provider_views_by_month`: identical to fixture (9, 10, 68, 32, 27, 2, 28)
- `unit_views_by_month`: identical to fixture (91, 117, 66, 4, 16, 0, 8)
- `Recurring leaders` / `Retention rate`: live = **4 / 16, 25%**; fixture = **6 / 22, 27%**. Live impl follows the spec strictly (denominator = users active in the 5-month recurring window). Fixture appears to use the broader 7-month total as denominator. **Open: which interpretation is canonical?** Decision parked; both implementations produce sensible numbers.

### Performance observed
- Cold platform-engagement load: ~4–6 s (21+ HogQL calls; 2025-09 unit-events bisected because it returned exactly 100 rows).
- Warm cache hit: ~1 ms.
- `?refresh=1` bypass: ~1 s (PostHog's own server-side cache makes the second pass much faster than the first).

### Carried forward
- `% of monitored clinicians` and the proper `Logged-in provisioned users` denominator wait for phase 03 (RDS roster).
- Multi-client live wiring: config supports BSMH/SSM/Duke/UCSF; only `/platform-engagement` is flipped live for `bsmh`. Phase 03/04 widen.
- The recurring-leader denominator interpretation needs a one-line decision before that KPI is presented externally.
- Cache is in-process per Vercel instance; if hit-rate becomes load-bearing, Redis/Upstash is the next step (not needed for v1 traffic).
