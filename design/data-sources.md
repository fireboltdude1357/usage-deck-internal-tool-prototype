# Data Sources & Query Guide

How we query the three data systems that feed the engagement metrics: **PostHog** (product analytics), **RDS** (app database), and **Athena** (data warehouse). This documents the connection details, query syntax, gotchas, and cross-system patterns used across the market engagement, platform engagement, and provisioned users investigations.

---

## System Overview

| System | Purpose | SQL Dialect | How to Query |
|--------|---------|-------------|------------|
| **PostHog** | Product analytics — page views, email tracking, user behavior | HogQL (ClickHouse-based) | HTTP API (`POST /api/projects/{id}/query/`) |
| **RDS Staging** | App-facing Postgres database — risk scores, provider info, org structure | PostgreSQL | `psql` or any Postgres client via SSH bastion tunnel |
| **Athena** | Data warehouse — full data lineage, model outputs, SHAP values, ID mapping | Presto SQL | AWS CLI (`aws athena start-query-execution`) or console |

### When to Use Each

| Data | Use |
|------|-----|
| Page views, user activity, email engagement | **PostHog** |
| Provider risk scores, clinician roster, business units | **RDS** (preferred) or Athena |
| SHAP values, silver/bronze/platinum layers, ID mapping | **Athena** only |
| Cross-system joins (e.g., "which viewed providers are high-risk?") | PostHog + RDS, or PostHog + Athena |

**Default source priority**: RDS > Athena. Only use Athena when the data doesn't exist in RDS (model outputs, SHAP, silver employment, org hierarchy).

---

## PostHog (HogQL)

### Connection

- **Project ID**: 71649
- **Endpoint**: `https://us.posthog.com/api/projects/71649/query/`
- **Auth**: API key via `Authorization: Bearer <POSTHOG_API_KEY>` header

**Example API call**:
```bash
curl -X POST 'https://us.posthog.com/api/projects/71649/query/' \
  -H 'Authorization: Bearer <POSTHOG_API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{"query": {"kind": "HogQLQuery", "query": "SELECT count() FROM events WHERE event = '\''Page Load'\'' LIMIT 10"}}'
```

The response JSON contains a `results` array of row arrays and a `columns` array of column names.

### Query Syntax

HogQL is PostHog's SQL dialect, based on ClickHouse SQL.

```sql
-- Basic structure
SELECT columns
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND timestamp >= '2025-08-01'
ORDER BY timestamp
LIMIT 100
```

**Key syntax differences from standard SQL**:
- Access event properties with `properties.<key>` (backtick-quote keys with hyphens: `` properties.`client-username` ``)
- Access person properties with `person.properties.<key>`
- `distinct_id` is the user identifier (typically email address)
- Use `count()` not `count(*)` for total counts
- String functions: `match()` for regex, `extract()` for capture groups, `replaceRegexpOne()` for substitution
- Date formatting: `formatDateTime(timestamp, '%Y-%m')` for month grouping
- Conditional logic: `multiIf(cond1, val1, cond2, val2, default)` (like CASE WHEN)
- Use single quotes for string literals

### Pagination (Critical)

**PostHog HogQL returns at most 100 rows by default.** Every query that might exceed 100 rows must be paginated.

Two pagination strategies:

**1. Batch by month** (used in these investigations):
```sql
-- Run once per month, concatenate results
AND formatDateTime(timestamp, '%Y-%m') = '2025-08'
```

**2. Explicit LIMIT/OFFSET**:
```sql
SELECT ... LIMIT 5000 OFFSET 0
SELECT ... LIMIT 5000 OFFSET 5000
-- Loop until result set is empty
```

**If a single month exceeds 100 rows** (e.g., September 2025 with 117 unit view events), split into sub-month batches:
```sql
AND timestamp >= '2025-09-01' AND timestamp < '2025-09-15'
AND timestamp >= '2025-09-15' AND timestamp < '2025-10-01'
```

### Timeout Limits

- HogQL has a **10-second execution limit** (hard, non-negotiable)
- Queries with many `OR`/`LIKE` clauses will time out
- If searching for 10+ IDs simultaneously, query each one individually in a loop
- `count()` + `GROUP BY` queries are fast — use them to scope data before pulling raw rows

### Client Filtering

Organization names are inconsistent in PostHog. The reliable filter is `properties.\`client-username\``:

```sql
-- Preferred: filter by client-username
AND properties.`client-username` = 'bsmh'

-- Additional user filter by email domain
AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')

-- Exclude internal accounts
AND distinct_id NOT LIKE '%atalantech.com'
AND distinct_id NOT LIKE '%fortyau.com'
```

