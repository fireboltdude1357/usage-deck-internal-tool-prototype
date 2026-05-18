import type {
  Month,
  TurnoverMonthlyPoint,
  TurnoverScope,
  TurnoverCategory,
} from "$lib/schema/snapshot"

// Number of projection months to surface past the user-picked `end`. The
// producer extrapolates 6 months past `forecast_origin`; we render the same
// horizon by default so the dashed "projected ★" segment is always visible.
export const PROJECTION_HORIZON_MONTHS = 6

export type TurnoverChartPoint = {
  month: Month
  value: number
  is_projection: boolean
}

// Add `n` months to a YYYY-MM string. Negative `n` subtracts. Pure arithmetic
// so it works for any month (no JS Date timezone quirks).
export const addMonths = (month: Month, n: number): Month => {
  const [y, m] = month.split("-").map(Number)
  const idx = y * 12 + (m - 1) + n
  const yy = Math.floor(idx / 12)
  const mm = (idx % 12) + 1
  return `${yy}-${String(mm).padStart(2, "0")}`
}

// Quarter label for a month, e.g. "2026-03" → "Q1 2026", "2026-04" → "Q2 2026".
export const quarterLabel = (month: Month): string => {
  const [y, m] = month.split("-").map(Number)
  const q = Math.floor((m - 1) / 3) + 1
  return `Q${q} ${y}`
}

// 0.0826 → "8.26%". `decimals` controls precision; default 2.
export const formatPercent = (value: number, decimals = 2): string =>
  `${(value * 100).toFixed(decimals)}%`

// 10.4 → "10.4 months" / 1 → "1 month". Rounds to 1 decimal.
export const formatLeadMonths = (value: number): string => {
  const rounded = Math.round(value * 10) / 10
  return `${rounded} ${rounded === 1 ? "month" : "months"}`
}

// "n=144" style annotation.
export const formatN = (n: number): string => `n=${n.toLocaleString()}`

// Trim the per-month rows to actuals in [start, end] plus projection rows in
// (end, end+horizon]. Projection rows past the picker `end` are always
// included so the user sees the producer's forward extrapolation.
export const trimMonthly = (
  rows: readonly TurnoverMonthlyPoint[],
  start: Month,
  end: Month,
  horizonMonths: number = PROJECTION_HORIZON_MONTHS,
): TurnoverMonthlyPoint[] => {
  const horizonEnd = addMonths(end, horizonMonths)
  return rows.filter((r) => {
    if (r.is_projection) return r.month > end && r.month <= horizonEnd
    return r.month >= start && r.month <= end
  })
}

// Group rows by (scope, category) and project to chart points using the given
// numeric field. Caller can choose `rolling_12_turnover` (the QBR's headline),
// `headcount`, or `expected_quits`. Output is sorted by month.
export const seriesFor = (
  rows: readonly TurnoverMonthlyPoint[],
  scope: TurnoverScope,
  category: TurnoverCategory,
  field: "rolling_12_turnover" | "headcount" | "expected_quits" = "rolling_12_turnover",
): TurnoverChartPoint[] =>
  rows
    .filter((r) => r.scope === scope && r.category === category)
    .map((r) => ({
      month: r.month,
      value: (r[field] as number | null) ?? 0,
      is_projection: r.is_projection,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

// Latest non-projection rolling-12 value for a given (scope, category) — the
// number that drives the §1 KPI tile. Returns null if the scope/category isn't
// present at all (e.g. a market with no rows).
export const latestActualRate = (
  rows: readonly TurnoverMonthlyPoint[],
  scope: TurnoverScope,
  category: TurnoverCategory,
): number | null => {
  const actuals = rows
    .filter((r) => r.scope === scope && r.category === category && !r.is_projection)
    .sort((a, b) => b.month.localeCompare(a.month))
  return actuals[0]?.rolling_12_turnover ?? null
}

// Year-over-year delta on rolling-12 turnover (latest actual minus value 12
// months prior). Null if either side is missing.
export const yoyDelta = (
  rows: readonly TurnoverMonthlyPoint[],
  scope: TurnoverScope,
  category: TurnoverCategory,
): number | null => {
  const actuals = rows
    .filter((r) => r.scope === scope && r.category === category && !r.is_projection)
    .sort((a, b) => a.month.localeCompare(b.month))
  if (actuals.length === 0) return null
  const last = actuals[actuals.length - 1]
  const prior = actuals.find((r) => r.month === addMonths(last.month, -12))
  if (!prior) return null
  return last.rolling_12_turnover - prior.rolling_12_turnover
}
