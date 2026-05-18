-- @database: dbt_dev_gold
--
-- Per-employee per-partition quit_prob history for {{client}}. Used by the
-- producer to (a) project forward-month quits and (b) compute the
-- "top 20th percentile flagged" cohorts per partition per scope.
--
-- Output columns:
--   partition_date — model run date (YYYY-MM-DD); one row per calendar month
--   employee_id    — Atalan-canonical employee id (joins to silver_employment
--                    and silver_employee_timelines)
--   provider_id    — UUID v4 from gold_model_output (pass-through; not used
--                    for joining since employee_id is canonical here)
--   quit_prob      — model_output cast to double
--   group_id       — silver_employment.group_id at the same partition; the
--                    producer maps this to a Market via bu-mapping
--   job_role_name  — silver_employment.job_role_name; producer derives
--                    role_category (apc/physician/other) identically to
--                    employment-monthly
--
-- CLAUDE.md hard rule: every gold_model_output query must filter on
-- partition_date. The 2021-01-01 lower bound scoops every available run;
-- clients with shorter coverage simply return fewer rows.

SELECT
  CAST(g.partition_date AS VARCHAR) AS partition_date,
  g.employee_id,
  g.provider_id,
  CAST(g.model_output AS DOUBLE) AS quit_prob,
  e.group_id,
  e.job_role_name
FROM dbt_dev_gold.gold_model_output g
LEFT JOIN dbt_dev_silver.silver_employment e
  ON e.client = '{{client}}'
 AND e.partition_date = g.partition_date
 AND e.employee_id = g.employee_id
 AND e.exclude = false
WHERE g.client_username = '{{client}}'
  AND g.output_type = 'quit_probability'
  AND g.partition_date >= DATE '2021-01-01'
ORDER BY g.partition_date, g.employee_id
