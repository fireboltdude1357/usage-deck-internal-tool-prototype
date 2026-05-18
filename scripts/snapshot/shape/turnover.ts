import type {
  Client,
  Market,
  Month,
  TurnoverMonthlyPoint,
  TurnoverProviderCategory,
  TurnoverProviderDetail,
  TurnoverSnapshot,
} from "$lib/schema/snapshot"
import { BU_CODE_MARKET } from "./bu-mapping.js"

// CSV row shapes — `csv-parse/sync` returns string values; the shaper coerces.

export type EmploymentMonthlyRow = {
  partition_date: string // YYYY-MM-DD (1st of month)
  group_id: string
  level_2_name: string // bsmh: BU code; populated only Feb 2024 onward
  level_3_name: string // ssm: region label
  role_category: string // "apc" | "physician" | "other"
  headcount: string
}

export type EmployeeTimelineRow = {
  employee_id: string
  quit_date: string // YYYY-MM-DD
  dob: string
  group_id: string
  job_role_name: string
  level_2_name: string
  level_3_name: string
}

export type QuitProbHistoryRow = {
  partition_date: string
  employee_id: string
  provider_id: string
  quit_prob: string
  group_id: string
  job_role_name: string
}

export type TurnoverProviderRow = {
  employee_id: string
  provider_id: string
  provider_name: string
  specialty: string
  job_role_name: string
  level_2_name: string
  level_3_name: string
}

export type TurnoverEnvelopeOpts = {
  client: Client
  month: Month
  generated_at: string
}

export interface TurnoverInputs {
  employmentMonthly: readonly EmploymentMonthlyRow[]
  employeeTimelines: readonly EmployeeTimelineRow[]
  quitProbHistory: readonly QuitProbHistoryRow[]
  providerDetail: readonly TurnoverProviderRow[]
}

// --- knobs ---

const SYSTEM = "system" as const
const FLAG_PERCENTILE = 80 // top 20th percentile = flagged
const FORECAST_HORIZON = 6 // months past forecast_origin
const ANALYSIS_WINDOW_MONTHS = 12 // §4 flagging analysis window
// SullivanCotter, "APP Turnover: A Costly Reality" (2025). Snapshot carries
// these so the page footer can cite them without baking in copy.
const NATIONAL_BENCHMARKS = { apc: 0.086, physician: 0.07 } as const

// --- role/market derivation ---

// Match the regex in employment-monthly.sql so producer + warehouse agree on
// who's APC vs Physician vs Other. Order matters: residents/fellows first
// (they often have "NP"/"PA" markers in title text), then APC, then default.
const OTHER_REGEX = /resident|fellow/
const APC_REGEX =
  /nurse practitioner|physician assistant|aprn|crna|anesthetist|midwife|\bnp\b|\bpa\b|\bapp\b/

export type RoleBucket = "apc" | "physician" | "other"

export const roleCategory = (jobRole: string | null | undefined): RoleBucket => {
  const s = (jobRole ?? "").toLowerCase()
  if (OTHER_REGEX.test(s)) return "other"
  if (APC_REGEX.test(s)) return "apc"
  return "physician"
}

const displayCategory = (jobRole: string): TurnoverProviderCategory => {
  const c = roleCategory(jobRole)
  return c === "apc" ? "APC" : c === "physician" ? "Physician" : "Other"
}

// bsmh's market key is level_2_name (BU code "6177" etc.); ssm's is
// level_3_name (region label). Duke/UCSF have no market split.
export const marketKey = (
  client: Client,
  level2: string | null | undefined,
  level3: string | null | undefined,
): string => {
  if (client === "bsmh") return (level2 ?? "").trim()
  if (client === "ssm") return (level3 ?? "").trim()
  return ""
}

const marketLabel = (client: Client, key: string): Market | null => {
  if (!key) return null
  return BU_CODE_MARKET[client][key] ?? null
}

// --- numeric / month helpers ---

const toMonth = (ds: string): Month => ds.trim().slice(0, 7) as Month

const monthToInt = (m: Month): number => {
  const [y, mo] = m.split("-").map(Number)
  return y * 12 + (mo - 1)
}
const intToMonth = (i: number): Month => {
  const y = Math.floor(i / 12)
  const mo = (i % 12) + 1
  return `${y}-${String(mo).padStart(2, "0")}` as Month
}
export const monthAdd = (m: Month, delta: number): Month =>
  intToMonth(monthToInt(m) + delta)
