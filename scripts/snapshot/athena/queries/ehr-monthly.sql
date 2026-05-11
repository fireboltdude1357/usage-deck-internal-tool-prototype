-- @database: sql_outputs
--
-- Per-provider per-month EHR doc-time and admin-time.
-- See claims-monthly.sql for the partition-pruning rationale and the reason
-- the query returns raw monthly rows (pre/post is derived live).

SELECT
  provider_id,
  batch_ds,
  month_epic_doc_time_3_sum AS doc_time,
  month_epic_administrative_time_3_sum AS admin_time
FROM ehr_usage_features
WHERE client = '{{client}}'
