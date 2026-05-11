# docs/

Living architecture docs for the internal-tool dashboard. These describe the
**current** system, not the journey that built it. Update them whenever the
matching code changes — see `CLAUDE.md` at the repo root for the per-area rules.

| File | Covers |
|---|---|
| [`architecture.md`](architecture.md) | Big picture + every server-side seam (auth, snapshot source, PostHog client, schema). |
| [`data-flow.md`](data-flow.md) | What happens on a page load, plus the monthly snapshot pipeline. |
| [`operations.md`](operations.md) | Dev workflow, env vars, deploys, monthly snapshot run. |

Metric definitions still live in `archive/design/{market,platform}-engagement-metrics.md`
and `archive/design/provisioned-users.md`. Don't edit those — if a definition
changes, lift it into `docs/architecture.md` or a new `docs/metrics.md` instead.
