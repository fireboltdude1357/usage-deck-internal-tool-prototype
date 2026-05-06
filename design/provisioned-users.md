# Provisioned Users

Measures how many BSMH provisioned users actually logged in and used the platform, with separate treatment for Lima (pilot market) vs. the other 5 markets.

**Source investigation**: `investigations/bsmh-usage-deck/engagement/bsmh-provisioned-users/` (3 iterations), with precursor queries in `bsmh-usage-summary/` iterations 09-10.

**Final output**: An HTML card showing a main "59% of provisioned users logged in" (22/37) metric with a side card for Lima (7/7 = 100%).

**Build approach**: No Python build script — the HTML was generated inline during the investigation. The card is static with hardcoded values.

---

## Metrics Produced

| Metric | Definition | Source |
|--------|-----------|--------|
| **Logged-in users (total BSMH)** | Distinct emails with a Page Load event, Aug 2025 - Feb 2026 | PostHog |
| **Provisioned users** | 37 — client-provided, not derived from data | External |
| **Usage rate** | Logged-in / provisioned = 22/37 = 59% | Derived |
| **Lima logged-in users** | Distinct emails who accessed Lima BU content, all time | PostHog |
| **Lima provisioned** | 7 — derived as users who ever accessed Lima content | PostHog |
| **Lima usage rate** | 7/7 = 100% | Derived |
| **Per-user engagement** | Page loads, active days, first/last seen per user | PostHog |

---

## Queries (Current — Iteration 03)

### 1. All BSMH Logged-In Users

**Source**: PostHog  
**Purpose**: Count of distinct BSMH users who logged in during Aug 2025 - Feb 2026. This is the numerator for the main usage rate (22/37).

```sql
SELECT COUNT(DISTINCT person.properties.email) AS logged_in_users
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` LIKE '%bsmh%'
  AND person.properties.email NOT LIKE '%atalantech.com'
  AND person.properties.email NOT LIKE '%fortyau.com'
  AND timestamp >= '2025-08-01'
  AND timestamp < '2026-03-01'
```

**Contributes to**: Main headline metric — 22 of 37 provisioned users = 59%.

**Filters**: Excludes Atalan (`atalantech.com`) and FortyAU (`fortyau.com`) internal accounts. No market filter — counts all BSMH activity.

---

### 2. All BSMH User Detail

**Source**: PostHog  
**Purpose**: Per-user engagement breakdown for the 22 logged-in users. Shows page loads, active days, and date range per user.

```sql
SELECT
  person.properties.email AS user_email,
  count(*) AS page_loads,
  count(DISTINCT toDate(timestamp)) AS active_days,
  min(timestamp) AS first_seen,
  max(timestamp) AS last_seen
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` LIKE '%bsmh%'
  AND person.properties.email NOT LIKE '%atalantech.com'
  AND person.properties.email NOT LIKE '%fortyau.com'
  AND timestamp >= '2025-08-01'
  AND timestamp < '2026-03-01'
GROUP BY person.properties.email
ORDER BY page_loads DESC
```

**Contributes to**: User detail table, engagement depth context. Top user (rlreed@mercy.com) had 1,975 page loads across 10 active days.

---

### 3. Lima Logged-In Users

**Source**: PostHog  
**Purpose**: Count of distinct users who ever accessed Lima market content (any URL era). This is the numerator and denominator for Lima's 7/7 = 100%.

```sql
SELECT COUNT(DISTINCT person.properties.email) AS logged_in_users
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` LIKE '%bsmh%'
  AND person.properties.email NOT LIKE '%atalantech.com'
  AND person.properties.email NOT LIKE '%fortyau.com'
  AND (
    properties.url LIKE '%b8586708%'
    OR properties.url LIKE '%0d0182e2%'
    OR properties.url LIKE '%5194a183%'
    OR properties.region LIKE '%6077%'
    OR properties.region LIKE '%6410%'
    OR properties.region LIKE '%6413%'
  )
```

**Contributes to**: Lima usage card — 7 of 7 provisioned = 100%.

**Lima identification**: Uses both URL-era methods:
- **Era 2 (Oct 2025+)**: BU UUIDs in URL — `b8586708`, `0d0182e2`, `5194a183`
- **Era 1 (pre-Oct 2025)**: BU codes in `properties.region` — `6077`, `6410`, `6413`

**No timeframe filter**: Lima is measured all-time (Jul 2024 - Feb 2026) since it was the pilot market.

---

### 4. Lima User Detail

**Source**: PostHog  
**Purpose**: Per-user engagement for Lima users. Uses a subquery to find users who accessed Lima content, then gets ALL their platform activity (not just Lima pages).

```sql
SELECT
  person.properties.email AS user_email,
  count(*) AS page_loads,
  count(DISTINCT toDate(timestamp)) AS active_days,
  min(timestamp) AS first_seen,
  max(timestamp) AS last_seen
FROM events
WHERE event = 'Page Load'
  AND properties.`client-username` LIKE '%bsmh%'
  AND person.properties.email NOT LIKE '%atalantech.com'
  AND person.properties.email NOT LIKE '%fortyau.com'
  AND person.properties.email IN (
    SELECT DISTINCT person.properties.email
    FROM events
    WHERE event = 'Page Load'
      AND properties.`client-username` LIKE '%bsmh%'
      AND person.properties.email NOT LIKE '%atalantech.com'
      AND person.properties.email NOT LIKE '%fortyau.com'
      AND (
        properties.url LIKE '%b8586708%'
        OR properties.url LIKE '%0d0182e2%'
        OR properties.url LIKE '%5194a183%'
        OR properties.region LIKE '%6077%'
        OR properties.region LIKE '%6410%'
        OR properties.region LIKE '%6413%'
      )
  )
