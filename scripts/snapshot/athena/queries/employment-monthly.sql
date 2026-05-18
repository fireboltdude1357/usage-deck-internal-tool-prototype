-- @database: dbt_dev_silver
--
-- Per-(month, group, role_category) headcount for {{client}}.
-- Source: silver_employment (active providers per partition_date) joined to
-- silver_groups (org hierarchy → market via group_id).
--
-- Output columns:
--   partition_date — month-anchored partition (YYYY-MM-DD)
--   group_id       — silver_groups.group_id; producer maps this to a Market
--                    label via bu-mapping
--   level_2_name   — BU code (bsmh: "6177" etc.) — bsmh's market key
--   level_3_name   — region label (ssm) — ssm's market key
--   role_category  — "apc" | "physician" | "other" (residents/fellows/etc.)
--   headcount      — distinct employees active in (partition, group, category)
--
-- Exclusions: silver_employment.exclude=false (drops nurses, short tenure,
-- non-clinical, etc.) plus age at partition_date < 65 (QBR scope).
-- Residents/fellows fall into role_category="other" and are dropped from
-- turnover-rate denominators by the producer.
--
-- NOTE: quits are NOT derived here. silver_employment's exclude flag updates
-- lazily, so consecutive-partition set differences understate quits by ~10x.
-- The producer reads quits from employee-timelines.sql (eff_quit_date) and
-- buckets them by quit month.

WITH filtered AS (
  SELECT
    e.partition_date,
    e.employee_id,
    e.group_id,
    CASE
      WHEN regexp_like(LOWER(COALESCE(e.job_role_name, '')), 'resident|fellow')
        THEN 'other'
      WHEN regexp_like(LOWER(COALESCE(e.job_role_name, '')),
             'nurse practitioner|physician assistant|aprn|crna|anesthetist|midwife|\bnp\b|\bpa\b|\bapp\b')
        THEN 'apc'
      ELSE 'physician'
    END AS role_category
  FROM silver_employment e
  WHERE e.client = '{{client}}'
    AND e.exclude = false
    AND e.dob IS NOT NULL
    AND date_diff('year', e.dob, e.partition_date) < 65
)
SELECT
  CAST(f.partition_date AS VARCHAR) AS partition_date,
  f.group_id,
  g.level_2_name,
  g.level_3_name,
  f.role_category,
  COUNT(DISTINCT f.employee_id) AS headcount
FROM filtered f
LEFT JOIN silver_groups g
  ON g.client = '{{client}}'
 AND g.partition_date = f.partition_date
 AND g.group_id = f.group_id
GROUP BY
  CAST(f.partition_date AS VARCHAR),
  f.group_id,
  g.level_2_name,
  g.level_3_name,
  f.role_category
ORDER BY partition_date, group_id, role_category
