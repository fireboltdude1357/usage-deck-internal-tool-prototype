import type {
  AdoptionEngagementSnapshot,
  AdoptionEngagementView,
  AdoptionMonthPoint,
  Client,
  EngagementDefinition,
  Kpi,
  PlatformSnapshot,
  Series,
  CategoryBar,
  Market,
  MarketCard,
  MarketSnapshot,
  MarketBar,
  ProvisionedUsersSnapshot,
  RiskFactorViews,
  UserRow,
} from "$lib/schema/snapshot"
import { MARKETS_BY_CLIENT, BU_UUID_MARKET, RECURRING_WINDOW } from "./config"
import { monthBoundaries } from "./pagination"

export interface ProviderEvent {
  readonly month: string
  readonly user_email: string
  readonly bu_uuid: string
  readonly provider_legacy_id: string
}
export interface UnitEvent {
  readonly month: string
  readonly user_email: string
  readonly bu_uuid: string
  readonly group_uuid: string
}
export interface MonthlyActivity {
  readonly month: string
  readonly user_email: string
  readonly event_count: number
}
export interface RiskFactorEvent {
  readonly month: string
  readonly user_email: string
  readonly url: string
  readonly view_type: "overview" | "drilldown" | "other"
}
// Per-(month, user) row from userActivityByMonthQuery. Merged across months
// in buildProvisionedSnapshot to produce one UserRow per email.
export interface UserActivityMonth {
  readonly month: string
  readonly user_email: string
  readonly page_loads: number
  readonly active_days: number
  readonly first_seen: string // YYYY-MM-DD
  readonly last_seen: string
}

export interface AggregatorInput {
  readonly client: Client
  readonly startMonth: string
  readonly endMonth: string
  readonly providerEvents: readonly ProviderEvent[]
  readonly unitEvents: readonly UnitEvent[]
  readonly monthlyActivity: readonly MonthlyActivity[]
  readonly riskFactorEvents: readonly RiskFactorEvent[]
  // Total clinicians on the roster. Sourced from the RDS-derived snapshot;
  // when the platform pipeline runs without the snapshot available, 0 is
  // passed and the page loader supplies the value out-of-band.
  readonly cliniciansMonitored: number
}

export interface MarketAggregatorInput {
  readonly client: Client
  readonly startMonth: string
  readonly endMonth: string
  readonly providerEvents: readonly ProviderEvent[]
  readonly unitEvents: readonly UnitEvent[]
  // Per-market clinician roster counts. Sourced from the RDS-derived snapshot
  // (clinicians_by_market). Drives the "pct_clinicians_viewed" card field.
  readonly cliniciansByMarket: Readonly<Record<Market, number>>
}

export interface ProvisionedAggregatorInput {
  readonly client: Client
  readonly startMonth: string
  readonly endMonth: string
  readonly providerEvents: readonly ProviderEvent[]
  readonly unitEvents: readonly UnitEvent[]
  readonly userActivity: readonly UserActivityMonth[]
  readonly provisionedTotal: number | null
  readonly provisionedLima: number | null
}

const monthList = (start: string, end: string): string[] =>
  monthBoundaries(start, end).map((b) => b.from.slice(0, 7))

const countByMonth = (
  rows: readonly { month: string }[],
  months: readonly string[],
): Series => {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.month, (counts.get(r.month) ?? 0) + 1)
  return months.map((m) => ({ month: m, value: counts.get(m) ?? 0 }))
}

const topUnits = (rows: readonly UnitEvent[], n: number): readonly CategoryBar[] => {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.group_uuid, (counts.get(r.group_uuid) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([uuid, value]) => ({ label: uuidLabel(uuid), value }))
}

// Match the existing fixture's label shape ("c034050b…") so phase 03's RDS
// join can swap in human names without changing the schema.
const uuidLabel = (uuid: string): string => `${uuid.slice(0, 8)}…`

