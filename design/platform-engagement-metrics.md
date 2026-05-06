# Platform Engagement Metrics

Client-wide platform engagement analysis for BSMH, measuring how leaders use the retention workflow tool.

**Source investigation**: `investigations/bsmh-usage-deck/engagement/platform-engagement-metrics/` (12 iterations, BSMH), plus single-iteration ports for SSM, Duke, and UCSF.

**Final output**: A single "Leaders' Retention Workflow" HTML card showing provider-level metrics, unit-level metrics, and platform engagement stats.

**Build script**: `scripts/generate-html.py` reads 5 raw CSV files, computes all metrics in Python, and writes `outputs/engagement-metrics.html`.

---

## Metrics Produced

| Metric | Definition | Source |
|--------|-----------|--------|
| **Unique providers viewed** | Distinct legacy_ids from 3-segment provider URLs | PostHog |
| **Provider views per month** | Total provider page loads / active months | PostHog |
| **% of monitored clinicians** | Unique providers / total clinicians in latest model run | PostHog + RDS |
| **Unique units viewed** | Distinct group UUIDs from 2-segment unit URLs (hardcoded: 90) | PostHog |
| **Unit views per month** | Total unit views / 7 calendar months | PostHog |
| **Total unit views** | Sum of all unit-level page loads | PostHog |
| **Unique platform users** | Distinct user emails with any Page Load event | PostHog |
| **Recurring leaders (3+ months)** | Users active in >= 3 of 5 months (Oct 2025 - Feb 2026) | PostHog |
| **Retention rate** | Recurring leaders / total users in the 5-month window | PostHog |

---

## Queries (Current — Iteration 12)

The current iteration uses 5 queries producing raw event-level CSVs. All aggregation happens in the Python build script.

### 1. Provider View Events

**Source**: PostHog  
**Purpose**: Every provider-level page load by BSMH users. One row per event. Feeds unique providers, provider views/month, and % of clinicians viewed.

```sql
SELECT
  formatDateTime(timestamp, '%Y-%m-%d %H:%M:%S') AS event_time,
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  extract(properties.url, '([a-f0-9-]{36})$') AS provider_legacy_id,
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

**Contributes to**: Unique providers viewed, provider views/month, % of monitored clinicians.

**URL pattern**: 3-segment paths like `/units/{bu_uuid}/{group_uuid}/{provider_legacy_id}`. Covers both `/regions/` (era 1, pre-Sep 2025) and `/units/` (era 2, post-Sep 2025) URL formats.

---

### 2. Unit View Events

**Source**: PostHog  
**Purpose**: Every unit-level page load by BSMH users. One row per event. Feeds total unit views, unit views/month, and unique units.

```sql
SELECT
  formatDateTime(timestamp, '%Y-%m-%d %H:%M:%S') AS event_time,
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  replaceRegexpOne(properties.url,
    '^.*/([a-f0-9-]{36})$', '\\1') AS group_uuid,
  properties.url AS url
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND match(properties.url,
    '^/(regions|units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}$')
  AND NOT properties.url LIKE '%/units/overview%'
  AND timestamp >= '2025-08-01'
  AND timestamp < '2026-03-01'
ORDER BY timestamp
```

**Contributes to**: Total unit views, unit views/month, unique units viewed.

**URL pattern**: 2-segment paths like `/units/{bu_uuid}/{group_uuid}` (no provider drill-down). Excludes `/units/overview` landing page.

---

### 3. Risk Factor View Events

**Source**: PostHog  
**Purpose**: Risk factor page loads, classified as "overview" or "drilldown". Not shown on the final card but tracked for completeness.

```sql
SELECT
  formatDateTime(timestamp, '%Y-%m-%d %H:%M:%S') AS event_time,
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  properties.url AS url,
  multiIf(
    properties.url = '/risk-factors', 'overview',
    match(properties.url, '^/risk-factors/[0-9]+/(interventions|benchmarks)'), 'drilldown',
    'other'
  ) AS view_type
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND (
    properties.url = '/risk-factors'
    OR match(properties.url, '^/risk-factors/')
  )
  AND timestamp >= '2025-08-01'
  AND timestamp < '2026-03-01'