**Client email domains**:
| Client | Email Domains |
|--------|--------------|
| BSMH | `@mercy.com`, `@bshsi.org` |
| SSM | `@ssmhealth.com`, `@health.slu.edu` |
| Duke | `@duke.edu` |
| UCSF | `@ucsf.edu` |

### URL Pattern Eras (Critical)

The app's URL structure has changed over time. **Any query spanning multiple time periods must match all URL formats** or it will silently miss data.

| Period | Path Prefix | ID Format | Example |
|--------|------------|-----------|---------|
| Jul - Sep 2024 | `/regions/` | Numeric codes | `/regions/6077/Lima` |
| Oct 2024 - Sep 2025 | `/regions/` | UUIDs | `/regions/{bu_uuid}/{group_uuid}` |
| Oct 2025+ | `/units/` | UUIDs | `/units/{bu_uuid}/{group_uuid}` |

**Also seen**: `/physicians/units/` and `/nurses/units/` (same structure as `/units/`).

**Catch-all regex for unit pages**:
```sql
match(properties.url,
  '^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}$')
```

**Catch-all regex for provider pages** (3-segment, includes provider legacy_id):
```sql
match(properties.url,
  '^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}$')
```

**URL structure**:
```
/{prefix}/{bu_uuid}/{group_uuid}                 -- unit page (2 UUIDs)
/{prefix}/{bu_uuid}/{group_uuid}/{legacy_id}     -- provider page (3 UUIDs)
```

**Era 1 properties**: Before Oct 2024, `properties.region` and `properties.unit` may contain BU codes (e.g., `6077`). After that, these properties are often `None` — identify markets from BU UUIDs in the URL instead.

### Event Types Used

| Event | URL Property | Purpose |
|-------|-------------|---------|
| `Page Load` | `properties.url` | All page view tracking |
| `Email Link Clicked` | `properties.redirect_url` (NOT `properties.url`) | Email click tracking |
| `email_send` | n/a | Email delivery tracking |
| `$autocapture` | `elements_chain` (extract with regex) | Click tracking |

### Extracting IDs from URLs

```sql
-- Extract provider legacy_id (last UUID in URL)
extract(properties.url, '([a-f0-9-]{36})$') AS provider_legacy_id

-- Extract group UUID (last UUID in 2-segment URL)
replaceRegexpOne(properties.url,
  '^.*/([a-f0-9-]{36})$', '\\1') AS group_uuid

-- Extract BU UUID (first UUID after prefix)
replaceRegexpOne(properties.url,
  '^/(?:regions|units|physicians/units|nurses/units)/([a-f0-9-]{36})/.*$',
  '\\1') AS bu_uuid
```

---

## RDS Staging (PostgreSQL)

### Connection

- **Instance**: Staging (development also available)
- **Database**: normform
- **Engine**: PostgreSQL
- **Connection**: Via SSH bastion tunnel to RDS endpoint
- **Auth**: Standard Postgres credentials (host, database, user, password, port)
- **SSL**: `verify-full`

**Connection steps**:
1. Open an SSH tunnel through the bastion host:
   ```bash
   ssh -N -L 5433:<RDS_HOST>:5432 ec2-user@<BASTION_HOST> -i <BASTION_KEY_PATH>
   ```
2. Connect via `psql` or any Postgres client on `localhost:5433`:
   ```bash
   psql -h localhost -p 5433 -U <USER> -d normform
   ```

**Environment variables** (for scripted access):
- `RDS_STAGING_HOST`, `RDS_STAGING_DATABASE`, `RDS_STAGING_USER`, `RDS_STAGING_PASSWORD`, `RDS_STAGING_PORT`
- `RDS_STAGING_BASTION_HOST`, `RDS_STAGING_BASTION_USER`, `RDS_STAGING_BASTION_KEY_PATH`

### Available Schemas

| Schema | Access | Contents |
|--------|--------|----------|
| `public` | Yes | App tables: risk scores, provider info, org structure |
| `modeling` | Needs GRANT | ML pipeline: feature values, model catalog |
| `external_data` | Needs GRANT | Reference data: compensation, RVU conversions |
| `provider_actions` | Needs GRANT | Claims-to-provider crosswalk |

### Key Tables Used in These Investigations

**`public.provider_quit_risk_v2`** — Provider risk scores
```sql
SELECT provider_id, quit_prob, run_date, client_username
FROM public.provider_quit_risk_v2
WHERE client_username = 'bsmh'
  AND run_date = (SELECT MAX(run_date) FROM public.provider_quit_risk_v2 WHERE client_username = 'bsmh')
```
- `provider_id` is UUID v4 in RDS (same as Athena public tables)
- Matches Athena `public_provider_quit_risk_v2` but no ID translation needed for RDS-only queries
- Filter by `run_date` for specific model snapshots

