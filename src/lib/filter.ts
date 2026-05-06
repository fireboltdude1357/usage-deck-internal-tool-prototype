import type { MonthPoint, Series, UserRow } from "$lib/schema/snapshot"
import type { MarketParam } from "$lib/selection.svelte"

// Months are zero-padded YYYY-MM strings, so lexicographic compare is correct.
export const filterSeries = (
  series: Series,
  range: { start: string; end: string },
): MonthPoint[] => series.filter((p) => p.month >= range.start && p.month <= range.end)

export const filterByMarket = <T extends { market?: string }>(
  rows: readonly T[],
  market: MarketParam,
): T[] => {
  if (market === "all") return [...rows]
  return rows.filter((r) => r.market === market)
}
