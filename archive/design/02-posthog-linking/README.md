# 02 — PostHog linking

**Status: shipped 2026-05-06.** Live PostHog data backs `/platform-engagement`
for BSMH; `/api/posthog/[client]/[metric]` returns Schema-validated JSON;
fixture fallback active when `POSTHOG_API_KEY` is unset. See `PLAN.md`
§ "What shipped" for deltas vs. plan.

Wire the live PostHog API proxy and codify the canonical engagement queries.

## Scope

- `/api/posthog/*` `+server.ts` route holding the API key (Vercel env var, never in browser bundle).
- HogQL query helpers matching the metric definitions in `../platform-engagement-metrics.md`.
- URL-era handling: any query spanning pre-Oct 2025 must match `/regions/`, `/units/`, `/physicians/units/`, and `/nurses/units/` (missing eras silently drops data).
- Client → PostHog project mapping (BSMH/SSM/Duke/UCSF) per `../data-sources.md`.
- Effect v3 wraps the outbound `fetch` with retry/timeout; response validated with `effect/Schema`.

## References

- `../DESIGN.md` § 4 (PostHog — live, never snapshotted)
- `../DESIGN.md` § Hard rules → PostHog URL eras
- `../platform-engagement-metrics.md`
- `../data-sources.md` → PostHog connection details

## Dependencies

- Phase 01 (server route lives in the SvelteKit app).

## Open questions

- PostHog rate-limit behavior under our query volume — verify before building any aggregation that fans out per-client.
