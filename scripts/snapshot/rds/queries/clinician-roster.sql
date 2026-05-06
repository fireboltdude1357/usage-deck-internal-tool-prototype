-- Clinician roster from the most-recent model run for a client.
-- Source: RDS (public.provider_quit_risk_v2 + public.provider_info_v2)
-- One row per monitored clinician with risk score and org info.
-- Columns: provider_id, quit_prob, run_date, businessunitname, department,
--          specialty, provider_name
--
-- Vendored from
--   parent-db-investigations/.../bsmh-usage-deck/engagement/
--   platform-engagement-metrics/12-retention-workflow-visuals/queries/clinician-roster.sql
-- Generalized:
--   - dropped the `run_date <= '2026-02-28'` cutoff (most-recent run, no time fence)
--   - parameterized `client_username` as `{{client}}`
SELECT
  qr.provider_id,
  qr.quit_prob,
  qr.run_date::text AS run_date,
  pi.businessunitname,
  pi.department,
  pi.specialty,
  pi.provider_name
FROM public.provider_quit_risk_v2 qr
JOIN public.provider_info_v2 pi
  ON qr.provider_id = pi.provider_id
 AND qr.client_username = pi.client_username
WHERE qr.client_username = {{client}}
  AND qr.run_date = (
    SELECT MAX(run_date)
    FROM public.provider_quit_risk_v2
    WHERE client_username = {{client}}
  )
ORDER BY pi.businessunitname, pi.provider_name