ORDER BY timestamp
```

**Contributes to**: Risk factor view total (overview + drilldown). Printed in script summary but not displayed on the card.

---

### 4. All Page Load Events (Monthly User Activity)

**Source**: PostHog  
**Purpose**: Monthly active user counts. Aggregated by month + user to stay within PostHog row limits. Feeds unique platform users, recurring leaders, and retention rate.

```sql
SELECT
  formatDateTime(timestamp, '%Y-%m') AS month,
  distinct_id AS user_email,
  count() AS event_count
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND NOT match(properties.url, '^/(ingest|_admin)')
  AND timestamp >= '2025-08-01'
  AND timestamp < '2026-03-01'
GROUP BY month, user_email
ORDER BY month, user_email
```

**Contributes to**: Unique platform users, monthly active users, recurring leaders (3+ months), retention rate.

**Note**: "Active" here means any Page Load on the platform (not just provider/unit views). This is the broadest activity definition.

---

### 5. Clinician Roster

**Source**: RDS (public schema)  
**Purpose**: All monitored BSMH clinicians from the latest model run before Feb 28, 2026. Provides the denominator for "% of clinicians viewed".

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
      AND run_date <= '2026-02-28'
  )
ORDER BY pi.businessunitname, pi.provider_name
```

**Contributes to**: Clinicians monitored count, % of clinicians viewed.

---

## Build Script

The Python script reads 5 CSVs from `results/` and computes all metrics:

### Input Files

| CSV File | Source Query | Description |
|----------|-------------|-------------|
| `provider-view-events.csv` | Query 1 | One row per provider page load |
| `unit-view-monthly-counts.csv` | Derived from Query 2 | Monthly unit view counts |
| `risk-factor-view-events.csv` | Query 3 | One row per risk factor page load |
| `monthly-user-activity.csv` | Query 4 | Month + user + event count |
| `clinician-roster.csv` | Query 5 | One row per monitored clinician |

### Metric Computation Logic

```python
# Unique providers viewed
unique_providers = len(set(r["provider_legacy_id"] for r in provider_events))

# Monthly provider views -> average
pv_by_month = defaultdict(int)
for r in provider_events:
    pv_by_month[r["month"]] += 1
avg_pv = round(total_pv / len(pv_months_sorted))

# Unit views
unit_views_total = sum(int(r["count"]) for r in unit_view_counts)
unique_units = 90  # Verified PostHog distinct count (hardcoded)
avg_uv = round(unit_views_total / 7)  # 7 calendar months

# Unique platform users
unique_user_count = len(set(r["user_email"] for r in monthly_user_activity))

# Recurring leaders (Oct 2025 - Feb 2026, 5 months)
recurring_window = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]
# Count users with >= 3 active months in window
leaders_3plus = sum(1 for months in user_months_in_window.values()
                    if len(months) >= 3)

# Retention rate
retention_pct = round(leaders_3plus / total_users_in_window * 100)

# % clinicians viewed
pct_viewed = round(unique_providers / len(clinician_roster) * 100, 1)
```

### Output HTML Structure

The generated HTML is a single card with:
- **Page title**: "Leaders' Retention Workflow"
- **Left column** (Individual Clinician Level): unique providers viewed (with % of clinicians context), provider views/month
- **Right column** (Unit Level): unique units viewed, unit views/month, total unit views
- **Bottom section** (Platform Engagement): unique platform users, recurring leaders (3+ months), retention rate
- **Footnotes**: Period, URL coverage, aggregation method

---

## Multi-Client Ports

The same card was ported to three other clients, each with a single iteration:

### SSM — `ssm-usage-deck/engagement/platform-engagement-metrics/01-retention-workflow-visuals/`