const riskFactorTallies = (
  events: readonly RiskFactorEvent[],
): RiskFactorViews => {
  let overview = 0
  let drilldown = 0
  let other = 0
  for (const r of events) {
    if (r.view_type === "overview") overview++
    else if (r.view_type === "drilldown") drilldown++
    else other++
  }
  return { total: overview + drilldown + other, overview, drilldown, other }
}

const recurringStats = (
  monthly: readonly MonthlyActivity[],
): { recurring: number; totalInWindow: number } => {
  const winSet = new Set<string>(RECURRING_WINDOW)
  const monthsByUser = new Map<string, Set<string>>()
  for (const r of monthly) {
    if (!winSet.has(r.month)) continue
    const set = monthsByUser.get(r.user_email) ?? new Set<string>()
    set.add(r.month)
    monthsByUser.set(r.user_email, set)
  }
  let recurring = 0
  for (const months of monthsByUser.values()) if (months.size >= 3) recurring++
  return { recurring, totalInWindow: monthsByUser.size }
}

export const buildPlatformSnapshot = (input: AggregatorInput): PlatformSnapshot => {
  const months = monthList(input.startMonth, input.endMonth)
  const calendarMonths = months.length

  const uniqueProviders = new Set(
    input.providerEvents.map((e) => e.provider_legacy_id),
  ).size
  const uniqueUnits = new Set(input.unitEvents.map((e) => e.group_uuid)).size
  const activeUsers = new Set(input.monthlyActivity.map((e) => e.user_email)).size

  const totalProviderViews = input.providerEvents.length
  const totalUnitViews = input.unitEvents.length

  const { recurring, totalInWindow } = recurringStats(input.monthlyActivity)
  const retentionPct =
    totalInWindow === 0 ? 0 : Math.round((recurring / totalInWindow) * 100)

  const riskFactors = riskFactorTallies(input.riskFactorEvents)

  const kpis: readonly Kpi[] = [
    { label: "Unique providers viewed", value: uniqueProviders, unit: "count" },
    { label: "Unique units viewed", value: uniqueUnits, unit: "count" },
    { label: "Active platform users", value: activeUsers, unit: "count" },
    {
      label: "Recurring leaders (3+ mo)",
      value: recurring,
      denominator: totalInWindow,
      unit: "count",
    },
    { label: "Retention rate", value: retentionPct, unit: "percent" },
    { label: "Risk factor views", value: riskFactors.total, unit: "count" },
  ]

  return {
    client: input.client,
    month: input.endMonth,
    generated_at: new Date().toISOString(),
    source: "posthog",
    metrics: {
      kpis,
      provider_views_by_month: countByMonth(input.providerEvents, months),
      unit_views_by_month: countByMonth(input.unitEvents, months),
      top_units_viewed: topUnits(input.unitEvents, 10),
      risk_factor_views: riskFactors,
      total_provider_views: totalProviderViews,
      total_unit_views: totalUnitViews,
      clinicians_monitored: input.cliniciansMonitored,
      calendar_months: calendarMonths,
      recurring_window_months: RECURRING_WINDOW.length,
      unique_users: activeUsers,
      recurring_leaders: recurring,
      total_users_in_window: totalInWindow,
      retention_rate: retentionPct,
    },
  }
}

