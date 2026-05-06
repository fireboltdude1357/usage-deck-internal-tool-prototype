# Market Engagement Metrics

Per-market engagement analysis for BSMH's 6 Atalan markets: Hampton Roads, Kentucky, Lima, Lorain, Toledo, Youngstown.

**Source investigation**: `investigations/bsmh-usage-deck/engagement/market-engagement-metrics/` (10 iterations)

**Final output**: 6 HTML cards (one per market) in the "Leaders' Retention Workflow" card style, showing provider views, unit views, unique users, recurring leaders, and retention rate.

**Build script**: `scripts/generate-html.py` reads 3 raw CSV files, computes all metrics in Python, and writes one HTML file per market to `outputs/`.

---

## Metrics Produced

| Metric | Definition | Source |
|--------|-----------|--------|
| **Unique providers viewed** | Distinct provider legacy_ids extracted from 3-segment provider URLs | PostHog |
| **Provider views per month** | Total provider page loads / 7 calendar months (Aug 2025 - Feb 2026) | PostHog |
| **Unique units viewed** | Distinct group UUIDs from 2-segment unit URLs | PostHog |
| **Unit views per month** | Total unit page loads / 7 calendar months | PostHog |
| **Total unit views** | Sum of all unit-level page loads | PostHog |
| **Unique market users** | Union of users who viewed any provider or unit page in that market | PostHog |
| **Recurring leaders (3+ months)** | Users active in >= 3 of 5 months (Oct 2025 - Feb 2026), where "active" = viewed a unit or provider in that market | PostHog |
| **Retention rate** | Recurring leaders / total users in recurring window | PostHog |
| **% of monitored clinicians** | Unique providers viewed / clinicians in that market's roster | PostHog + RDS |

---

## Queries

### 1. Unit View Events

**Source**: PostHog  
**Purpose**: Raw unit-level page loads for BSMH users. One row per event. These feed the unit views, unique units, and monthly activity metrics.  
**Market attribution**: The `bu_uuid` extracted from the first UUID segment of the URL is mapped to a market in Python.

```sql
SELECT
  formatDateTime(timestamp, '%Y-%m-%d %H:%M:%S') AS event_time,
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  replaceRegexpOne(properties.url,
    '^/(?:regions|units|physicians/units|nurses/units)/([a-f0-9-]{36})/[a-f0-9-]{36}$',
    '\\1') AS bu_uuid,
  replaceRegexpOne(properties.url,
    '^/(?:regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/([a-f0-9-]{36})$',
    '\\1') AS group_uuid,
  properties.url AS url
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND match(properties.url,
    '^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}$')
  AND timestamp >= '2025-08-01'
  AND timestamp < '2026-03-01'
ORDER BY timestamp
```

**Contributes to**: Unit views total, unit views/month, unique units, unique market users, recurring leaders, retention rate.

**Batching note**: PostHog HogQL defaults to 100 rows. This query must be run batched by month:
```sql
AND formatDateTime(timestamp, '%Y-%m') = '2025-08'  -- repeat for each month
```
September 2025 may need sub-month splits if > 100 rows.

---

### 2. Provider View Events

**Source**: PostHog  
**Purpose**: Raw provider-level page loads. One row per event. These feed the provider views, unique providers, and monthly activity metrics.  
**Market attribution**: Same `bu_uuid` extraction as unit views.

```sql
SELECT
  formatDateTime(timestamp, '%Y-%m-%d %H:%M:%S') AS event_time,
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  replaceRegexpOne(properties.url,
    '^/(?:regions|units|physicians/units|nurses/units)/([a-f0-9-]{36})/.*$',
    '\\1') AS bu_uuid,
  replaceRegexpOne(properties.url,
    '^/(?:regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/([a-f0-9-]{36})/[a-f0-9-]{36}$',
    '\\1') AS group_uuid,
  replaceRegexpOne(properties.url,
    '([a-f0-9-]{36})$', '\\1') AS provider_legacy_id,
  properties.url AS url
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND match(properties.url,
    '^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}/[a-f0-9-]{36}$')
  AND timestamp >= '2025-08-01'
  AND timestamp < '2026-03-01'
ORDER BY timestamp
```

**Contributes to**: Unique providers viewed, provider views/month, % of monitored clinicians, unique market users, recurring leaders, retention rate.

**Known issue**: The `replaceRegexpOne` for `provider_legacy_id` returns the full URL instead of just the trailing UUID. The build script works around this by extracting the provider ID via Python regex on the `url` column: `re.search(r'([a-f0-9-]{36})$', url)`.

---

### 3. Clinician Roster

