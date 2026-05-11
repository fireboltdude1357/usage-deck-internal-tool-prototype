# 01 — SvelteKit frontend

**Status: shipped.** Dashboard shell, fixture-backed routes, selectors moved
to `localStorage`. See `PLAN.md` for the full plan.

Scaffold the SvelteKit app on Vercel and build the dashboard UI shell.

## Scope

- `npm create svelte@latest` project, deployed to Vercel by `git push`.
- `+page.svelte`: client (BSMH/SSM/Duke/UCSF) and timeframe (calendar month) pickers.
- `+page.server.ts`: session-gated render — placeholder gate until phase 05 wires WorkOS.
- Dashboard components rendering metrics from `/api/snapshot/*` and `/api/posthog/*`.
- Effect v3 + `effect/Schema` set up in `+server.ts` route bodies (the read boundary for snapshot JSON).
- Vercel env vars stubbed: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `POSTHOG_API_KEY`.

## References

- `../DESIGN.md` § 1 (Frontend + serverless backend)
- `../DESIGN.md` § 6 (Server-side runtime — Effect v3 scope rules)
- `../DESIGN.md` § Data flow examples → "User loads BSMH, April 2026, Engagement"

## Dependencies

- None upstream. Use fixture JSON locally until phases 02/03 produce real data.

## Out of scope

- WorkOS (phase 05).
- Live PostHog data (phase 02).
- Real S3 reads (phases 03, 04).