// Bucket a list of bu_uuid-bearing rows into per-market counts. Unmapped
// bu_uuids are dropped silently (URLs from outside the client's known regions)
// — same posture as the snapshot's BU_CODE_MARKET handling. Markets with zero
// events are zero-filled so /market-engagement always renders a bar per market.
const bucketByMarket = (
  client: Client,
  rows: readonly { bu_uuid: string }[],
): readonly MarketBar[] => {
  const markets = MARKETS_BY_CLIENT[client]
  const map = BU_UUID_MARKET[client]
  const counts = new Map<Market, number>()
  for (const m of markets) counts.set(m, 0)
  for (const r of rows) {
    const market = map[r.bu_uuid]
    if (!market) continue
    counts.set(market, (counts.get(market) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([market, value]) => ({ market, value }))
    .sort((a, b) => b.value - a.value)
}

// Per-market unique-user count: distinct emails per market across both
// provider and unit events. (A user counted once per market they touched.)
const usersByMarket = (
  client: Client,
  providers: readonly ProviderEvent[],
  units: readonly UnitEvent[],
): readonly MarketBar[] => {
  const markets = MARKETS_BY_CLIENT[client]
  const map = BU_UUID_MARKET[client]
  const sets = new Map<Market, Set<string>>()
  for (const m of markets) sets.set(m, new Set())
  const consume = (rows: readonly { bu_uuid: string; user_email: string }[]) => {
    for (const r of rows) {
      const market = map[r.bu_uuid]
      if (!market) continue
      sets.get(market)?.add(r.user_email)
    }
  }
  consume(providers)
  consume(units)
  return [...sets.entries()]
    .map(([market, set]) => ({ market, value: set.size }))
    .sort((a, b) => b.value - a.value)
}

// Per-market retention cards. Mirrors the iter-10 generate-html.py logic:
// a user is "active in market M in month X" iff they viewed a unit OR provider
// page in M's BUs during month X. Recurring leaders = ≥3 active months in the
// 5-month recurring window. Averages divide by full calendar span, not active
// months (project rule from iter-09 fix-monthly-averages).
const buildMarketCards = (
  client: Client,
  providers: readonly ProviderEvent[],
  units: readonly UnitEvent[],
  cliniciansByMarket: Readonly<Record<Market, number>>,
  calendarMonths: number,
): readonly MarketCard[] => {
  const markets = MARKETS_BY_CLIENT[client]
  const map = BU_UUID_MARKET[client]
  const winSet = new Set<string>(RECURRING_WINDOW)

  type Bucket = {
    providerEvents: number
    unitEvents: number
    uniqueProviders: Set<string>
    uniqueUnits: Set<string>
    users: Set<string>
    userMonthsInWindow: Map<string, Set<string>>
  }
  const make = (): Bucket => ({
    providerEvents: 0,
    unitEvents: 0,
    uniqueProviders: new Set(),
    uniqueUnits: new Set(),
    users: new Set(),
    userMonthsInWindow: new Map(),
  })
  const buckets = new Map<Market, Bucket>()
  for (const m of markets) buckets.set(m, make())

  const trackWindow = (b: Bucket, email: string, month: string) => {
    if (!winSet.has(month)) return
    const set = b.userMonthsInWindow.get(email) ?? new Set<string>()
    set.add(month)
    b.userMonthsInWindow.set(email, set)
  }

  for (const e of providers) {
    const market = map[e.bu_uuid]
    if (!market) continue
    const b = buckets.get(market)!
    b.providerEvents++
    if (e.provider_legacy_id) b.uniqueProviders.add(e.provider_legacy_id)
    b.users.add(e.user_email)
    trackWindow(b, e.user_email, e.month)
  }
  for (const e of units) {
    const market = map[e.bu_uuid]
    if (!market) continue
    const b = buckets.get(market)!
    b.unitEvents++
    if (e.group_uuid) b.uniqueUnits.add(e.group_uuid)
    b.users.add(e.user_email)
    trackWindow(b, e.user_email, e.month)
  }

  return markets.map((market): MarketCard => {
    const b = buckets.get(market)!
    const clinicians = cliniciansByMarket[market] ?? 0
    const totalUsersInWindow = b.userMonthsInWindow.size
    let recurringLeaders = 0
    for (const months of b.userMonthsInWindow.values()) {
      if (months.size >= 3) recurringLeaders++
    }
    const div = (n: number, d: number) => (d === 0 ? 0 : Math.round(n / d))
    const round1 = (n: number) => Math.round(n * 10) / 10
    return {
      market,
      unique_providers: b.uniqueProviders.size,
      total_provider_views: b.providerEvents,
      avg_provider_views_per_month: div(b.providerEvents, calendarMonths),
      unique_units: b.uniqueUnits.size,
      total_unit_views: b.unitEvents,
      avg_unit_views_per_month: div(b.unitEvents, calendarMonths),
      clinicians,
      pct_clinicians_viewed:
        clinicians === 0 ? 0 : round1((b.uniqueProviders.size / clinicians) * 100),
      unique_users: b.users.size,
      recurring_leaders: recurringLeaders,
      total_users_in_window: totalUsersInWindow,
      retention_rate:
        totalUsersInWindow === 0
          ? 0
          : Math.round((recurringLeaders / totalUsersInWindow) * 100),
    }
  })
}

const cliniciansByMarketArray = (
  client: Client,
  cliniciansByMarket: Readonly<Record<Market, number>>,
): readonly MarketBar[] =>
  MARKETS_BY_CLIENT[client]
    .map((market) => ({ market, value: cliniciansByMarket[market] ?? 0 }))
    .sort((a, b) => b.value - a.value)

export const buildMarketSnapshot = (
  input: MarketAggregatorInput,
): MarketSnapshot => {
  const calendarMonths = monthList(input.startMonth, input.endMonth).length
  return {
    client: input.client,
    month: input.endMonth,
    generated_at: new Date().toISOString(),
    source: "posthog",
    metrics: {
      provider_views_by_market: bucketByMarket(input.client, input.providerEvents),
      unit_views_by_market: bucketByMarket(input.client, input.unitEvents),
      users_by_market: usersByMarket(input.client, input.providerEvents, input.unitEvents),
      clinicians_by_market: cliniciansByMarketArray(input.client, input.cliniciansByMarket),
      market_cards: buildMarketCards(
        input.client,
        input.providerEvents,
        input.unitEvents,
        input.cliniciansByMarket,
        calendarMonths,
      ),
      calendar_months: calendarMonths,
      recurring_window_months: RECURRING_WINDOW.length,
    },
  }
}

// Most-frequent bu_uuid → market for a single user, given that user's region
// touches across provider + unit events. Returns null if the user has no
// region-attributable events (option A).
const attributeUserMarket = (
  client: Client,
  email: string,
  providers: readonly ProviderEvent[],
  units: readonly UnitEvent[],
): Market | undefined => {
  const map = BU_UUID_MARKET[client]
  const counts = new Map<Market, number>()
  const tally = (rows: readonly { bu_uuid: string; user_email: string }[]) => {
    for (const r of rows) {
      if (r.user_email !== email) continue
      const market = map[r.bu_uuid]
      if (!market) continue
      counts.set(market, (counts.get(market) ?? 0) + 1)
    }
  }
  tally(providers)
  tally(units)
  if (counts.size === 0) return undefined
  let best: Market | undefined
  let bestCount = -1
  for (const [market, count] of counts) {
    if (count > bestCount) {
      best = market
      bestCount = count
    }
  }
  return best
}

// Merge per-(month, user) rows into one row per user. active_days within a
// month never repeat across months, so summing is correct; first_seen/last_seen
// take the min/max of the dates.
const mergeUserActivity = (
  monthly: readonly UserActivityMonth[],
): Map<string, { page_loads: number; active_days: number; first_seen: string; last_seen: string }> => {
  const out = new Map<
    string,
    { page_loads: number; active_days: number; first_seen: string; last_seen: string }
  >()
  for (const r of monthly) {
    const cur = out.get(r.user_email)
    if (!cur) {
      out.set(r.user_email, {
        page_loads: r.page_loads,
        active_days: r.active_days,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
      })
      continue
    }
    cur.page_loads += r.page_loads
    cur.active_days += r.active_days
    if (r.first_seen < cur.first_seen) cur.first_seen = r.first_seen
    if (r.last_seen > cur.last_seen) cur.last_seen = r.last_seen
  }
  return out
}

export const buildProvisionedSnapshot = (
  input: ProvisionedAggregatorInput,
): ProvisionedUsersSnapshot => {
  const merged = mergeUserActivity(input.userActivity)
  const userRows: UserRow[] = [...merged.entries()]
    .map(([email, agg]) => {
      const market = attributeUserMarket(
        input.client,
        email,
        input.providerEvents,
        input.unitEvents,
      )
      const row: UserRow = {
        email,
        page_loads: agg.page_loads,
        active_days: agg.active_days,
        first_seen: agg.first_seen,
        last_seen: agg.last_seen,
      }
      return market ? { ...row, market } : row
    })
    .sort((a, b) => b.page_loads - a.page_loads)

  const loggedIn = userRows.length
  const limaLoggedIn = userRows.filter((r) => r.market === "Lima").length

  const total: Kpi = {
    label: "Logged in",
    value: loggedIn,
    ...(input.provisionedTotal !== null
      ? { denominator: input.provisionedTotal }
      : {}),
    unit: "count",
  }
  const lima: Kpi = {
    label: "Lima logged in",
    value: limaLoggedIn,
    ...(input.provisionedLima !== null
      ? { denominator: input.provisionedLima }
      : {}),
    unit: "count",
  }

  return {
    client: input.client,
    month: input.endMonth,
    generated_at: new Date().toISOString(),
    source: "posthog",
    metrics: {
      total,
      lima,
      user_detail: userRows,
    },
  }
}

export interface AdoptionEngagementAggregatorInput {
  readonly client: Client
  readonly startMonth: string
  readonly endMonth: string
  // Reuses the same per-(month, user) rows the /provisioned-users page fetches,
  // so requesting both pages back-to-back is one HogQL roundtrip thanks to the
  // shared cache key. `page_loads` and `active_days` drive the power-user and
  // multi-day definitions.
  readonly userActivity: readonly UserActivityMonth[]
}

// Static metadata for each definition. Centralized so the page tab strip and
// the aggregator agree on labels/descriptions and so new definitions can be
// added in one place.
interface DefinitionMeta {
  readonly definition: EngagementDefinition
  readonly label: string
  readonly description: string
}

const DEFINITIONS: readonly DefinitionMeta[] = [
  {
    definition: "mau",
    label: "Monthly active",
    description: "≥1 session in this month.",
  },
  {
    definition: "rolling_3mo",
    label: "Rolling 3-mo",
    description: "≥1 session in the trailing 3 months. Users can drop out after 3 silent months and re-engage later.",
  },
  {
    definition: "rolling_6mo",
    label: "Rolling 6-mo",
    description: "≥1 session in the trailing 6 months. More permissive than rolling 3-mo; catches quarterly-cadence users.",
  },
  {
    definition: "l2_3",
    label: "L2/3",
    description: "Active in ≥2 of the last 3 months — frequency-based, filters one-touch users out of \"engaged\".",
  },
  {
    definition: "l3_6",
    label: "L3/6",
    description: "Active in ≥3 of the last 6 months — captures consistent but not necessarily monthly use.",
  },
  {
    definition: "power_user",
    label: "Power user",
    description: "≥5 page-loads in the trailing 3 months. Depth threshold — differentiates \"opened it\" from \"working with it\".",
  },
  {
    definition: "multi_day",
    label: "Multi-day",
    description: "≥2 distinct active days in the trailing 3 months. Stronger than page-load count alone; filters single-binge sessions.",
  },
  {
    definition: "no_gap_3mo",
    label: "No 3-mo gap",
    description: "Never silent for 3 consecutive months since first-seen. One slip and a user is permanently out.",
  },
  {
    definition: "ever_3_months",
    label: "Lifetime 3+ mo",
    description: "Any session in ≥3 distinct months. Once a user clears the bar, they're permanently engaged.",
  },
]

interface UserPrecompute {
  readonly months: readonly string[] // sorted ascending
  readonly monthSet: ReadonlySet<string>
  readonly firstSeen: string
  readonly pageLoadsByMonth: ReadonlyMap<string, number>
  readonly activeDaysByMonth: ReadonlyMap<string, number>
}

const buildUserPrecompute = (
  userActivity: readonly UserActivityMonth[],
): Map<string, UserPrecompute> => {
  type Mut = {
    months: string[]
    monthSet: Set<string>
    pageLoadsByMonth: Map<string, number>
    activeDaysByMonth: Map<string, number>
  }
  const mut = new Map<string, Mut>()
  for (const r of userActivity) {
    const cur =
      mut.get(r.user_email) ??
      ({
        months: [],
        monthSet: new Set<string>(),
        pageLoadsByMonth: new Map<string, number>(),
        activeDaysByMonth: new Map<string, number>(),
      } satisfies Mut)
    if (!cur.monthSet.has(r.month)) {
      cur.monthSet.add(r.month)
      cur.months.push(r.month)
    }
    cur.pageLoadsByMonth.set(
      r.month,
      (cur.pageLoadsByMonth.get(r.month) ?? 0) + r.page_loads,
    )
    cur.activeDaysByMonth.set(
      r.month,
      (cur.activeDaysByMonth.get(r.month) ?? 0) + r.active_days,
    )
    mut.set(r.user_email, cur)
  }
  const out = new Map<string, UserPrecompute>()
  for (const [email, m] of mut) {
    m.months.sort()
    out.set(email, {
      months: m.months,
      monthSet: m.monthSet,
      firstSeen: m.months[0],
      pageLoadsByMonth: m.pageLoadsByMonth,
      activeDaysByMonth: m.activeDaysByMonth,
    })
  }
  return out
}

// Window slice helpers. The series window is the picker range; engagement
// lookback windows are clamped to it (e.g. rolling 6-mo at month X with picker
// starting at X means just month X).
const slice = (months: readonly string[], endIdx: number, lookback: number): readonly string[] => {
  const from = Math.max(0, endIdx - (lookback - 1))
  return months.slice(from, endIdx + 1)
}

const countActiveMonthsInRange = (
  pre: UserPrecompute,
  range: readonly string[],
): number => {
  let n = 0
  for (const m of range) if (pre.monthSet.has(m)) n++
  return n
}

const sumOver = (
  byMonth: ReadonlyMap<string, number>,
  range: readonly string[],
): number => {
  let n = 0
  for (const m of range) n += byMonth.get(m) ?? 0
  return n
}

// "No 3-month gap" disengagement month per user: the first month M in
// [firstSeen, …] where the rolling-3 window [M-2, M] has no activity. Returns
// null if the user never disengages within the picker range.
const noGapDisengagementMonth = (
  pre: UserPrecompute,
  windowMonths: readonly string[],
): string | null => {
  const fIdx = windowMonths.indexOf(pre.firstSeen)
  if (fIdx === -1) return null
  for (let i = fIdx + 1; i < windowMonths.length; i++) {
    const win = slice(windowMonths, i, 3)
    if (countActiveMonthsInRange(pre, win) === 0) return windowMonths[i]
  }
  return null
}

// Month at which the user accumulates their 3rd distinct active month.
// `null` if they don't reach 3 within the picker window.
const lifetime3AchievedMonth = (pre: UserPrecompute): string | null =>
  pre.months.length >= 3 ? pre.months[2] : null

const computeEngagedByMonth = (
  definition: EngagementDefinition,
  windowMonths: readonly string[],
  users: Map<string, UserPrecompute>,
): Series => {
  // Per-user permanent-status months (only used by the two terminal defs).
  const disengagement = new Map<string, string | null>()
  const lifetime = new Map<string, string | null>()
  if (definition === "no_gap_3mo") {
    for (const [u, pre] of users) disengagement.set(u, noGapDisengagementMonth(pre, windowMonths))
  }
  if (definition === "ever_3_months") {
    for (const [u, pre] of users) lifetime.set(u, lifetime3AchievedMonth(pre))
  }

  return windowMonths.map((m, i) => {
    let engaged = 0
    for (const [u, pre] of users) {
      // Skip users who haven't been seen yet by month M (their firstSeen > M
      // means they aren't in the adopter pool yet, so they can't be engaged).
      if (pre.firstSeen > m) continue

      let ok = false
      switch (definition) {
        case "mau":
          ok = pre.monthSet.has(m)
          break
        case "rolling_3mo":
          ok = countActiveMonthsInRange(pre, slice(windowMonths, i, 3)) >= 1
          break
        case "rolling_6mo":
          ok = countActiveMonthsInRange(pre, slice(windowMonths, i, 6)) >= 1
          break
        case "l2_3":
          ok = countActiveMonthsInRange(pre, slice(windowMonths, i, 3)) >= 2
          break
        case "l3_6":
          ok = countActiveMonthsInRange(pre, slice(windowMonths, i, 6)) >= 3
          break
        case "power_user":
          ok = sumOver(pre.pageLoadsByMonth, slice(windowMonths, i, 3)) >= 5
          break
        case "multi_day":
          ok = sumOver(pre.activeDaysByMonth, slice(windowMonths, i, 3)) >= 2
          break
        case "no_gap_3mo": {
          const d = disengagement.get(u) ?? null
          ok = d === null || m < d
          break
        }
        case "ever_3_months": {
          const t = lifetime.get(u) ?? null
          ok = t !== null && m >= t
          break
        }
      }
      if (ok) engaged++
    }
    return { month: m, value: engaged }
  })
}

const viewKpis = (
  meta: DefinitionMeta,
  engagedByMonth: Series,
  totalAdopters: number,
): readonly Kpi[] => {
  const last = engagedByMonth[engagedByMonth.length - 1]
  const currentlyEngaged = last?.value ?? 0
  const rate =
    totalAdopters === 0 ? 0 : Math.round((currentlyEngaged / totalAdopters) * 100)
  return [
    { label: "Total adopters", value: totalAdopters, unit: "count" },
    {
      label: `Engaged (${meta.label})`,
      value: currentlyEngaged,
      denominator: totalAdopters,
      unit: "count",
    },
    { label: "Engagement rate", value: rate, unit: "percent" },
  ]
}

export const buildAdoptionEngagementSnapshot = (
  input: AdoptionEngagementAggregatorInput,
): AdoptionEngagementSnapshot => {
  const months = monthList(input.startMonth, input.endMonth)
  const users = buildUserPrecompute(input.userActivity)

  const newAdoptersByMonth = new Map<string, number>()
  for (const pre of users.values()) {
    newAdoptersByMonth.set(pre.firstSeen, (newAdoptersByMonth.get(pre.firstSeen) ?? 0) + 1)
  }

  let cumulative = 0
  const adoption: AdoptionMonthPoint[] = months.map((m) => {
    const newAdopters = newAdoptersByMonth.get(m) ?? 0
    cumulative += newAdopters
    return { month: m, new_adopters: newAdopters, adopters: cumulative }
  })

  const totalAdopters = adoption[adoption.length - 1]?.adopters ?? 0

  const views: AdoptionEngagementView[] = DEFINITIONS.map((meta) => {
    const engaged_by_month = computeEngagedByMonth(meta.definition, months, users)
    return {
      definition: meta.definition,
      label: meta.label,
      description: meta.description,
      kpis: viewKpis(meta, engaged_by_month, totalAdopters),
      engaged_by_month,
    }
  })

  return {
    client: input.client,
    month: input.endMonth,
    generated_at: new Date().toISOString(),
    source: "posthog",
    metrics: { adoption, views },
  }
}
