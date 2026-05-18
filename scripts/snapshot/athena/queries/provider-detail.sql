-- @database: dbt_dev_silver
--
-- Per-provider metadata for the turnover dashboard's §4 provider-detail
-- table. Sourced entirely from silver tables so employee_id stays in the
-- canonical Atalan UUID space (matches silver_employment.employee_id,
-- silver_employee_timelines.employee_id, gold_model_output.employee_id).
--
-- Why not public_provider_info_v2? It maintains its own (employee_id,
-- provider_id) pair sourced from RDS, and neither column matches the silver
-- UUID space. silver_employees_map bridges *another* id pair (client_emp_id
-- → employee_id) and the latter UUID space ALSO doesn't overlap with silver
-- — empirically verified with scripts/snapshot/probe-empmap.ts.
--
-- Output columns:
--   employee_id      — Atalan-canonical employee id (joins to silver_employment /
--                      silver_employee_timelines / gold_model_output).
--   provider_id      — same as employee_id; kept as a separate column so the
--                      snapshot schema has a stable "outward-facing id" field
--                      independent of the join key.
--   provider_name    — "{first_name} {last_name}" from silver_employees.
--   specialty        — silver_employees.specialty (raw category code, e.g.
--                      "cardio"; the producer applies display formatting).
--   job_role_name    — most recent silver_employment.job_role_name for the
--                      employee; used by the producer's role_category
--                      derivation.
--   level_2_name     — silver_groups.level_2_name at the employee's most
--                      recent group_id (bsmh: BU code). Producer maps to a
--                      Market via bu-mapping.
--   level_3_name     — silver_groups.level_3_name at the same group_id (ssm:
--                      region label). Producer maps to a Market via bu-mapping.

WITH provider_universe AS (
  SELECT DISTINCT employee_id
  FROM silver_employment
  WHERE client = '{{client}}' AND exclude = false
  UNION
  SELECT DISTINCT employee_id
  FROM silver_employee_timelines
  WHERE client = '{{client}}' AND eff_quit_date IS NOT NULL
),
ranked_employees AS (
  SELECT
    employee_id,
    first_name,
    last_name,
    specialty,
    group_id,
    ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY partition_date DESC) AS rn
  FROM silver_employees
  WHERE client = '{{client}}'
    AND employee_id IN (SELECT employee_id FROM provider_universe)
),
ranked_employment AS (
  SELECT
    employee_id,
    job_role_name,
    group_id,
    partition_date,
    ROW_NUMBER() OVER (PARTITION BY employee_id ORDER BY partition_date DESC) AS rn
  FROM silver_employment
  WHERE client = '{{client}}'
),
latest_groups_partition AS (
  SELECT MAX(partition_date) AS pd
  FROM silver_groups
  WHERE client = '{{client}}'
)
SELECT
  e.employee_id,
  e.employee_id AS provider_id,
  TRIM(COALESCE(e.first_name, '') || ' ' || COALESCE(e.last_name, '')) AS provider_name,
  COALESCE(e.specialty, '') AS specialty,
  COALESCE(emp.job_role_name, '') AS job_role_name,
  COALESCE(g.level_2_name, '') AS level_2_name,
  COALESCE(g.level_3_name, '') AS level_3_name
FROM ranked_employees e
LEFT JOIN ranked_employment emp
  ON emp.employee_id = e.employee_id
 AND emp.rn = 1
LEFT JOIN silver_groups g
  ON g.client = '{{client}}'
 AND g.group_id = COALESCE(emp.group_id, e.group_id)
 AND g.partition_date = (SELECT pd FROM latest_groups_partition)
WHERE e.rn = 1
ORDER BY provider_name
