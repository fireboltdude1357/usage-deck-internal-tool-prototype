-- Per-provider metadata for the success-stories pipeline.
-- Source: RDS (public.model_data_app_v2) — latest model snapshot.
-- One row per provider in the model for `{{client}}`.
-- Columns: provider_id, provider_name, specialty, category, department, quit_prob, run_date, model_ds
--
-- Vendored from
--   parent-db-investigations/.../outcomes/success-stories/12-three-plus-improvements/
--   queries/02-provider-metadata.sql
-- Generalized:
--   - dropped the hardcoded 121-UUID IN-list. The PostHog "viewed providers"
--     cohort is intersected with this metadata roster **live** by
--     src/routes/success-stories/+page.ts at request time, so the cohort can
--     drift with new events without re-snapshotting. The Athena pre/post
--     tables also pull all-client and join by provider_id, matching iter-12
--     of the success-stories investigation.
--   - parameterized `run_date` as `{{month}}` (YYYY-MM) so each snapshot
--     reflects that month's model run.
SELECT
  provider_id,
  provider_name,
  specialty,
  category,
  department,
  quit_prob,
  run_date::text AS run_date,
  model_ds::text AS model_ds
FROM public.model_data_app_v2
WHERE client_username = {{client}}
  AND run_date = ({{month}} || '-01')::date
ORDER BY provider_name