Same card structure. Differences:
- User filter: `@ssmhealth.com` or `@health.slu.edu`
- Client: `ssm`
- URL eras: `/regions/` ends 2025-09-15, `/units/` starts 2025-09-22

### Duke — `duke-usage-deck/engagement/platform-engagement-metrics/01-retention-workflow-visuals/`

Same card structure. Differences:
- Cohort of one user (`bryan.sexton@duke.edu`)
- Client: `duke`
- No era 1 (no `/regions/` URLs)
- No Feb 2026 RDS run

### UCSF — `ucsf-usage-deck/engagement/platform-engagement-metrics/01-retention-workflow-visuals/`

Same card structure. Differences:
- Cohort of 2 users (`@ucsf.edu`)
- Client: `ucsf`
- Jan 2026 only
- No `/regions/` or era 1
- Latest RDS run: 2025-06-01 (8 months stale)

---

## Iteration History

| # | Name | Key Change |
|---|------|-----------|
| 01 | baseline | Individual SQL queries for 4 metrics (provider views, risk factors, unit views, recurring usage) across all clients |
| 02 | bsmh-only | Scoped to BSMH users via email domain filter (`@mercy.com`, `@bshsi.org`) |
| 03 | add-regions | Added `/regions/` URL views, exec dashboard, glossary, providers list |
| 04 | monthly-provider-views | Added monthly provider view trend |
| 05 | unique-providers-fix | **Critical fix**: switched from `count()` (341 page loads) to `count(DISTINCT legacy_id)` (113 actual unique providers). Added Athena risk tier cross-reference |
| 06 | monthly-page-loads | Monthly trend bar chart for provider page loads |
| 07 | reproducible | Self-contained reproducible iteration: 14 SQL queries, 13 CSVs, full Python `generate-html.py` script |
| 08 | fix-url-coverage | **Critical fix**: added `/regions/` URL era. Unique providers 113 -> 143, unit views 275 -> 1,303 |
| 09 | aug2025-present | Timeframe narrowed to Aug 2025+ (post-Lima-pilot) |
| 10 | raw-events | Switched to raw event-level CSVs with all aggregation in Python |
| 11 | aug-feb-timeframe | Capped at Feb 2026 (`timestamp < '2026-03-01'`). Recurring window: Oct 2025 - Feb 2026 |
| 12 | retention-workflow-visuals | **Current** -- Complete HTML redesign to clean "Leaders' Retention Workflow" card. Same data as iter 11 |

### Key Corrections Over Time

- **Unique providers** (iter 05): `count()` counts page loads, not providers. Must use `count(DISTINCT legacy_id)` extracted from URL. This single fix dropped the number from 341 to 113.
- **URL era coverage** (iter 08): PostHog URLs changed from `/regions/{bu_uuid}/{group_uuid}/...` to `/units/{bu_uuid}/{group_uuid}/...` around Sep 19, 2025. All queries must match both patterns. Missing `/regions/` undercounted providers by 30 and unit views by 1,028.
- **Raw events** (iter 10): Moved aggregation from SQL to Python for auditability and to avoid PostHog row limits.
- **Timeframe capping** (iter 11): Upper bound `timestamp < '2026-03-01'` ensures consistent metrics tied to Feb 2026 model run.

---

## Earlier Queries (Iterations 01-09)

These document the evolution of SQL queries before the raw-event approach.

### Iteration 01-02: Basic Aggregated Queries

**Provider Views (all clients -> BSMH-only)**:
```sql
SELECT
  count() as total_provider_page_views,
  count(distinct properties.email) as unique_viewers
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'      -- added in iter 02
  AND (distinct_id LIKE '%@mercy.com'             -- added in iter 02
    OR distinct_id LIKE '%@bshsi.org')
  AND (
    properties.url = '/provider'
    OR match(properties.url,
      '^/(units|physicians/units|nurses/units)/[a-f0-9-]+/[a-f0-9-]+/[a-f0-9-]+')
  )
```

