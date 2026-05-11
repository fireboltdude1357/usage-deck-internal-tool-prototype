# Plan: dev → S3 + per-client market & time-range pickers

Written 2026-05-11. Survives `/clear` so a fresh Claude session can pick this up.

Context: S3 holds full backfill for 4 clients (see
`~/.claude/projects/.../memory/snapshot_pipeline_state_2026_05.md`).
Per-client coverage:
- bsmh — 2025-08 → 2026-03 (8 months) — has `success_stories.json`
- ssm  — 2025-12 → 2026-03 (4 months)
- duke — 2023-08 → 2025-12 (29 months) — has `success_stories.json`
- ucsf — 2023-07 → 2025-06 (24 months)

The SystemPicker dropdown is already enabled for all four clients;
`src/lib/snapshot-months.ts` exports `LATEST_SNAPSHOT_MONTH` and is wired into
the four page loaders. Remaining work: dev points at S3, MarketPicker hides
for non-bsmh, TimeRangePicker reads per-client.

---

## Phase 1 — Point dev to S3

Edit `.env`:
- `SNAPSHOT_SOURCE=fixtures` → `SNAPSHOT_SOURCE=s3`
- Add `SNAPSHOT_BUCKET=internal-tool-snapshots`

AWS creds come from `~/.aws/credentials` via the SDK default chain — already
working (the 2026-05-11 backfill used the same path). No `SNAPSHOT_AWS_*` env
vars needed.

Smoke-test:
```sh
npm run dev
# from another terminal
for c in bsmh ssm duke ucsf; do
  case $c in bsmh|ssm) m=2026-03;; duke) m=2025-12;; ucsf) m=2025-06;; esac
  curl -sS -o /dev/null -w "%s %s/%s -> %s\n" "$c" "$c" "$m" \
    "http://localhost:5173/api/snapshot/$c/$m/metrics.json"
done
```
All four should be 200. Note: local dev still needs `AUTH_BYPASS=1` or a
WorkOS session — if `AUTH_BYPASS` is commented out in `.env`, the snapshot
route returns 401.

---

## Phase 2 — Per-client market and time-range pickers

### 2a. Extend `src/lib/snapshot-months.ts`

Add to the existing file:

```ts
export const AVAILABLE_MONTHS: Record<Client, readonly Month[]> = {
  bsmh: [
    "2025-08", "2025-09", "2025-10", "2025-11",
    "2025-12", "2026-01", "2026-02", "2026-03",
  ],
  ssm: ["2025-12", "2026-01", "2026-02", "2026-03"],
  duke: [
    "2023-08", "2023-09", "2023-10", "2023-11", "2023-12",
    "2024-01", "2024-02", "2024-03", "2024-04", "2024-05",
    "2024-06", "2024-07", "2024-08", "2024-09", "2024-10",
    "2024-11", "2024-12",
    "2025-01", "2025-02", "2025-03", "2025-04", "2025-05",
    "2025-06", "2025-07", "2025-08", "2025-09", "2025-10",
    "2025-11", "2025-12",
  ],
  ucsf: [
    "2023-07", "2023-08", "2023-09", "2023-10", "2023-11", "2023-12",
    "2024-01", "2024-02", "2024-03", "2024-04", "2024-05", "2024-06",
    "2024-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12",
    "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
  ],
}

// Default range = trailing 7 months ending at the latest available month.
// Pick something small enough to keep PostHog queries fast but long enough
// to show a trend.
export const defaultRange = (client: Client): { start: Month; end: Month } => {
  const ms = AVAILABLE_MONTHS[client]
  return {
    start: ms[Math.max(0, ms.length - 7)],
    end: ms[ms.length - 1],
  }
}
```

Same list is hard-coded in `scripts/snapshot/backfill-all.sh`. Add a
comment in both files telling future-you to keep them in sync.
`LATEST_SNAPSHOT_MONTH[c]` should equal `AVAILABLE_MONTHS[c].at(-1)` — add
a one-line assert at module load to catch drift.

### 2b. Extend `src/lib/selection.svelte.ts`

- Update `DEFAULT_SELECTION` to use `defaultRange("bsmh")` for `start`/`end`.
- Add a `setSystem(client: Client)` method on `selection` that atomically
  sets `system`, resets `market` to `"all"`, and sets `start`/`end` to
  `defaultRange(client)`. Persists once.
- Inside `loadInitial()`, after `decode(...)` succeeds, sanity-check the
  persisted value:
  - If `start` or `end` is not in `AVAILABLE_MONTHS[system]`, replace both
    with `defaultRange(system)`.
  - If `system !== "bsmh"` and `market !== "all"`, force `market = "all"`.
- These keep older localStorage payloads from rendering broken pickers.

### 2c. Update `src/lib/ui/SystemPicker.svelte`

Change the `onChange` handler to call `selection.setSystem(target.value)`
instead of `selection.set({ system: target.value })`.

### 2d. Update `src/lib/ui/TopBar.svelte`

Wrap `<MarketPicker />` in `{#if selection.system === "bsmh"}`. Don't
delete the component — keep it for when/if other clients gain markets.

### 2e. Update `src/lib/ui/TimeRangePicker.svelte`

Replace the hard-coded `MONTHS` const with a reactive `$derived` that
reads `AVAILABLE_MONTHS[selection.system]`. The dropdowns repopulate when
the system changes; `setSystem` has already reset `start`/`end` to valid
values, so no extra guards are needed inside this component.

### 2f. Verify

```sh
npm test && npm run check
npm run dev
```

Walk through each client:
- bsmh — MarketPicker visible, 8 months in range picker
- ssm  — MarketPicker hidden, 4 months in range picker
- duke — MarketPicker hidden, 29 months in range picker, success-stories renders
- ucsf — MarketPicker hidden, 24 months in range picker, success-stories shows the "no data yet" card

`npm test`: 93/93 pre-change; expect the same after.

---

## Phase 3 — Docs (per CLAUDE.md)

- `docs/architecture.md` § Frontend — note `setSystem` resets market+range, MarketPicker is BSMH-only
- `docs/operations.md` § Dev workflow — flip `.env.example` quickstart from `fixtures` to `s3`, note AWS default-chain
- `docs/operations.md` § Known operational gotchas — add a row about persisted-selection clamping

---

## Out of scope (flagged for later)

1. `src/routes/platform-engagement/+page.ts` hardcodes
   `FETCH_WINDOW = { start: "2025-08", end: "2026-02" }` instead of using
   `selection.start`/`selection.end`. Other three pages use the selection.
   Looks like a bug, not addressed here.
2. The writer/reader asymmetry on `SNAPSHOT_BUCKET` — `upload.ts` defaults
   to `"internal-tool-snapshots"`, `snapshot-source.ts` hard-fails when
   unset. Not blocking after Phase 1 (we set the env var) but worth
   normalizing.
3. Long-term, source `AVAILABLE_MONTHS` from a single file shared by
   `backfill-all.sh`, so the JS array and the bash array can't drift.