**`public.provider_info_v2`** — Provider demographics and org assignment
```sql
SELECT provider_id, provider_name, businessunitname, department, specialty, client_username
FROM public.provider_info_v2
WHERE client_username = 'bsmh'
```
- `businessunitname` contains BU codes (e.g., '6077', '1430') used to map providers to markets
- Join to `provider_quit_risk_v2` on `provider_id` + `client_username`

**`public.businessunits`** — Business unit structure
```sql
SELECT businessunit_uuid, businessunit_name, client_username
FROM public.businessunits
WHERE client_username = 'bsmh'
```
- `businessunit_uuid` = the UUID that appears in PostHog URLs
- `businessunit_name` = the BU code (e.g., '6077') that appears in provider_info_v2
- This table bridges PostHog URLs to the clinician roster

### Discovery Queries

Standard Postgres introspection:
```sql
-- List schemas
SELECT schema_name FROM information_schema.schemata ORDER BY schema_name;

-- List tables in a schema
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' ORDER BY table_name;

-- Describe a table's columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'provider_quit_risk_v2'
ORDER BY ordinal_position;
```

### PHI Safety

- Never use `SELECT *` on PHI-containing tables — always enumerate columns explicitly
- Blocked columns (must never be queried): `patient_id`, `encounter_id`, `claim_id`, `procedure_id`, `message_id`, `thread_id`, `source_msg_id`, `hospital_account_id`, `primary_encounter_id`

---

## Athena (Presto SQL)

### Connection

- **Region**: `us-east-1`
- **S3 Output**: `s3://tanner-dev-test-s3-bucket/athena-results/`
- **Auth**: AWS credentials (IAM user or role with Athena + S3 permissions)
- **Execution**: Async — submit a query, poll for completion, download results from S3

**Query via AWS CLI**:
```bash
# Submit query
EXECUTION_ID=$(aws athena start-query-execution \
  --query-string "SELECT count(*) FROM dbt_dev_gold.gold_model_output WHERE client_username = 'bsmh'" \
  --query-execution-context Database=dbt_dev_gold \
  --result-configuration OutputLocation=s3://tanner-dev-test-s3-bucket/athena-results/ \
  --region us-east-1 \
  --query 'QueryExecutionId' --output text)

# Poll until SUCCEEDED
aws athena get-query-execution --query-execution-id $EXECUTION_ID --region us-east-1

# Download results
aws s3 cp s3://tanner-dev-test-s3-bucket/athena-results/${EXECUTION_ID}.csv ./results.csv
```

Can also be queried via the **AWS Athena console** or any Athena-compatible client (e.g., DBeaver with the Athena JDBC driver).

### Databases

| Database | Contents | When to Use |
|----------|----------|-------------|
| `dbt_dev_gold` | Risk scores, ID helpers, risk/protective factors | ID mapping (`provider_id_helper`), gold-layer fields not in RDS |
| `dbt_dev_silver` | Standardized employee, clinical, scheduling, messaging | Clinical/scheduling/employment data not in RDS |
| `dbt_dev_bronze` | Per-client raw feeds | Raw source data inspection |
| `dbt_dev_platinum` | Intermediate aggregations, model-ready features | Feature engineering data |
| `dbt_model_outputs` | Raw predictions, calibrated scores, SHAP values | Model output details |
| `sql_outputs` | Derived feature tables for model training | Training pipeline data |

### Key Tables Used in These Investigations

**`dbt_dev_gold.gold_model_output`** — Risk scores and SHAP values
```sql
SELECT provider_id, CAST(model_output AS DOUBLE) as quit_prob
FROM dbt_dev_gold.gold_model_output
WHERE client_username = 'bsmh'
  AND output_type = 'quit_probability'
  AND partition_date = DATE '2026-02-01'
```
- `provider_id` is **UUID v5 (legacy_id)** — matches PostHog URLs directly, no mapping needed
- `model_output` is stored as string — always cast to DOUBLE
- `output_type`: `quit_probability` for risk scores, `shap_value` for feature importance

**`dbt_dev_gold.provider_id_helper`** — Cross-system ID bridge
```sql
SELECT legacy_id, id as provider_id
FROM dbt_dev_gold.provider_id_helper
WHERE client = 'bsmh'
  AND legacy_id = '<uuid_from_posthog_url>'
```
- `legacy_id` = UUID v5 (app/PostHog URLs)
- `id` = UUID v4 (Athena public tables, RDS, used as `employee_id` in silver tables)

### Athena Syntax Notes