**Risk Factor Views**:
```sql
SELECT
  count() as total_risk_factor_views,
  count(distinct properties.email) as unique_viewers
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND properties.url = '/risk-factors'
```

**Unit Views**:
```sql
SELECT
  count() as total_unit_page_views,
  count(distinct replaceRegexpOne(properties.url,
    '^.*/([a-f0-9-]{36})$', '\\1')) as unique_units_viewed,
  count(distinct properties.email) as unique_viewers
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND match(properties.url,
    '^/(units|physicians/units|nurses/units)/[a-f0-9-]{36}/[a-f0-9-]{36}$')
```

**Recurring Usage** (leaders returning 3+ months):
```sql
SELECT
  distinct_id AS email,
  count(DISTINCT formatDateTime(timestamp, '%Y-%m')) AS months_active,
  count() AS total_events,
  min(timestamp) AS first_active,
  max(timestamp) AS last_active
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND NOT match(properties.url, '^/(ingest|_admin)')
  AND formatDateTime(timestamp, '%Y-%m') >= '2025-10'
  AND formatDateTime(timestamp, '%Y-%m') <= '2026-02'
GROUP BY distinct_id
HAVING months_active >= 3
ORDER BY months_active DESC, total_events DESC
```

### Iteration 05: Unique Providers Fix

**Extract viewed legacy IDs**:
```sql
SELECT
  DISTINCT extract(properties.url, '([a-f0-9-]{36})$') AS legacy_id
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` = 'bsmh'
  AND (distinct_id LIKE '%@mercy.com' OR distinct_id LIKE '%@bshsi.org')
  AND match(properties.url,
    '^/(units|physicians/units|nurses/units)/[a-f0-9-]+/[a-f0-9-]+/[a-f0-9-]+')
```

**Risk tier of viewed providers** (Athena cross-reference):
```sql
SELECT
  CASE
    WHEN quit_prob >= 0.50 THEN 'Critical (>=50%)'
    WHEN quit_prob >= 0.25 THEN 'High (25-49%)'
    WHEN quit_prob >= 0.10 THEN 'Moderate (10-24%)'
    ELSE 'Low (<10%)'
  END AS risk_tier,
  count(*) AS provider_count,
  round(avg(quit_prob) * 100, 1) AS avg_quit_pct
FROM dbt_dev_gold.gold_model_output
WHERE client_username = 'bsmh'
  AND run_date = DATE '2026-02-01'
  AND provider_id IN ('uuid1', 'uuid2', ...)  -- populated from PostHog query above
GROUP BY risk_tier
ORDER BY avg_quit_pct DESC
```

### Iteration 07: Reproducible (14 queries)

This was the first fully self-contained iteration. Query files:

| Query | Source | Purpose |
|-------|--------|---------|
| `clinicians-monitored.sql` | RDS | Total clinician count |
| `monthly-active-users.sql` | PostHog | Monthly distinct user count |
| `monthly-provider-views.sql` | PostHog | Monthly provider page loads |
| `monthly-unit-views.sql` | PostHog | Monthly unit view counts |
| `recurring-leaders.sql` | PostHog | Users with 3+ active months |
| `recurring-users-total.sql` | PostHog | Total users in recurring window |
| `risk-factor-views.sql` | PostHog | Overview + drilldown RF views |
| `risk-tier-all.sql` | Athena | Risk tier distribution (all) |
| `risk-tier-viewed.sql` | Athena | Risk tier distribution (viewed) |
| `unique-platform-users.sql` | PostHog | Total distinct platform users |
| `unique-providers-viewed.sql` | PostHog | Distinct provider legacy_ids |
| `unique-units-viewed.sql` | PostHog | Distinct unit group UUIDs |
| `unit-views.sql` | PostHog | Total + monthly unit views |
| `viewed-provider-ids.sql` | PostHog | Legacy IDs for Athena xref |
