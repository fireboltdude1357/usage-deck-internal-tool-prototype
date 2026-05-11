import type {
  Month,
  SuccessStoryImprovement,
  SuccessStoryProvider,
  SuccessStoryProviderMonth,
} from "$lib/schema/snapshot"

// One pre/post comparison for a single metric. `pct` is the fractional change
// (post - pre) / pre — null when pre is 0 or either side is missing. `improved`
// is direction-aware: lower-is-better for turnover/efficiency, higher-is-better
// for volume/RVUs/time-with-patients.
export type Metric = {
  pre: number | null
  post: number | null
  pct: number | null
  improved: boolean
}

// What the ProviderCard renders. Mirrors the old SuccessStoryProvider shape but
// is now derived live from the per-month series + the user-selected window.
export type ProviderDerived = {
  provider_id: string
  name: string
  specialty: string
  category: string
  department: string
  market: string | null
  n_improvements: number
  improvements: readonly SuccessStoryImprovement[]
  turnover: Metric
  procedures: Metric
  rvu: Metric
  enc_duration: Metric
  doc_time: Metric
  admin_time: Metric
  volume_improved: boolean
  efficiency_improved: boolean
}

export type WindowSplit = {
  pre: readonly Month[]
  post: readonly Month[]
}

const monthRange = (start: Month, end: Month, all: readonly Month[]): Month[] =>
  all.filter((m) => m >= start && m <= end)

// Split a (start, end) range into pre/post halves. Floor for pre, ceil for
// post so post is the longer side on odd counts — matches the iter-12 instinct
// that the "after" period gets the benefit of more data. Returns empty pre/post
// when the range is too short (N < 2).
export const splitWindow = (
  start: Month,
  end: Month,
  available: readonly Month[],
): WindowSplit => {
  const months = monthRange(start, end, available)
  if (months.length < 2) return { pre: [], post: [] }
  const half = Math.floor(months.length / 2)
  return { pre: months.slice(0, half), post: months.slice(half) }
}

const avg = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length

const pctChange = (pre: number | null, post: number | null): number | null => {
  if (pre === null || post === null || pre === 0) return null
  return (post - pre) / pre
}

const pickValues = (
  series: readonly SuccessStoryProviderMonth[],
  months: readonly Month[],
  key: keyof Omit<SuccessStoryProviderMonth, "month">,
): number[] => {
  const set = new Set(months)
  const out: number[] = []
  for (const row of series) {
    if (!set.has(row.month)) continue
    const v = row[key]
    if (v !== null) out.push(v)
  }
  return out
}

const buildMetric = (
  series: readonly SuccessStoryProviderMonth[],
  pre: readonly Month[],
  post: readonly Month[],
  key: keyof Omit<SuccessStoryProviderMonth, "month">,
  lowerIsBetter: boolean,
): Metric => {
  const preAvg = avg(pickValues(series, pre, key))
  const postAvg = avg(pickValues(series, post, key))
  const pct = pctChange(preAvg, postAvg)
  const improved = pct === null ? false : lowerIsBetter ? pct < 0 : pct > 0
  return { pre: preAvg, post: postAvg, pct, improved }
}

export type DeriveOptions = {
  minPreProcedures: number
  marketFilter: string | null // null = no filter ("all")
}

const deriveProvider = (
  p: SuccessStoryProvider,
  pre: readonly Month[],
  post: readonly Month[],
  minPreProcedures: number,
): ProviderDerived | null => {
  const turnover = buildMetric(p.monthly, pre, post, "quit_prob", true)
  // Quit-prob trajectory is the "must have both sides" gate — if either side
  // is missing, we can't tell a success story.
  if (turnover.pre === null || turnover.post === null) return null

  const procedures = buildMetric(p.monthly, pre, post, "procedures", false)
  // Volume gate: drop providers with too-low pre-window procedure average.
  if (procedures.pre !== null && procedures.pre < minPreProcedures) return null

  const rvu = buildMetric(p.monthly, pre, post, "work_rvu", false)
  const encounters = buildMetric(p.monthly, pre, post, "encounters", false)
  const encDuration = buildMetric(p.monthly, pre, post, "enc_duration", false)
  const docTime = buildMetric(p.monthly, pre, post, "doc_time", true)
  const adminTime = buildMetric(p.monthly, pre, post, "admin_time", true)

  const volume_improved = procedures.improved || encounters.improved
  const efficiency_improved = docTime.improved || adminTime.improved

  const improvements: SuccessStoryImprovement[] = []
  if (turnover.improved) improvements.push("turnover")
  if (volume_improved) improvements.push("volume")
  if (encDuration.improved) improvements.push("time_with_patients")
  if (efficiency_improved) improvements.push("efficiency")
  if (rvu.improved) improvements.push("rvu")

  return {
    provider_id: p.provider_id,
    name: p.name,
    specialty: p.specialty,
    category: p.category,
    department: p.department,
    market: p.market,
    n_improvements: improvements.length,
    improvements,
    turnover,
    procedures,
    rvu,
    enc_duration: encDuration,
    doc_time: docTime,
    admin_time: adminTime,
    volume_improved,
    efficiency_improved,
  }
}

export const deriveProviders = (
  providers: readonly SuccessStoryProvider[],
  pre: readonly Month[],
  post: readonly Month[],
  opts: DeriveOptions,
): readonly ProviderDerived[] => {
  if (pre.length === 0 || post.length === 0) return []
  const out: ProviderDerived[] = []
  for (const p of providers) {
    if (opts.marketFilter !== null && p.market !== opts.marketFilter) continue
    const derived = deriveProvider(p, pre, post, opts.minPreProcedures)
    if (derived) out.push(derived)
  }
  // Sort: more improvements first, then biggest turnover drop first.
  out.sort((a, b) => {
    if (b.n_improvements !== a.n_improvements) return b.n_improvements - a.n_improvements
    return (a.turnover.pct ?? 0) - (b.turnover.pct ?? 0)
  })
  return out
}