- Use `DATE '2026-02-01'` for date literals (Presto syntax)
- Cast strings: `CAST(column AS DOUBLE)`, `CAST(column AS INTEGER)`
- Fully qualify table names: `dbt_dev_gold.gold_model_output`
- Partitioned tables: filter by `partition_date` to avoid full scans

### PHI Safety

Same rules as RDS — never use `SELECT *` on PHI-containing tables. Always enumerate columns explicitly. See blocked column list in the RDS section above.

---

## Cross-System ID Mapping

The most common source of errors across investigations. Three different UUID formats coexist:

| System | ID Column | UUID Format | Example Use |
|--------|-----------|-------------|------------|
| PostHog URLs | Last segment of URL | UUID v5 (legacy_id) | `/units/{bu}/{group}/{legacy_id}` |
| RDS `public` tables | `provider_id` | UUID v4 | `provider_quit_risk_v2.provider_id` |
| Athena `gold_model_output` | `provider_id` | UUID v5 (legacy_id) | Matches PostHog directly |
| Athena public tables | `provider_id` | UUID v4 | Same as RDS |
| Athena silver tables | `employee_id` | UUID v4 | Via `provider_id_helper.id` |

### Mapping Patterns

**PostHog -> RDS risk scores** (no mapping needed):
```
RDS provider_quit_risk_v2 uses provider_id (UUID v4)
RDS also has legacy_id in some tables
For the investigations in this project, we join via businessunitname (BU codes),
not provider_id, because the goal is market-level aggregation.
```

**PostHog -> Athena gold_model_output** (direct match):
```
Extract legacy_id from PostHog URL -> use directly as gold_model_output.provider_id
```

**PostHog -> Athena public tables** (mapping needed):
```
Extract legacy_id from PostHog URL
-> provider_id_helper WHERE legacy_id = <extracted_id>
-> use provider_id_helper.id as provider_id in public tables
```

**PostHog -> Athena silver tables** (mapping needed):
```
Extract legacy_id from PostHog URL
-> provider_id_helper WHERE legacy_id = <extracted_id>
-> use provider_id_helper.id as employee_id in silver_employment
```

### Common ID Trap

`gold_model_output.provider_id` and `public_provider_quit_risk_v2.provider_id` are **different UUID formats** despite having the same column name. The gold_model_output uses UUID v5 (legacy_id), while public tables use UUID v4.

---

## Query Best Practices

### 1. Pull Raw Rows, Aggregate in Python

Per project convention, queries should return raw event-level rows. All aggregation (counts, averages, groupings) happens in Python build scripts. This avoids re-querying when the analysis changes.

```sql
-- Preferred: raw rows
SELECT event_time, month, user_email, url FROM events WHERE ...

-- Avoid: aggregated SQL (unless row count would exceed ~100k)
SELECT month, count(*) FROM events WHERE ... GROUP BY month
```

### 2. Always Cover All URL Eras

Any PostHog query spanning pre/post September 2025 must match both `/regions/` and `/units/` URL prefixes:

```sql
-- Correct
match(properties.url, '^/(regions|units|physicians/units|nurses/units)/...')

-- Wrong (misses pre-Oct 2025 data)
match(properties.url, '^/(units|physicians/units|nurses/units)/...')
```

### 3. Use Calendar Span for Averages

Per-month averages must divide by the full calendar span (e.g., 7 months for Aug 2025 - Feb 2026), not just months with activity. A market with 4 active months out of 7 divides by 7.

### 4. Batch PostHog Queries

Always batch PostHog queries by month to avoid the 100-row default limit. Concatenate monthly CSV results, dedup headers.

### 5. Verify Schema Before Querying

Check column names and types before writing queries — they differ between systems. For RDS, use `information_schema.columns`. For Athena, use `SHOW COLUMNS IN table_name` or the AWS console. For PostHog, probe with `SELECT * FROM events WHERE ... LIMIT 5` to inspect available properties.

---

## Analytical Pitfalls

Known patterns that have caused incorrect results:

### P1: Snapshot vs. Longitudinal Data

Using `max(model_ds)` or `ORDER BY model_ds DESC LIMIT 1` discards historical trends. If you need trends over time, query ALL `model_ds` values.

### P2: PostHog Graph Inconsistencies

PostHog's web behavior graph node counts may not match raw HogQL event counts. Always cross-check graph-derived numbers against raw queries.

### P3: Athena When RDS Has the Data

RDS is the default. Athena adds latency, cost, and ID mapping complexity. Only use Athena for data that doesn't exist in RDS.

### P4: Aggregating in SQL Instead of Raw Rows

Aggregating in SQL locks the analysis into one view. Raw CSVs let you re-analyze in Python without re-querying. Exceptions: row count > 100k, PostHog pagination limits, cross-system joins that can only happen in SQL.