**Source**: RDS (public schema)  
**Purpose**: All monitored BSMH clinicians from the latest model run. Provides the denominator for "% of monitored clinicians viewed" and per-market clinician counts.  
**Market attribution**: `businessunitname` (BU code) is mapped to a market in Python.

```sql
SELECT
  qr.provider_id,
  qr.quit_prob,
  qr.run_date,
  pi.businessunitname,
  pi.department,
  pi.specialty,
  pi.provider_name
FROM public.provider_quit_risk_v2 qr
JOIN public.provider_info_v2 pi
  ON qr.provider_id = pi.provider_id
  AND qr.client_username = pi.client_username
WHERE qr.client_username = 'bsmh'
  AND qr.run_date = (
    SELECT MAX(run_date)
    FROM public.provider_quit_risk_v2
    WHERE client_username = 'bsmh'
  )
  AND pi.businessunitname IN (
    '6176','6177','6190',       -- Youngstown
    '6730','6734','6735',       -- Toledo
    '6010','6051','6052','6090','6076',  -- Lorain
    '6610','9230','9254','9803',         -- Kentucky
    '1430','1431','1412',       -- Hampton Roads
    '6077','6410','6413'        -- Lima
  )
ORDER BY pi.businessunitname, pi.provider_name
```

**Contributes to**: Clinicians monitored count (per market), % of monitored clinicians viewed.

---

## Build Script

The Python build script (`scripts/generate-html.py`) reads three CSV files and computes all metrics:

### BU UUID to Market Mapping (PostHog URLs)

```python
BU_MARKET = {
    "5504e035-7756-540b-93a7-9b0591b04a54": "Hampton Roads",
    "6e085dfc-d112-5705-bb6e-75f32e6ca545": "Hampton Roads",
    "224caf39-2a30-5204-80c7-7e5327286c7c": "Hampton Roads",
    "b227f07a-fb70-5287-bcc3-36f508a7d982": "Kentucky",
    "96a073fd-26b1-55d1-b954-80290553d5f6": "Kentucky",
    "6974b71d-4e93-59e3-8e17-688aaee08671": "Kentucky",
    "b8586708-4179-5f5d-b0fb-c0391f9adc77": "Lima",
    "0d0182e2-2a15-5aca-b9b4-d07ba1718403": "Lima",
    "5194a183-35cd-54c1-8423-ac12e0897b83": "Lima",
    "e4a8128d-0120-507b-9a4e-df96c4b1ee4d": "Lorain",
    "93f18369-6264-5684-bfd0-03b4f64c07c9": "Lorain",
    "b24a47bf-4f9c-5d14-a12b-131fe7265cfa": "Lorain",
    "4cbdfbe4-c17c-5a17-9dd5-a622ecb97f5f": "Toledo",
    "cf67e06a-1a79-5db7-bc0f-6de4c2f289e1": "Toledo",
    "3d9d5ea8-74d9-5c5e-985e-674c7b946959": "Youngstown",
    "1f0a6910-9caa-5314-9ada-c87bbb0c27ea": "Youngstown",
}
```

### BU Code to Market Mapping (RDS roster)

```python
BU_CODE_MARKET = {
    "1412": "Hampton Roads", "1430": "Hampton Roads", "1431": "Hampton Roads",
    "6010": "Lorain", "6051": "Lorain", "6052": "Lorain",
    "6076": "Lorain", "6090": "Lorain",
    "6077": "Lima", "6410": "Lima", "6413": "Lima",
    "6176": "Youngstown", "6177": "Youngstown", "6190": "Youngstown",
    "6610": "Kentucky", "9230": "Kentucky", "9254": "Kentucky", "9803": "Kentucky",
    "6730": "Toledo", "6734": "Toledo", "6735": "Toledo",
}
```

### Metric Computation Logic

1. **Unit views**: Iterate `unit-view-events.csv`, map each row's `bu_uuid` to a market. Accumulate total count, unique `group_uuid` set, unique `user_email` set per market.
2. **Provider views**: Iterate `provider-view-events.csv`, map `bu_uuid` to market. Extract provider legacy ID from URL via regex `([a-f0-9-]{36})$`. Accumulate total count, unique provider set, unique user set per market.
3. **Per-month averages**: Divide totals by 7 (full calendar span Aug 2025 - Feb 2026), never by active months only.
4. **Recurring leaders**: For Oct 2025 - Feb 2026 (5-month window), track which months each user was active in each market (viewed a unit or provider). Users with >= 3 months = recurring leaders.
5. **Retention rate**: `recurring_leaders / total_users_in_window * 100`.
6. **Clinician count**: Count roster rows per market via BU code mapping.
7. **% viewed**: `unique_providers / clinicians * 100`.

