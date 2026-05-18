// Ad-hoc probe to answer open questions for the turnover dashboard build:
//
// 1. Does `silver_employment.dob` have non-null values per client?
// 2. What does `silver_groups.level_{1,2,3}_name` look like per client (i.e.
//    do Duke/UCSF have any market-like grouping)?
// 3. Does `gold_model_output` (output_type='quit_probability') have forward
//    `feature_ds` values, or only historical? If only historical, the QBR
//    forecast must be derived (sum quit_prob projected forward).
// 4. What's the range of `partition_date` per client in gold_model_output and
//    silver_employment (to bound the analysis window)?
//
// Run: npx tsx scripts/snapshot/probe-turnover.ts

import * as path from "node:path"
import { loadEnv } from "./load-env.ts"
import { runAthenaQueryFile } from "./athena/run-query.ts"
import * as fs from "node:fs"
import * as os from "node:os"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
loadEnv(path.join(ROOT, ".env"))

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "probe-turnover-"))

const runInline = async (label: string, sql: string): Promise<string> => {
  const sqlPath = path.join(TMP, `${label}.sql`)
  const csvPath = path.join(TMP, `${label}.csv`)
  fs.writeFileSync(sqlPath, sql)
  const { rows } = await runAthenaQueryFile(sqlPath, {}, csvPath)
  console.log(`\n=== ${label} (${rows} rows) ===`)
  const csv = fs.readFileSync(csvPath, "utf8")
  console.log(csv.slice(0, 4000))
  return csv
}

// 1. DOB coverage per client (latest silver_employment partition).
await runInline(
  "01-dob-coverage",
  `
  WITH latest AS (
    SELECT client, MAX(partition_date) AS pd
    FROM dbt_dev_silver.silver_employment
    GROUP BY client
  )
  SELECT
    e.client,
    COUNT(*) AS rows_total,
    COUNT(e.dob) AS rows_with_dob,
    SUM(CASE WHEN e.dob IS NOT NULL
              AND date_diff('year', e.dob, current_date) >= 65 THEN 1 ELSE 0 END) AS age_65_plus
  FROM dbt_dev_silver.silver_employment e
  JOIN latest l ON l.client = e.client AND l.pd = e.partition_date
  WHERE e.exclude = false
  GROUP BY e.client
  ORDER BY e.client
`,
)

// 2. silver_groups level shapes per client. Distinct (level_1_type, level_2_type, level_3_type)
//    combinations and a few example name values per level.
await runInline(
  "02-groups-shape",
  `
  WITH latest AS (
    SELECT client, MAX(partition_date) AS pd
    FROM dbt_dev_silver.silver_groups
    GROUP BY client
  )
  SELECT
    g.client,
    g.level_1_type, g.level_2_type, g.level_3_type,
    COUNT(*) AS rows
  FROM dbt_dev_silver.silver_groups g
  JOIN latest l ON l.client = g.client AND l.pd = g.partition_date
  GROUP BY g.client, g.level_1_type, g.level_2_type, g.level_3_type
  ORDER BY g.client, rows DESC
`,
)

// 3. Examples of level_2_name (often the BU/region) per client.
await runInline(
  "03-level-2-examples",
  `
  WITH latest AS (
    SELECT client, MAX(partition_date) AS pd
    FROM dbt_dev_silver.silver_groups
    GROUP BY client
  )
  SELECT g.client, g.level_2_type, g.level_2_name, COUNT(DISTINCT g.group_id) AS groups
  FROM dbt_dev_silver.silver_groups g
  JOIN latest l ON l.client = g.client AND l.pd = g.partition_date
  GROUP BY g.client, g.level_2_type, g.level_2_name
  ORDER BY g.client, groups DESC
  LIMIT 100
`,
)

// 4. gold_model_output feature_ds range per client. Check whether feature_ds
//    extends past today (forward predictions).
await runInline(
  "04-gold-model-output-range",
  `
  SELECT
    client_username,
    MIN(feature_ds) AS feature_ds_min,
    MAX(feature_ds) AS feature_ds_max,
    MAX(partition_date) AS partition_date_max,
    COUNT(DISTINCT feature_ds) AS distinct_feature_ds,
    COUNT(DISTINCT partition_date) AS distinct_partition_dates
  FROM dbt_dev_gold.gold_model_output
  WHERE output_type = 'quit_probability'
    AND partition_date >= DATE '2024-01-01'
  GROUP BY client_username
  ORDER BY client_username
`,
)

// 5. For BSMH specifically, list the most recent 6 (partition_date, feature_ds)
//    pairs and the count of providers per pair — establishes whether each
//    monthly run produces one feature_ds or multiple, and whether feature_ds
//    leads or lags partition_date.
await runInline(
  "05-bsmh-recent-runs",
  `
  SELECT partition_date, feature_ds, COUNT(DISTINCT provider_id) AS providers
  FROM dbt_dev_gold.gold_model_output
  WHERE client_username = 'bsmh'
    AND output_type = 'quit_probability'
    AND partition_date >= DATE '2025-09-01'
  GROUP BY partition_date, feature_ds
  ORDER BY partition_date DESC, feature_ds DESC
  LIMIT 30
`,
)

// 6. Employment partition coverage per client.
await runInline(
  "06-employment-partitions",
  `
  SELECT client,
         MIN(partition_date) AS partition_date_min,
         MAX(partition_date) AS partition_date_max,
         COUNT(DISTINCT partition_date) AS n_partitions
  FROM dbt_dev_silver.silver_employment
  GROUP BY client
  ORDER BY client
`,
)

console.log(`\nProbe outputs in: ${TMP}`)