GROUP BY person.properties.email
ORDER BY page_loads DESC
```

**Contributes to**: Lima user detail table. Shows total platform engagement for users who accessed Lima, not just their Lima-specific page loads.

**Two-step approach**: The inner subquery identifies Lima users; the outer query gets their full activity. This is intentional — the goal is to show total engagement level of Lima users, not just their Lima page views.

---

## HTML Output Structure

The output is a static HTML page with two side-by-side cards:

### Main Card (green accent)
- **Header**: "Usage Across Provisioned Users"
- **Subheader**: "All BSMH Markets - Aug 2025 - Feb 2026"
- **Hero metric**: 59% of provisioned users logged in (22 of 37)
- **Progress bar**: 22 active / 15 inactive
- **Stats row**: 22 logged in, 37 provisioned, 7 months

### Side Card (purple accent)
- **Header**: "Lima Market"
- **Subheader**: "All Time - Jul 2024 - Feb 2026"
- **Hero metric**: 100% usage (7 of 7)
- **Progress bar**: 7 active (full)
- **Stats row**: 7 logged in, 7 provisioned

---

## Key Data Points

### All BSMH (Aug 2025 - Feb 2026) — 22 logged-in users

| User | Page Loads | Active Days | First Seen | Last Seen |
|------|-----------|-------------|------------|-----------|
| rlreed@mercy.com | 1,975 | 10 | 2025-08-19 | 2026-02-26 |
| renee_porter@bshsi.org | 853 | 13 | 2025-08-19 | 2026-02-17 |
| rzajaczkowski@mercy.com | 662 | 8 | 2025-08-19 | 2026-02-03 |
| donna_robertson@bshsi.org | 452 | 5 | 2025-09-15 | 2025-12-23 |
| eedwards2@mercy.com | 384 | 3 | 2025-08-13 | 2025-12-15 |
| donna_lohr@bshsi.org | 377 | 7 | 2025-09-15 | 2025-10-21 |
| *(16 more users)* | | | | |

### Lima (All Time) — 7 users

| User | Page Loads | Active Days | First Seen | Last Seen |
|------|-----------|-------------|------------|-----------|
| eedwards2@mercy.com | 694 | 19 | 2024-07-10 | 2025-12-15 |
| cahonigford@mercy.com | 464 | 17 | 2024-08-05 | 2026-02-18 |
| mtowens1@mercy.com | 292 | 12 | 2024-07-09 | 2025-05-12 |
| scleemput@mercy.com | 275 | 12 | 2024-08-15 | 2025-10-22 |
| slschulte2@mercy.com | 259 | 10 | 2024-07-10 | 2025-07-22 |
| jdfishersrmc@mercy.com | 168 | 3 | 2024-08-15 | 2025-11-19 |
| tdmiller1@mercy.com | 53 | 2 | 2025-04-17 | 2025-06-18 |

---

## Important Notes

- **4 users overlap**: eedwards2, cahonigford, scleemput, and jdfishersrmc appear in both the total 22 and the Lima 7. They accessed both Lima and non-Lima content.
- **3 Lima-only users not in total**: mtowens1, slschulte2, tdmiller1 were last active before Aug 2025, so they don't appear in the Aug 2025 - Feb 2026 window.
- **Lima activity has tapered**: Only cahonigford was active after Aug 2025. The other 6 last accessed between May and Dec 2025.
- **Provisioned denominator (37)**: Client-provided for all of BSMH. No per-market breakdown is available in the data.

---

## Iteration History

| # | Name | Key Change |
|---|------|-----------|
| 01 | non-lima-aug2025 | Non-Lima provisioned users only: 22/37 = 59%. Used all-BSMH denominator for non-Lima numerator |
| 02 | split-denominator | Split denominator: non-Lima 22/30 = 73%, Lima 7/7 = 100%. Derived 30 as 37 - 7 Lima users |
| 03 | total-and-lima | **Current** — reverted to total BSMH (22/37 = 59%) with Lima as separate side card |

### Precursor Queries (bsmh-usage-summary)

| Iteration | Query | Result |
|-----------|-------|--------|
| 09-reproducible | `provisioned-usage.sql` | 26/37 = 70% (all-time, all markets) |
| 10-market-split | `provisioned-usage-non-lima.sql` | Non-Lima users, Aug 2025 - Feb 2026 |
| 10-market-split | `provisioned-usage-lima.sql` | Lima users, all time |

The precursor query (iter 09) counted 26 all-time logged-in users vs. 22 in the Aug 2025 - Feb 2026 window. The difference (4 users) represents people who only logged in before Aug 2025.

### Key Design Decision

Iteration 02 split the denominator (30 non-Lima / 7 Lima) to show a higher non-Lima rate (73%). Iteration 03 reverted to the simpler framing (22/37 total + separate Lima card) because:
- The 37 provisioned count is a single client-provided number with no per-market breakdown
- Deriving 30 = 37 - 7 assumes the 7 Lima users are a distinct set, but 4 of them also accessed non-Lima content
- The simpler framing avoids questionable denominator math
