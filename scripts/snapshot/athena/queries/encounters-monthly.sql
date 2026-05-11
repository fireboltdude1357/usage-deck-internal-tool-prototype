-- @database: sql_outputs
--
-- Per-provider per-month encounter counts and average encounter duration.
-- See claims-monthly.sql for the partition-pruning rationale and the reason
-- the query returns raw monthly rows (pre/post is derived live).

SELECT
  provider_id,
  batch_ds,
  month_encs_count_3_sum AS encounters,
  month_avg_enc_duration_3_avg AS enc_duration
FROM monthly_encounters_features
WHERE client = '{{client}}'
