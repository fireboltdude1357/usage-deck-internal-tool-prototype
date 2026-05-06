import { describe, expect, it } from "vitest"
import { filterByMarket, filterSeries } from "./filter.js"
import type { Series, UserRow } from "$lib/schema/snapshot"

describe("filterSeries", () => {
  const series: Series = [
    { month: "2025-08", value: 9 },
    { month: "2025-09", value: 11 },
    { month: "2025-10", value: 14 },
    { month: "2025-11", value: 4 },
    { month: "2026-02", value: 8 },
  ]

  it("includes endpoints", () => {
    expect(filterSeries(series, { start: "2025-08", end: "2025-10" })).toEqual([
      { month: "2025-08", value: 9 },
      { month: "2025-09", value: 11 },
      { month: "2025-10", value: 14 },
    ])
  })

  it("returns empty when range is before any data", () => {
    expect(filterSeries(series, { start: "2024-01", end: "2024-12" })).toEqual([])
  })

  it("handles single-month range", () => {
    expect(filterSeries(series, { start: "2025-09", end: "2025-09" })).toEqual([
      { month: "2025-09", value: 11 },
    ])
  })
})

describe("filterByMarket", () => {
  const rows: UserRow[] = [
    {
      email: "a@x",
      market: "Lima",
      page_loads: 1,
      active_days: 1,
      first_seen: "2025-08-01",
      last_seen: "2025-08-01",
    },
    {
      email: "b@x",
      market: "Toledo",
      page_loads: 2,
      active_days: 2,
      first_seen: "2025-08-02",
      last_seen: "2025-08-02",
    },
    {
      email: "c@x",
      page_loads: 3,
      active_days: 3,
      first_seen: "2025-08-03",
      last_seen: "2025-08-03",
    },
  ]

  it("returns a copy of all rows when market is 'all'", () => {
    const result = filterByMarket(rows, "all")
    expect(result).toHaveLength(3)
    expect(result).not.toBe(rows)
  })

  it("filters by exact market match", () => {
    const result = filterByMarket(rows, "Lima")
    expect(result).toHaveLength(1)
    expect(result[0].email).toBe("a@x")
  })

  it("excludes rows with no market when filtering", () => {
    const result = filterByMarket(rows, "Toledo")
    expect(result).toHaveLength(1)
    expect(result[0].email).toBe("b@x")
  })
})
