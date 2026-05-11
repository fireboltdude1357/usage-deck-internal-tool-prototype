# CLAUDE.md

Project-level instructions for Claude Code working in this repo. The user
(Tanner) is the sole maintainer. The README is the dev-onboarding entry
point; the source of truth for *how the system is built* is `docs/`.

## Living docs — keep them current

`docs/architecture.md`, `docs/data-flow.md`, and `docs/operations.md` describe
the **current** system. The phase-based design docs that drove the prototype
are frozen under `archive/design/` — read for history, never edit.

**When you change code in any of the areas below, update the matching doc in
the same change.** The diff is small per change; staleness compounds.

| If you touch… | Update… |
|---|---|
| `src/lib/server/auth.ts`, `src/lib/server/workos.ts`, `src/hooks.server.ts`, anything under `src/routes/api/auth/` | `docs/architecture.md` § Auth, and `docs/operations.md` § Environment variables → WorkOS if env contract changes. |
| `src/lib/server/snapshot-source.ts` or `src/routes/api/snapshot/.../+server.ts` | `docs/architecture.md` § Snapshot source, and `docs/data-flow.md` § Fallback to fixtures (the error-kind → HTTP status mapping is mirrored in both files). |
| `src/lib/schema/snapshot.ts` | `docs/architecture.md` § Schema. If you add/rename a snapshot file, also update `docs/operations.md` § Routing. **Every producer must move with the schema** — see "Schema discipline" below. |
| `src/lib/server/posthog/*` | `docs/architecture.md` § PostHog client (the per-file table) and the cache strategy paragraph. If you change the request/response shape for `/api/posthog/*`, also update `docs/data-flow.md` § Request path and § Refresh button. |
| `scripts/snapshot/*` | `docs/architecture.md` § Snapshot pipeline, `docs/data-flow.md` § Monthly snapshot pipeline, `docs/operations.md` § Monthly snapshot run + Scripts table. |
| `src/routes/+page.server.ts`, `src/routes/{platform,market,provisioned}-*/+page.ts`, `src/lib/selection.svelte.ts`, `src/lib/refresh.svelte.ts` | `docs/architecture.md` § Frontend, `docs/data-flow.md` § Request path. |
| `package.json` scripts | `docs/operations.md` § Scripts and `README.md`. |
| `.env.example` | `docs/operations.md` § Environment variables and `README.md`. |
| `src/lib/ui/*` | UI primitives are not documented per-component; only update `docs/architecture.md` § Frontend if the *set* of primitives changes. |

If a change spans an area not listed, use judgment and add a row here for
next time.

## Schema discipline

`src/lib/schema/snapshot.ts` is the contract between every producer
(`scripts/snapshot/shape/roster.ts`, `src/lib/server/posthog/aggregator.ts`,
`src/lib/mock/build.ts`) and every consumer (the three page loaders,
`src/routes/api/snapshot/.../+server.ts`).

Adding or changing a field requires updates in *all* of:

- The schema definition itself.
- `scripts/snapshot/shape/roster.ts` (RDS path).
- `src/lib/server/posthog/aggregator.ts` (PostHog path).
- `src/lib/mock/bsmh-2026-04.ts` + `src/lib/mock/build.ts` (fixture path).
- The page component(s) that render the field.
- `docs/architecture.md` § Schema.

Run `npm run gen:fixtures && npm test && npm run check` after schema work.

## Hard rules carried forward

These come from the original DESIGN.md and remain non-negotiable:

- **PHI block-list** — never query `patient_id`, `encounter_id`, `claim_id`,
  `procedure_id`, `message_id`, `thread_id`, `source_msg_id`,
  `hospital_account_id`, `primary_encounter_id`. Enforce at query-build time.
- **No `SELECT *`** on PHI-containing tables.
- **PostHog URL eras** — every URL regex must match `/regions/`, `/units/`,
  `/physicians/units/`, and `/nurses/units/`. Missing any era silently drops
  pre-Oct 2025 data.
- **RDS > Athena source priority** when a metric exists in both.
- **Athena partition pruning** — every `dbt_dev_gold.gold_model_output`
  query must filter on `partition_date`.
- **Athena `output_type` casing is lowercase**.
- **No credentials in the browser bundle.** Never expose anything via
  `VITE_*` except non-secret URLs.

## Style

- Effect v3 lives at integration boundaries (S3 reads, PostHog client,
  schema validation). Don't push it into `+page.svelte`, `+page.server.ts`,
  or browser code.
- No backwards-compatibility shims. The repo has one prod deploy and one
  maintainer; just change the code.
- Keep comments to the load-bearing *why*, not the *what*.
- Prefer one well-tested seam over a layered abstraction. Three of the four
  seams in `docs/architecture.md` are a single file each.

## Tests

`npm test` is fast (Vitest, in-process). When you change a seam, run the
matching test file before declaring done. When you change the schema, run
`npm run gen:fixtures` first — `src/lib/mock/build.ts` schema-validates at
write time, so a typo there breaks the build before reaching the dashboard.

## Things to leave alone unless asked

- `archive/design/**` — frozen.
- The `Cache-Control: public, max-age=31536000, immutable` on uploaded
  snapshots — the month is in the URL, so cache invalidation isn't a thing
  unless you re-upload the same month, which is rare and intentional.
- `POSTHOG_PROJECT_ID = "71649"` — there's exactly one PostHog project; not
  configurable for a reason.