### Output

One HTML card per market in `outputs/`, using the "Leaders' Retention Workflow" card style:
- Two-column layout: Individual Clinician Level (left) and Unit Level (right)
- Platform Engagement section with unique users, recurring leaders, retention rate
- Teal accent bars, 56px bold metric values

---

## Iteration History

| # | Name | Key Change |
|---|------|-----------|
| 01 | baseline | Initial per-market metrics using aggregated SQL GROUP BY queries |
| 02 | add-unit-views-per-month | Added monthly unit view breakdown |
| 03 | standardize-timeframe | Standardized timeframe across all queries |
| 04 | alltime-raw-events | Switched to raw-event approach for some queries |
| 05 | fix-url-coverage | Added `/regions/` URL era coverage |
| 06 | aug2025-present | Narrowed to Aug 2025 onwards (post-Lima-pilot) |
| 07 | raw-events | Full switch to raw event CSVs; all aggregation in Python |
| 08 | aug2025-feb2026 | Capped at Feb 2026 (`timestamp < '2026-03-01'`) |
| 09 | fix-monthly-averages | Averages use 7-month calendar span, not active months |
| 10 | retention-workflow-visuals | **Current** -- per-market Leaders' Retention Workflow cards with recurring leaders and retention rate |

### Key Corrections Over Time

- **URL era coverage** (iter 05): Added `/regions/` paths (Oct 2024 - Sep 2025) alongside `/units/` paths (Oct 2025+). The URL format changed ~Sep 19, 2025.
- **Raw events** (iter 07): Moved from SQL `GROUP BY` aggregations to raw event-level CSVs with Python aggregation. More auditable and avoids PostHog row-limit issues.
- **Calendar-span averages** (iter 09): Per-month averages must divide by the full 7-month calendar span, not just months with activity. A market with 4 active months out of 7 should divide by 7.
- **Retention metrics** (iter 10): Added recurring leaders (3+ months active) and retention rate. "Active in a market" = viewed a unit or provider page in that market's BUs, not just platform login.

---

## Earlier Aggregated Queries (Iterations 01-06)

These queries were superseded by the raw-event approach in iteration 07+, but document the metrics that were originally computed directly in SQL.

### BU UUID to Market Mapping (RDS)

**Source**: RDS  
**Purpose**: Maps `businessunit_uuid` values (used in PostHog URLs) to market names.

```sql
SELECT businessunit_uuid, businessunit_name,
  CASE
    WHEN businessunit_name IN ('6176','6177','6190') THEN 'Youngstown'
    WHEN businessunit_name IN ('6730','6734','6735') THEN 'Toledo'
    WHEN businessunit_name IN ('6010','6051','6052','6090','6076') THEN 'Lorain'
    WHEN businessunit_name IN ('6610','9230','9254','9803') THEN 'Kentucky'
    WHEN businessunit_name IN ('1430','1431','1412') THEN 'Hampton Roads'
    WHEN businessunit_name IN ('6077','6410','6413') THEN 'Lima'
  END AS market
FROM public.businessunits
WHERE client_username = 'bsmh'
  AND businessunit_name IN (
    '6176','6177','6190','6730','6734','6735','6010','6051','6052','6090','6076',
    '6610','9230','9254','9803','1430','1431','1412','6077','6410','6413'
  )
ORDER BY market, businessunit_name
```

**Contributes to**: Establishing the BU UUID-to-market mapping used by all subsequent PostHog queries.

### Provider Views by Market (Aggregated)

**Source**: PostHog  
**Purpose**: Total and unique provider views per market using the BU UUID mapping.

```sql
SELECT
  multiIf(
    properties.url LIKE '%5504e035%' OR properties.url LIKE '%6e085dfc%'
      OR properties.url LIKE '%224caf39%', 'Hampton Roads',
    properties.url LIKE '%b227f07a%' OR properties.url LIKE '%96a073fd%'
      OR properties.url LIKE '%6974b71d%', 'Kentucky',
    properties.url LIKE '%b8586708%' OR properties.url LIKE '%0d0182e2%'
      OR properties.url LIKE '%5194a183%', 'Lima',
    properties.url LIKE '%e4a8128d%' OR properties.url LIKE '%93f18369%'
      OR properties.url LIKE '%b24a47bf%', 'Lorain',
    properties.url LIKE '%4cbdfbe4%' OR properties.url LIKE '%cf67e06a%', 'Toledo',
    properties.url LIKE '%3d9d5ea8%' OR properties.url LIKE '%1f0a6910%', 'Youngstown',
    'Unknown'
  ) AS market,
  count() AS total_provider_views,
  count(DISTINCT extract(properties.url, '([a-f0-9-]{36})$')) AS unique_providers
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND match(properties.url,
    '^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]+/[a-f0-9-]+/[a-f0-9-]+')
  AND timestamp >= '2025-08-01'
GROUP BY market
ORDER BY total_provider_views DESC
```