export const monthDiff = (a: Month, b: Month): number =>
  monthToInt(a) - monthToInt(b)

const cleanNum = (s: string | null | undefined): number => {
  if (s === null || s === undefined) return 0
  const n = Number(s.toString().trim())
  return Number.isFinite(n) ? n : 0
}

const cleanFloat = (s: string | null | undefined): number | null => {
  if (s === null || s === undefined) return null
  const trimmed = s.toString().trim()
  if (trimmed === "" || trimmed.toLowerCase() === "null") return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

// R-7 linear interpolation, matches numpy.percentile default. sorted ascending.
const percentile = (sorted: readonly number[], pct: number): number => {
  if (sorted.length === 0) return Number.POSITIVE_INFINITY
  const rank = (pct / 100) * (sorted.length - 1)
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  if (lo === hi) return sorted[lo]
  return sorted[lo] * (hi - rank) + sorted[hi] * (rank - lo)
}

const median = (arr: readonly number[]): number => {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

const mean = (arr: readonly number[]): number =>
  arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length

// --- aggregation primitives ---

// Triply-keyed sum bucket: month × scope × category → number.
type Buckets = Map<Month, Map<string, Map<RoleBucket, number>>>

const bump = (b: Buckets, month: Month, scope: string, cat: RoleBucket, v: number): void => {
  let m1 = b.get(month)
  if (!m1) {
    m1 = new Map()
    b.set(month, m1)
  }
  let m2 = m1.get(scope)
  if (!m2) {
    m2 = new Map()
    m1.set(scope, m2)
  }
  m2.set(cat, (m2.get(cat) ?? 0) + v)
}

const getBucket = (b: Buckets, month: Month, scope: string, cat: RoleBucket | "all"): number => {
  const m2 = b.get(month)?.get(scope)
  if (!m2) return 0
  if (cat === "all") return (m2.get("apc") ?? 0) + (m2.get("physician") ?? 0)
  return m2.get(cat) ?? 0
}

// All months covered by employment-monthly, ascending. Fills gaps between
// min/max so rolling-12 can iterate even where a month has zero rows.
const monthsBetween = (start: Month, end: Month): Month[] => {
  const out: Month[] = []
  for (let i = monthToInt(start); i <= monthToInt(end); i++) out.push(intToMonth(i))
  return out
}

// --- main entry point ---

export const buildTurnoverSnapshot = (
  inputs: TurnoverInputs,
  opts: TurnoverEnvelopeOpts,
): TurnoverSnapshot => {
  const { client } = opts

  // 1. Aggregate headcount per (month, scope, category).
  const headcountB: Buckets = new Map()
  for (const row of inputs.employmentMonthly) {
    const cat = row.role_category as RoleBucket
    if (cat !== "apc" && cat !== "physician") continue // drop "other"
    const month = toMonth(row.partition_date)
    const hc = cleanNum(row.headcount)
    if (hc === 0) continue
    bump(headcountB, month, SYSTEM, cat, hc)
    const market = marketLabel(client, marketKey(client, row.level_2_name, row.level_3_name))
    if (market) bump(headcountB, month, market, cat, hc)
  }

  // 2. Aggregate quits per (month, scope, category) from employee-timelines.
  //    Skip "other" — residents/fellows are dropped from turnover rates.
  const quitsB: Buckets = new Map()
  for (const row of inputs.employeeTimelines) {
    const cat = roleCategory(row.job_role_name)
    if (cat === "other") continue
    const month = toMonth(row.quit_date)
    bump(quitsB, month, SYSTEM, cat, 1)
    const market = marketLabel(client, marketKey(client, row.level_2_name, row.level_3_name))
    if (market) bump(quitsB, month, market, cat, 1)
  }

  // 3. Determine the actuals window and forecast horizon. forecast_origin is
  //    the latest month with any headcount data; projections extend
  //    FORECAST_HORIZON months past it.
  const headcountMonths = [...headcountB.keys()].sort()
  if (headcountMonths.length === 0) {
    return emptySnapshot(opts)
  }
  const firstActual = headcountMonths[0]
  const forecast_origin = headcountMonths[headcountMonths.length - 1]
  const lastProjection = monthAdd(forecast_origin, FORECAST_HORIZON)
  const allMonths = monthsBetween(firstActual, lastProjection)

  // 4. Discover all scopes that ever had data and seed empty scopes for any
  //    market the client knows about (so the page can render a Lima block
  //    even if Lima has zero providers in a given month).
  const scopeSet = new Set<string>([SYSTEM])
  for (const m1 of headcountB.values()) for (const s of m1.keys()) scopeSet.add(s)
  for (const m1 of quitsB.values()) for (const s of m1.keys()) scopeSet.add(s)
  const scopes = [...scopeSet]

  // 5. Compute projection expected_quits per (scope, category) from the
  //    latest quit-prob run. Average quit_prob across the cohort × scope's
  //    most-recent headcount → expected monthly quits. Headcount held flat.
  const projection = buildProjection(inputs.quitProbHistory, headcountB, client, forecast_origin, scopes)

  // 6. Emit monthly rows for every (month, scope, category) where the scope
  //    had any headcount in the actuals span. Categories: apc, physician, all.
  const monthly: TurnoverMonthlyPoint[] = []
  for (const scope of scopes) {
    for (const cat of ["all", "apc", "physician"] as const) {
      for (const month of allMonths) {
        const isProjection = monthToInt(month) > monthToInt(forecast_origin)

        // Actual headcount for actuals; latest actual repeated for projection.
        const hcActual = getBucket(headcountB, month, scope, cat)
        const hcLatest = getBucket(headcountB, forecast_origin, scope, cat)
        const headcount = isProjection ? hcLatest : hcActual

        if (headcount === 0 && !isProjection) {
          // Scope×category with zero presence this month — skip; rolling-12
          // would be meaningless and the page renders gaps fine.
          continue
        }

        // expected_quits from the latest quit-prob run for this scope×cat.
        // Held constant across projection months (constant-cohort projection).
        const expected = projection.get(`${scope}|${cat}`)
        const expected_quits = expected ?? null

        const quits = isProjection ? null : getBucket(quitsB, month, scope, cat)

        const rolling_12_turnover = rollingTwelve(
          month,
          scope,
          cat,
          forecast_origin,
          headcountB,
          quitsB,
          expected,
        )

        monthly.push({
          month,
          scope,
          category: cat,
          headcount,
          quits,
          expected_quits,
          rolling_12_turnover,
          is_projection: isProjection,
        })
      }
    }
  }

  // 7. §4 flagging analytics.
  const analysisStart = monthAdd(forecast_origin, -(ANALYSIS_WINDOW_MONTHS - 1))
  const flagging = buildFlagging({
    client,
    quitProb: inputs.quitProbHistory,
    timelines: inputs.employeeTimelines,
    headcountB,
    analysisStart,
    analysisEnd: forecast_origin,
  })

  // 8. §4 provider_detail table — one row per quitter in the analysis window.
  const provider_detail = buildProviderDetail({
    client,
    timelines: inputs.employeeTimelines,
    providerInfo: inputs.providerDetail,
    flagDates: flagging.flagDatesByEmployee,
    analysisStart,
    analysisEnd: forecast_origin,
  })

  return {
    client,
    month: opts.month,
    generated_at: opts.generated_at,
    source: "athena",
    metrics: {
      excluded_roles: ["resident", "fellow", "nurse", "age_65_plus"],
      national_benchmarks: NATIONAL_BENCHMARKS,
      forecast_origin,
      monthly,
      flagging: flagging.payload,
      provider_detail,
    },
  }
}

// --- projection ---

const buildProjection = (
  quitProb: readonly QuitProbHistoryRow[],
  headcountB: Buckets,
  client: Client,
  forecast_origin: Month,
  scopes: readonly string[],
): Map<string, number> => {
  // Group quit-prob rows by partition; take the latest partition only.
  if (quitProb.length === 0) return new Map()
  let latest = ""
  for (const row of quitProb) {
    const p = row.partition_date.trim()
    if (p > latest) latest = p
  }
  const latestRows = quitProb.filter((r) => r.partition_date.trim() === latest)

  // For each scope × category: collect cohort quit_probs, then expected
  // monthly quits = (mean quit_prob) × (latest headcount).
  // Latest model run may pre-date forecast_origin; we still apply its avg
  // to the latest headcount (so the projection moves with hiring trends).
  const out = new Map<string, number>()
  for (const scope of scopes) {
    for (const cat of ["apc", "physician"] as const) {
      const probs: number[] = []
      for (const row of latestRows) {
        const c = roleCategory(row.job_role_name)
        if (c !== cat) continue
        if (scope !== SYSTEM) {
          // We need market for this row. The quit-prob query joins
          // silver_employment for group_id, but doesn't expose level_2/3.
          // Skip market-scoped projections for now — the page can hide the
          // projection segment per-market if expected_quits is null. (The
          // system-level projection drives the headline KPI.)
          continue
        }
        const v = cleanFloat(row.quit_prob)
        if (v !== null) probs.push(v)
      }
      if (probs.length === 0) continue
      const avg = mean(probs)
      const hc = getBucket(headcountB, forecast_origin, scope, cat)
      out.set(`${scope}|${cat}`, avg * hc)
    }
    // "all" = apc + physician expected_quits
    const apc = out.get(`${scope}|apc`)
    const phys = out.get(`${scope}|physician`)
    if (apc !== undefined || phys !== undefined) {
      out.set(`${scope}|all`, (apc ?? 0) + (phys ?? 0))
    }
  }
  return out
}

// --- rolling-12 ---

const rollingTwelve = (
  month: Month,
  scope: string,
  cat: "all" | "apc" | "physician",
  forecast_origin: Month,
  headcountB: Buckets,
  quitsB: Buckets,
  expectedMonthly: number | undefined,
): number => {
  const headcounts: number[] = []
  let quitsSum = 0
  for (let i = 11; i >= 0; i--) {
    const m = monthAdd(month, -i)
    const isProjection = monthToInt(m) > monthToInt(forecast_origin)
    const hc = isProjection
      ? getBucket(headcountB, forecast_origin, scope, cat)
      : getBucket(headcountB, m, scope, cat)
    if (hc > 0) headcounts.push(hc)
    if (isProjection) {
      // bridge with expected quits when actuals unavailable
      if (expectedMonthly !== undefined) quitsSum += expectedMonthly
    } else {
      quitsSum += getBucket(quitsB, m, scope, cat)
    }
  }
  const avg = mean(headcounts)
  return avg === 0 ? 0 : quitsSum / avg
}

// --- flagging ---

interface BuildFlaggingArgs {
  client: Client
  quitProb: readonly QuitProbHistoryRow[]
  timelines: readonly EmployeeTimelineRow[]
  headcountB: Buckets
  analysisStart: Month
  analysisEnd: Month
}

const buildFlagging = (args: BuildFlaggingArgs) => {
  const { client, quitProb, timelines, headcountB, analysisStart, analysisEnd } = args

  // 1. Build cutoffs: per (partition_month, scope) → 80th-percentile quit_prob.
  //    We need to know each row's scope (system + optional market). The
  //    quit-prob CSV doesn't carry level_2/3, so market scoping for flagging
  //    is omitted at the per-partition cutoff level. The market-level §4
  //    metrics use the timeline rows' level_2/3 for market assignment but
  //    share the *system* cutoff. This matches the QBR's framing ("of N
  //    quitters in market X, K were in the top 20th percentile system-wide").
  const partitionMonths = new Set<Month>()
  for (const r of quitProb) partitionMonths.add(toMonth(r.partition_date))
  const cutoffByMonth = new Map<Month, number>()
  const byMonth = new Map<Month, QuitProbHistoryRow[]>()
  for (const r of quitProb) {
    const m = toMonth(r.partition_date)
    const list = byMonth.get(m) ?? []
    list.push(r)
    byMonth.set(m, list)
  }
  for (const [m, rows] of byMonth) {
    const probs = rows
      .map((r) => cleanFloat(r.quit_prob))
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)
    cutoffByMonth.set(m, percentile(probs, FLAG_PERCENTILE))
  }

  // 2. For each employee, the months they were flagged (≥ cutoff that month).
  //    Used both for retrospective-flagging-of-quitters and for "active
  //    provider flagging" aggregates.
  const flagsByEmployee = new Map<string, Month[]>()
  for (const r of quitProb) {
    const v = cleanFloat(r.quit_prob)
    if (v === null) continue
    const m = toMonth(r.partition_date)
    const cutoff = cutoffByMonth.get(m) ?? Number.POSITIVE_INFINITY
    if (v >= cutoff) {
      const list = flagsByEmployee.get(r.employee_id) ?? []
      list.push(m)
      flagsByEmployee.set(r.employee_id, list)
    }
  }
  for (const list of flagsByEmployee.values()) list.sort()

  // 3. Retrospective flagging on quitters within the analysis window.
  type Quitter = {
    employee_id: string
    quitMonth: Month
    cat: RoleBucket
    market: Market | null
    flagMonth: Month | null
    leadMonths: number | null
  }
  const quittersInWindow: Quitter[] = []
  for (const row of timelines) {
    const cat = roleCategory(row.job_role_name)
    if (cat === "other") continue
    const qm = toMonth(row.quit_date)
    if (monthToInt(qm) < monthToInt(analysisStart) || monthToInt(qm) > monthToInt(analysisEnd)) {
      continue
    }
    const market = marketLabel(client, marketKey(client, row.level_2_name, row.level_3_name))
    const flags = flagsByEmployee.get(row.employee_id) ?? []
    // Latest flag that's strictly before the quit month.
    let flagMonth: Month | null = null
    for (const fm of flags) {
      if (monthToInt(fm) < monthToInt(qm)) flagMonth = fm
    }
    const leadMonths = flagMonth ? monthDiff(qm, flagMonth) : null
    quittersInWindow.push({
      employee_id: row.employee_id,
      quitMonth: qm,
      cat,
      market,
      flagMonth,
      leadMonths,
    })
  }

  // 4. System-level + per-market aggregates.
  const systemFlagged = quittersInWindow.filter((q) => q.flagMonth !== null)
  const systemLeads = systemFlagged.map((q) => q.leadMonths!)
  const analysisMonthCount = monthDiff(analysisEnd, analysisStart) + 1

  // "Average flagged per month" — distinct employees in the flagged-quitter
  // set per analysis-window month.
  const systemAvgFlaggedPerMonth = systemFlagged.length / analysisMonthCount

  // Most-recent system headcount (apc+physician).
  const mostRecentSystem = getBucket(headcountB, analysisEnd, SYSTEM, "all")

  const systemBlock = {
    n_quitters: quittersInWindow.length,
    n_flagged: systemFlagged.length,
    flag_rate: quittersInWindow.length === 0 ? 0 : systemFlagged.length / quittersInWindow.length,
    mean_lead_months: mean(systemLeads),
    median_lead_months: median(systemLeads),
    avg_flagged_per_month: systemAvgFlaggedPerMonth,
    most_recent_headcount: mostRecentSystem,
  }

  // Per-market: only emit markets the client knows about (BU_CODE_MARKET).
  const marketSet = new Set<Market>()
  for (const q of quittersInWindow) if (q.market) marketSet.add(q.market)
  const by_market = [...marketSet]
    .sort()
    .map((market) => {
      const qs = quittersInWindow.filter((q) => q.market === market)
      const flagged = qs.filter((q) => q.flagMonth !== null)
      const leads = flagged.map((q) => q.leadMonths!)
      return {
        market,
        n_quitters: qs.length,
        n_flagged: flagged.length,
        flag_rate: qs.length === 0 ? 0 : flagged.length / qs.length,
        mean_lead_months: mean(leads),
        avg_flagged_per_month: flagged.length / analysisMonthCount,
      }
    })

  // 5. Active provider flagging (last 12 partitions of quit-prob).
  //    "active" = distinct employees seen in any of the last 12 partitions of
  //    quit-prob-history. "flagged" = those who were flagged in ≥1 partition.
  //    "quit" = those who appear as a quitter in the analysis window (flagged
  //    OR not; we report flagged who quit).
  const sortedPartitions = [...partitionMonths].sort()
  const last12Partitions = sortedPartitions.slice(-12)
  const activeIds = new Set<string>()
  const flaggedActive = new Set<string>()
  // index quit-prob rows by partition for the per-row market join
  const empToMarket = new Map<string, Market | null>() // last seen wins
  for (const r of quitProb) {
    const m = toMonth(r.partition_date)
    if (!last12Partitions.includes(m)) continue
    activeIds.add(r.employee_id)
    const v = cleanFloat(r.quit_prob)
    const cutoff = cutoffByMonth.get(m) ?? Number.POSITIVE_INFINITY
    if (v !== null && v >= cutoff) flaggedActive.add(r.employee_id)
  }
  // For market assignment of active providers, use the most recent timeline
  // row available for the employee (timelines covers quitters; for active
  // non-quitters we have no market — they fall under system-only).
  for (const row of timelines) {
    const market = marketLabel(client, marketKey(client, row.level_2_name, row.level_3_name))
    empToMarket.set(row.employee_id, market)
  }

  const quitIds = new Set(quittersInWindow.map((q) => q.employee_id))

  const activeSystem = {
    active: activeIds.size,
    flagged: flaggedActive.size,
    quit: [...flaggedActive].filter((id) => quitIds.has(id)).length,
  }

  const activeByMarket = [...marketSet]
    .sort()
    .map((market) => {
      const ids = [...activeIds].filter((id) => empToMarket.get(id) === market)
      const flagged = ids.filter((id) => flaggedActive.has(id))
      const quit = flagged.filter((id) => quitIds.has(id))
      return {
        market,
        active: ids.length,
        flagged: flagged.length,
        quit: quit.length,
      }
    })

  return {
    payload: {
      analysis_window: { start: analysisStart, end: analysisEnd },
      flag_percentile: FLAG_PERCENTILE,
      system: systemBlock,
      by_market,
      active: { system: activeSystem, by_market: activeByMarket },
    },
    // expose flagDatesByEmployee so the caller can populate provider_detail
    flagDatesByEmployee: flagsByEmployee,
  }
}

// --- provider_detail ---

interface BuildProviderDetailArgs {
  client: Client
  timelines: readonly EmployeeTimelineRow[]
  providerInfo: readonly TurnoverProviderRow[]
  flagDates: Map<string, Month[]>
  analysisStart: Month
  analysisEnd: Month
}

const buildProviderDetail = (args: BuildProviderDetailArgs): TurnoverProviderDetail[] => {
  const { client, timelines, providerInfo, flagDates, analysisStart, analysisEnd } = args

  // Index provider-detail rows by employee_id for name/specialty/bu lookup.
  const infoByEmp = new Map<string, TurnoverProviderRow>()
  for (const r of providerInfo) infoByEmp.set(r.employee_id, r)

  const out: TurnoverProviderDetail[] = []
  for (const row of timelines) {
    const cat = roleCategory(row.job_role_name)
    if (cat === "other") continue
    const qm = toMonth(row.quit_date)
    if (monthToInt(qm) < monthToInt(analysisStart) || monthToInt(qm) > monthToInt(analysisEnd)) {
      continue
    }
    const info = infoByEmp.get(row.employee_id)
    // Market: prefer the provider-detail row (latest known group), fall back
    // to the timeline row's level_2/3.
    const infoKey = info
      ? marketKey(client, info.level_2_name, info.level_3_name)
      : ""
    const market = infoKey
      ? marketLabel(client, infoKey)
      : marketLabel(client, marketKey(client, row.level_2_name, row.level_3_name))

    // Latest flag before quit_date.
    const flags = flagDates.get(row.employee_id) ?? []
    let flag: Month | null = null
    for (const fm of flags) {
      if (monthToInt(fm) < monthToInt(qm)) flag = fm
    }
    const months_prior = flag ? monthDiff(qm, flag) : null

    out.push({
      provider_id: info?.provider_id ?? row.employee_id,
      name: info?.provider_name?.trim() ?? "",
      category: displayCategory(info?.job_role_name ?? row.job_role_name),
      specialty: info?.specialty?.trim() ?? "",
      market,
      quit_date: qm,
      flag_date: flag,
      months_prior,
    })
  }
  // Sort: most recent quit first; ties by name.
  out.sort((a, b) => {
    if (a.quit_date !== b.quit_date) return a.quit_date > b.quit_date ? -1 : 1
    return a.name < b.name ? -1 : 1
  })
  return out
}

// --- empty-input fallback ---

const emptySnapshot = (opts: TurnoverEnvelopeOpts): TurnoverSnapshot => ({
  client: opts.client,
  month: opts.month,
  generated_at: opts.generated_at,
  source: "athena",
  metrics: {
    excluded_roles: ["resident", "fellow", "nurse", "age_65_plus"],
    national_benchmarks: NATIONAL_BENCHMARKS,
    forecast_origin: opts.month,
    monthly: [],
    flagging: {
      analysis_window: { start: opts.month, end: opts.month },
      flag_percentile: FLAG_PERCENTILE,
      system: {
        n_quitters: 0,
        n_flagged: 0,
        flag_rate: 0,
        mean_lead_months: 0,
        median_lead_months: 0,
        avg_flagged_per_month: 0,
        most_recent_headcount: 0,
      },
      by_market: [],
      active: { system: { active: 0, flagged: 0, quit: 0 }, by_market: [] },
    },
    provider_detail: [],
  },
})
