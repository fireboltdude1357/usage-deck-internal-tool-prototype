-- @database: dbt_dev_silver
--
-- Per-quitter termination records for {{client}}, enriched with the
-- employee's group_id / job_role / market labels from their last known
-- silver_employment record. Drives both the §1/§2/§3 monthly-quits buckets
-- and the §4 retrospective-flagging analysis.
--
-- Output columns:
--   employee_id    — Atalan-canonical employee id
--   quit_date      — eff_quit_date (the termination date)
--   dob            — date of birth (informational; the age <65 filter is
--                    applied here already)
--   group_id       — silver_employment.group_id at the latest partition the
--                    employee appeared in (typically the partition just
--                    before quit_date, but may be later if the record
--                    lingered with exclude=true)
--   job_role_name  — same partition's job_role_name; producer derives
--                    role_category identically to employment-monthly
--   level_2_name   — BU code (bsmh) — for bu-mapping
--   level_3_name   — region label (ssm) — for bu-mapping
--
-- IMPORTANT: do NOT filter `exclude = false` on silver_employee_timelines.
-- The modeling pipeline marks quitters as exclude=true with reason
-- "Terminated" — they're held out of training. Filtering removes ~94% of
-- real terminations.

WITH quitters AS (
  SELECT
    employee_id,
    MAX(eff_quit_date) AS quit_date,
    MAX(dob) AS dob
  FROM silver_employee_timelines
  WHERE client = '{{client}}'
    AND eff_quit_date IS NOT NULL
    AND dob IS NOT NULL
    AND date_diff('year', dob, eff_quit_date) < 65
  GROUP BY employee_id
),
quitter_employment AS (
  SELECT
    q.employee_id,
    q.quit_date,
    q.dob,
    e.group_id,
    e.job_role_name,
    e.partition_date,
    ROW_NUMBER() OVER (
      PARTITION BY q.employee_id
      ORDER BY e.partition_date DESC
    ) AS rn
  FROM quitters q
  JOIN silver_employment e
    ON e.client = '{{client}}'
   AND e.employee_id = q.employee_id
)
SELECT
  qe.employee_id,
  CAST(qe.quit_date AS VARCHAR) AS quit_date,
  CAST(qe.dob AS VARCHAR) AS dob,
  qe.group_id,
  qe.job_role_name,
  g.level_2_name,
  g.level_3_name
FROM quitter_employment qe
LEFT JOIN silver_groups g
  ON g.client = '{{client}}'
 AND g.group_id = qe.group_id
 AND g.partition_date = qe.partition_date
WHERE qe.rn = 1
ORDER BY qe.quit_date
