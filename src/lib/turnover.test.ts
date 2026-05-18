import { describe, expect, it } from "vitest"
import type { TurnoverMonthlyPoint } from "$lib/schema/snapshot"
import {
  addMonths,
  formatLeadMonths,
  formatN,
  formatPercent,
  latestActualRate,
  quarterLabel,
  seriesFor,
  trimMonthly,
  yoyDelta,
} from "./turnover"

const pt = (
  month: string,
  scope: string,
  category: "all" | "apc" | "physician",
  rolling12: number,
  isProjection = false,
): TurnoverMonthlyPoint => ({
  month,
  scope,
  category,
  headcount: 100,
  quits: isProjection ? null : 1,
  expected_quits: 1,
  rolling_12_turnover: rolling12,
  is_projection: isProjection,
})

describe("addMonths", () => {
  it("adds positive offsets across year boundary", () => {
    expect(addMonths("2026-10", 4)).toBe("2027-02")
  })
  it("subtracts negative offsets across year boundary", () => {
    expect(addMonths("2026-02", -3)).toBe("2025-11")
  })
  it("handles zero offset", () => {
    expect(addMonths("2025-06", 0)).toBe("2025-06")
  })
})

describe("quarterLabel", () => {
  it("maps each month to the right quarter", () => {
    expect(quarterLabel("2026-01")).toBe("Q1 2026")
    expect(quarterLabel("2026-03")).toBe("Q1 2026")
    expect(quarterLabel("2026-04")).toBe("Q2 2026")
    expect(quarterLabel("2026-09")).toBe("Q3 2026")
    expect(quarterLabel("2026-12")).toBe("Q4 2026")
  })
})

describe("formatPercent", () => {
  it("formats with default 2 decimals", () => {
    expect(formatPercent(0.0826)).toBe("8.26%")
  })
  it("respects decimal arg", () => {
    expect(formatPercent(0.0826, 1)).toBe("8.3%")
    expect(formatPercent(0.0826, 0)).toBe("8%")
  })
})

describe("formatLeadMonths", () => {
  it("singular for exactly one month", () => {
    expect(formatLeadMonths(1)).toBe("1 month")
  })
  it("plural otherwise", () => {
    expect(formatLeadMonths(10.4)).toBe("10.4 months")
    expect(formatLeadMonths(0)).toBe("0 months")
  })
})

describe("formatN", () => {
  it("adds n= prefix and groups thousands", () => {
    expect(formatN(1820)).toBe("n=1,820")
  })
})

describe("trimMonthly", () => {
  const rows: TurnoverMonthlyPoint[] = [
    pt("2025-10", "system", "all", 0.07),
    pt("2025-11", "system", "all", 0.07),
    pt("2025-12", "system", "all", 0.08),
    pt("2026-01", "system", "all", 0.08),
    pt("2026-02", "system", "all", 0.08, true),
    pt("2026-08", "system", "all", 0.09, true),
    pt("2026-09", "system", "all", 0.09, true),
  ]

  it("keeps actuals only within [start, end]", () => {
    const out = trimMonthly(rows, "2025-11", "2026-01", 6)
    const actuals = out.filter((r) => !r.is_projection).map((r) => r.month)
    expect(actuals).toEqual(["2025-11", "2025-12", "2026-01"])
  })

  it("includes projections strictly past end within horizon", () => {
    const out = trimMonthly(rows, "2025-11", "2026-01", 6)
    const projections = out.filter((r) => r.is_projection).map((r) => r.month)
    // horizon = 2026-07; 2026-02 included, 2026-08+ excluded
    expect(projections).toEqual(["2026-02"])
  })

  it("respects a longer horizon", () => {
    const out = trimMonthly(rows, "2025-11", "2026-01", 12)
    const projections = out.filter((r) => r.is_projection).map((r) => r.month)
    expect(projections).toEqual(["2026-02", "2026-08", "2026-09"])
  })
})

describe("seriesFor", () => {
  const rows: TurnoverMonthlyPoint[] = [
    pt("2026-01", "system", "all", 0.08),
    pt("2026-01", "system", "apc", 0.14),
    pt("2026-02", "system", "all", 0.082),
    pt("2025-12", "system", "all", 0.078),
    pt("2026-01", "Lorain", "all", 0.092),
  ]

  it("filters by scope+category and sorts by month", () => {
    const out = seriesFor(rows, "system", "all")
    expect(out.map((r) => r.month)).toEqual(["2025-12", "2026-01", "2026-02"])
    expect(out.map((r) => r.value)).toEqual([0.078, 0.08, 0.082])
  })

  it("returns empty for a missing combination", () => {
    expect(seriesFor(rows, "Lorain", "apc")).toEqual([])
  })

  it("can project a different field", () => {
    const out = seriesFor(rows, "system", "all", "headcount")
    expect(out.every((r) => r.value === 100)).toBe(true)
  })
})

describe("latestActualRate", () => {
  it("returns the most-recent non-projection value", () => {
    const rows = [
      pt("2026-01", "system", "all", 0.08),
      pt("2026-02", "system", "all", 0.085),
      pt("2026-03", "system", "all", 0.09, true),
    ]
    expect(latestActualRate(rows, "system", "all")).toBe(0.085)
  })

  it("returns null when no actuals exist", () => {
    const rows = [pt("2026-03", "system", "all", 0.09, true)]
    expect(latestActualRate(rows, "system", "all")).toBe(null)
  })
})

describe("yoyDelta", () => {
  it("computes latest minus value 12 months prior", () => {
    const rows: TurnoverMonthlyPoint[] = [
      pt("2025-02", "system", "all", 0.07),
      pt("2026-02", "system", "all", 0.085),
    ]
    expect(yoyDelta(rows, "system", "all")).toBeCloseTo(0.015, 5)
  })

  it("returns null without a 12-month-prior actual", () => {
    const rows = [pt("2026-02", "system", "all", 0.085)]
    expect(yoyDelta(rows, "system", "all")).toBe(null)
  })
})
