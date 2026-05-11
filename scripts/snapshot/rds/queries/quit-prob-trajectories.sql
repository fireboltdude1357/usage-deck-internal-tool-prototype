-- Monthly quit_prob trajectories per provider for `{{client}}`.
-- Source: RDS (public.provider_quit_risk_v2).
-- One row per (provider_id, run_date); `run_date` always lands on the 1st of
-- the month. Returns every month the client has data for — the dashboard
-- splits these into pre/post halves live based on the user-selected range.
--
-- Vendored from
--   parent-db-investigations/.../outcomes/success-stories/12-three-plus-improvements/
--   queries/03-quit-prob-trajectories.sql
-- Generalized: dropped the hardcoded 121-UUID IN-list (the shaper joins to
-- the metadata roster) and dropped the iter-12 date bracket (Aug 2025 –
-- Mar 2026) so the snapshot carries the full trajectory.
SELECT
  provider_id,
  run_date::text AS run_date,
  quit_prob
FROM public.provider_quit_risk_v2
WHERE client_username = {{client}}
ORDER BY provider_id, run_date
