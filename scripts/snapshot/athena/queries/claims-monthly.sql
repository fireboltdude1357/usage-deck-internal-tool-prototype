-- @database: sql_outputs
--
-- Per-provider per-month procedure counts and work RVUs.
-- One row per (provider_id, batch_ds). The dashboard splits these into pre/post
-- halves live based on the user-selected date range, so this query does no
-- aggregation across months — it just hands the raw monthly values back.
--
-- Partition columns are (client, run_date, batch_ds). Filtering on `client`
-- alone leaves the scan at "every month this client has". That's the point:
-- we snapshot once per client and let the page derive pre/post on demand.

SELECT
  provider_id,
  batch_ds,
  month_procedure_count_3_sum AS procedures,
  month_work_rvu_3_sum AS work_rvu
FROM monthly_claims_features
WHERE client = '{{client}}'