### Monthly Provider Views by Market

**Source**: PostHog  
**Purpose**: Monthly breakdown of provider page loads per market.

```sql
SELECT
  formatDateTime(timestamp, '%Y-%m') AS month,
  multiIf(
    -- same market CASE as above
  ) AS market,
  count() AS provider_views,
  count(DISTINCT extract(properties.url, '([a-f0-9-]{36})$')) AS unique_providers
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND match(properties.url,
    '^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]+/[a-f0-9-]+/[a-f0-9-]+')
  AND timestamp >= '2025-08-01'
GROUP BY month, market
ORDER BY month, market
```

### Unit Views by Market

**Source**: PostHog  
**Purpose**: Total and unique unit views per market.

```sql
SELECT
  multiIf(
    -- same market CASE as provider views
  ) AS market,
  count() AS total_unit_views,
  count(DISTINCT replaceRegexpOne(properties.url, '^.*/([a-f0-9-]{36})$', '\\1'))
    AS unique_units
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND match(properties.url,
    '^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}$')
  AND timestamp >= '2025-08-01'
GROUP BY market
ORDER BY total_unit_views DESC
```

### Users by Market

**Source**: PostHog  
**Purpose**: Distinct users who viewed any unit or provider page per market.

```sql
SELECT
  multiIf(
    -- same market CASE
  ) AS market,
  count(DISTINCT distinct_id) AS unique_users
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND match(properties.url,
    '^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}')
  AND timestamp >= '2025-08-01'
GROUP BY market
ORDER BY unique_users DESC
```

### Clinicians by Market

**Source**: RDS  
**Purpose**: Count of monitored clinicians per market (denominator for % viewed).

```sql
SELECT
  CASE
    WHEN pi.businessunitname IN ('6176','6177','6190') THEN 'Youngstown'
    WHEN pi.businessunitname IN ('6730','6734','6735') THEN 'Toledo'
    WHEN pi.businessunitname IN ('6010','6051','6052','6090','6076') THEN 'Lorain'
    WHEN pi.businessunitname IN ('6610','9230','9254','9803') THEN 'Kentucky'
    WHEN pi.businessunitname IN ('1430','1431','1412') THEN 'Hampton Roads'
    WHEN pi.businessunitname IN ('6077','6410','6413') THEN 'Lima'
  END AS market,
  count(*) AS clinicians
FROM public.provider_quit_risk_v2 qr
JOIN public.provider_info_v2 pi
  ON qr.provider_id = pi.provider_id
  AND qr.client_username = pi.client_username
WHERE qr.client_username = 'bsmh'
  AND qr.run_date = (
    SELECT MAX(run_date) FROM public.provider_quit_risk_v2 WHERE client_username = 'bsmh'
  )
  AND pi.businessunitname IN (
    '6176','6177','6190','6730','6734','6735','6010','6051','6052','6090','6076',
    '6610','9230','9254','9803','1430','1431','1412','6077','6410','6413'
  )
GROUP BY market
ORDER BY clinicians DESC
```

### Risk Tier by Market

**Source**: RDS  
**Purpose**: Risk tier distribution per market for contextualizing engagement.

```sql
SELECT
  CASE
    WHEN pi.businessunitname IN ('6176','6177','6190') THEN 'Youngstown'
    -- ... same CASE
  END AS market,
  CASE
    WHEN qr.quit_prob >= 0.50 THEN 'Critical'
    WHEN qr.quit_prob >= 0.25 THEN 'High'
    WHEN qr.quit_prob >= 0.10 THEN 'Moderate'
    ELSE 'Low'
  END AS risk_tier,
  count(*) AS providers,
  round(avg(qr.quit_prob) * 100, 1) AS avg_quit_pct
FROM public.provider_quit_risk_v2 qr
JOIN public.provider_info_v2 pi
  ON qr.provider_id = pi.provider_id
  AND qr.client_username = pi.client_username
WHERE qr.client_username = 'bsmh'
  AND qr.run_date = (
    SELECT MAX(run_date) FROM public.provider_quit_risk_v2 WHERE client_username = 'bsmh'
  )
  AND pi.businessunitname IN (
    '6176','6177','6190','6730','6734','6735','6010','6051','6052','6090','6076',
    '6610','9230','9254','9803','1430','1431','1412','6077','6410','6413'
  )
GROUP BY market, risk_tier
ORDER BY market, avg_quit_pct DESC
```
