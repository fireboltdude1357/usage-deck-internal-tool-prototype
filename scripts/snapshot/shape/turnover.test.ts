import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { TurnoverSnapshot } from "$lib/schema/snapshot"
import {
  buildTurnoverSnapshot,
  monthAdd,
  monthDiff,
  roleCategory,
  marketKey,
  type EmployeeTimelineRow,
  type EmploymentMonthlyRow,
  type QuitProbHistoryRow,
  type TurnoverProviderRow,
} from "./turnover.js"

const ENV = {
  client: "bsmh" as const,
  month: "2026-04" as const,
  generated_at: "2026-05-17T00:00:00Z",
}

// Helpers for building rows fluently.
const emp = (
  month: string,
  group_id: string,
  level_2_name: string,
  role: "apc" | "physician" | "other",
  headcount: number,
): EmploymentMonthlyRow => ({
  partition_date: `${month}-01`,
  group_id,
  level_2_name,
  level_3_name: "",
  role_category: role,
  headcount: headcount.toString(),
})

const quitter = (
  employee_id: string,
  quit_month: string,
  job_role_name: string,
  level_2_name: string,
): EmployeeTimelineRow => ({
  employee_id,
  quit_date: `${quit_month}-15`,
  dob: "1980-01-01",
  group_id: "g1",
  job_role_name,
  level_2_name,
  level_3_name: "",
})

const qp = (
  employee_id: string,
  partition_month: string,
  quit_prob: number,
  job_role_name = "Hospitalist",
): QuitProbHistoryRow => ({
  partition_date: `${partition_month}-01`,
  employee_id,
  provider_id: `pv-${employee_id}`,
  quit_prob: quit_prob.toString(),
  group_id: "g1",
  job_role_name,
})

const provInfo = (
  employee_id: string,
  over: Partial<TurnoverProviderRow> = {},
): TurnoverProviderRow => ({
  employee_id,
  provider_id: `pv-${employee_id}`,
  provider_name: `Dr ${employee_id}`,
  specialty: "Internal Medicine",
  job_role_name: "Hospitalist",
  level_2_name: "6177", // Youngstown
  level_3_name: "",
  ...over,
})

describe("roleCategory", () => {
  it("classifies APC titles", () => {
    expect(roleCategory("Nurse Practitioner (Exempt)")).toBe("apc")
    expect(roleCategory("Physician Assistant")).toBe("apc")
    expect(roleCategory("CRNA (PRIME Exempt)")).toBe("apc")
    expect(roleCategory("Nurse Midwife (Exempt)")).toBe("apc")
    expect(roleCategory("APRN")).toBe("apc")
  })
  it("classifies physicians as default", () => {
    expect(roleCategory("Hospitalist")).toBe("physician")
    expect(roleCategory("Family Medicine (Exempt)")).toBe("physician")
    expect(roleCategory("Neuroscientist")).toBe("physician")
    expect(roleCategory("")).toBe("physician")
  })
  it("classifies residents/fellows as other (takes precedence over PA/NP markers)", () => {
    expect(roleCategory("Resident")).toBe("other")
    expect(roleCategory("Fellow")).toBe("other")
    expect(roleCategory("Resident, NP track")).toBe("other")
  })
})

describe("marketKey", () => {
  it("uses level_2_name for bsmh", () => {
    expect(marketKey("bsmh", "6177", "ignored")).toBe("6177")
  })
  it("uses level_3_name for ssm", () => {
    expect(marketKey("ssm", "ignored", "SSM Health Wisconsin")).toBe("SSM Health Wisconsin")
  })
  it("returns empty for duke/ucsf", () => {
    expect(marketKey("duke", "x", "y")).toBe("")
    expect(marketKey("ucsf", "x", "y")).toBe("")
  })
})

describe("monthAdd / monthDiff", () => {
  it("monthAdd handles year rollover both ways", () => {
    expect(monthAdd("2025-11", 3)).toBe("2026-02")
    expect(monthAdd("2026-02", -4)).toBe("2025-10")
  })
  it("monthDiff returns whole-month deltas", () => {
    expect(monthDiff("2026-04", "2025-04")).toBe(12)
    expect(monthDiff("2026-04", "2026-04")).toBe(0)
    expect(monthDiff("2026-04", "2026-06")).toBe(-2)
  })
})

describe("buildTurnoverSnapshot", () => {
  // 13-month employment series for two groups in Youngstown (BU 6177), one
  // group in Lorain (BU 6010), 100 physicians + 20 APCs constant. Plus 12
  // quits in the trailing 12 months for physicians, 0 for APCs.
  const buildMinimalInputs = () => {
    const months = Array.from({ length: 13 }, (_, i) => monthAdd("2025-04", i))
    const employmentMonthly: EmploymentMonthlyRow[] = []
    for (const m of months) {
      // 100 physicians in Youngstown (across two groups), 20 APCs.
      employmentMonthly.push(emp(m, "g-y1", "6177", "physician", 60))
      employmentMonthly.push(emp(m, "g-y2", "6177", "physician", 40))
      employmentMonthly.push(emp(m, "g-y1", "6177", "apc", 20))
      // 50 physicians in Lorain.
      employmentMonthly.push(emp(m, "g-l", "6010", "physician", 50))
    }
    // 12 physician quitters spread across 12 trailing months (Youngstown).
    // The 13th month (2025-04) has no quits — gives us a clean trailing-12.
    const employeeTimelines: EmployeeTimelineRow[] = []
    for (let i = 0; i < 12; i++) {
      const m = monthAdd("2025-05", i)
      employeeTimelines.push(quitter(`e-${i}`, m, "Hospitalist", "6177"))
    }
    return { employmentMonthly, employeeTimelines }
  }

  it("envelope validates against TurnoverSnapshot schema", () => {
    const { employmentMonthly, employeeTimelines } = buildMinimalInputs()
    const snap = buildTurnoverSnapshot(
      { employmentMonthly, employeeTimelines, quitProbHistory: [], providerDetail: [] },
      ENV,
    )
    expect(() => Schema.decodeUnknownSync(TurnoverSnapshot)(snap)).not.toThrow()
  })

  it("computes rolling-12 turnover = quits / avg(headcount)", () => {
    const { employmentMonthly, employeeTimelines } = buildMinimalInputs()
    const snap = buildTurnoverSnapshot(
      { employmentMonthly, employeeTimelines, quitProbHistory: [], providerDetail: [] },
      ENV,
    )
    // System physician at 2026-04: 12 quits in trailing 12, avg headcount = 150.
    const point = snap.metrics.monthly.find(
      (p) => p.month === "2026-04" && p.scope === "system" && p.category === "physician",
    )!
    expect(point.headcount).toBe(150)
    expect(point.quits).toBe(1) // April quit
    expect(point.rolling_12_turnover).toBeCloseTo(12 / 150, 4)

    // System "all" (apc+physician) at 2026-04: headcount 170, quits 12 (apc=0).
    const all = snap.metrics.monthly.find(
      (p) => p.month === "2026-04" && p.scope === "system" && p.category === "all",
    )!
    expect(all.headcount).toBe(170)
    expect(all.rolling_12_turnover).toBeCloseTo(12 / 170, 4)
  })

  it("rolls up to markets via BU mapping (Youngstown vs Lorain)", () => {
    const { employmentMonthly, employeeTimelines } = buildMinimalInputs()
    const snap = buildTurnoverSnapshot(
      { employmentMonthly, employeeTimelines, quitProbHistory: [], providerDetail: [] },
      ENV,
    )
    const ystown = snap.metrics.monthly.find(
      (p) => p.month === "2026-04" && p.scope === "Youngstown" && p.category === "physician",
    )!
    expect(ystown.headcount).toBe(100)
    expect(ystown.rolling_12_turnover).toBeCloseTo(12 / 100, 4)

    // Lorain has 50 physicians, 0 quits.
    const lorain = snap.metrics.monthly.find(
      (p) => p.month === "2026-04" && p.scope === "Lorain" && p.category === "physician",
    )!
    expect(lorain.headcount).toBe(50)
    expect(lorain.quits).toBe(0)
    expect(lorain.rolling_12_turnover).toBe(0)
  })

  it("forecast_origin = latest employment-monthly partition", () => {
    const { employmentMonthly, employeeTimelines } = buildMinimalInputs()
    const snap = buildTurnoverSnapshot(
      { employmentMonthly, employeeTimelines, quitProbHistory: [], providerDetail: [] },
      ENV,
    )
    expect(snap.metrics.forecast_origin).toBe("2026-04")
  })

  it("emits 6 projection months past forecast_origin with is_projection=true", () => {
    const { employmentMonthly, employeeTimelines } = buildMinimalInputs()
    // One quit-prob run for physicians at avg 0.01 (annual ~12%).
    const quitProbHistory: QuitProbHistoryRow[] = []
    for (let i = 0; i < 100; i++) {
      quitProbHistory.push(qp(`e-${i}`, "2026-04", 0.01, "Hospitalist"))
    }
    const snap = buildTurnoverSnapshot(
      { employmentMonthly, employeeTimelines, quitProbHistory, providerDetail: [] },
      ENV,
    )
    const projections = snap.metrics.monthly.filter(
      (p) =>
        p.is_projection &&
        p.scope === "system" &&
        p.category === "physician",
    )
    expect(projections.map((p) => p.month)).toEqual([
      "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ])
    // expected_quits = avg(0.01) * 150 headcount = 1.5
    expect(projections[0].expected_quits).toBeCloseTo(1.5, 4)
    expect(projections[0].quits).toBeNull()
    expect(projections[0].headcount).toBe(150) // held constant
  })

  it("flags quitters via top-20th-percentile cutoff per snapshot", () => {
    const { employmentMonthly, employeeTimelines } = buildMinimalInputs()
    // Build a quit-prob history where each of the 12 quitters has a HIGH
    // quit_prob in a partition 3 months before their quit_date, and a noise
    // cohort of 99 OTHER employees with quit_prob = 0.001.
    const quitProbHistory: QuitProbHistoryRow[] = []
    const months = Array.from({ length: 13 }, (_, i) => monthAdd("2025-04", i))
    for (const m of months) {
      // 99 noise providers — well below cutoff.
      for (let i = 0; i < 99; i++) {
        quitProbHistory.push(qp(`noise-${i}`, m, 0.001))
      }
    }
    // For each quitter, plant a flag 3 months before their quit month.
    for (let i = 0; i < 12; i++) {
      const quitMonth = monthAdd("2025-05", i)
      const flagMonth = monthAdd(quitMonth, -3)
      quitProbHistory.push(qp(`e-${i}`, flagMonth, 0.9))
    }
    const snap = buildTurnoverSnapshot(
      { employmentMonthly, employeeTimelines, quitProbHistory, providerDetail: [] },
      ENV,
    )
    // System block: all 12 quitters flagged, all with 3-month lead.
    const sys = snap.metrics.flagging.system
    expect(sys.n_quitters).toBe(12)
    expect(sys.n_flagged).toBe(12)
    expect(sys.flag_rate).toBe(1)
    expect(sys.median_lead_months).toBe(3)
    expect(sys.mean_lead_months).toBe(3)
  })

  it("provider_detail carries name/specialty/market from provider-detail.csv", () => {
    const { employmentMonthly, employeeTimelines } = buildMinimalInputs()
    const providerDetail: TurnoverProviderRow[] = []
    for (let i = 0; i < 12; i++) {
      providerDetail.push(
        provInfo(`e-${i}`, {
          provider_name: `Dr Quitter ${i}`,
          specialty: "Hospitalist",
          level_2_name: "6177", // Youngstown
        }),
      )
    }
    const snap = buildTurnoverSnapshot(
      { employmentMonthly, employeeTimelines, quitProbHistory: [], providerDetail },
      ENV,
    )
    expect(snap.metrics.provider_detail).toHaveLength(12)
    const first = snap.metrics.provider_detail[0]
    expect(first.market).toBe("Youngstown")
    expect(first.category).toBe("Physician")
    expect(first.name).toMatch(/^Dr Quitter \d+$/)
    expect(first.flag_date).toBeNull() // no quit-prob data → never flagged
  })

  it("clients without a BU mapping (Duke) collapse to system scope only", () => {
    const { employmentMonthly, employeeTimelines } = buildMinimalInputs()
    const snap = buildTurnoverSnapshot(
      { employmentMonthly, employeeTimelines, quitProbHistory: [], providerDetail: [] },
      { ...ENV, client: "duke" },
    )
    const scopes = new Set(snap.metrics.monthly.map((p) => p.scope))
    expect(scopes).toEqual(new Set(["system"]))
  })

  it("excludes residents/fellows from rate denominators", () => {
    const { employmentMonthly, employeeTimelines } = buildMinimalInputs()
    // Add a resident row that should NOT count toward physician headcount.
    employmentMonthly.push(emp("2026-04", "g-y1", "6177", "other", 999))
    // And a fellow quitter that should NOT count toward quits.
    employeeTimelines.push(quitter("e-resident", "2026-04", "Resident", "6177"))
    const snap = buildTurnoverSnapshot(
      { employmentMonthly, employeeTimelines, quitProbHistory: [], providerDetail: [] },
      ENV,
    )
    const physApril = snap.metrics.monthly.find(
      (p) => p.month === "2026-04" && p.scope === "system" && p.category === "physician",
    )!
    expect(physApril.headcount).toBe(150) // unchanged by the +999 resident
    // Quitter count stayed at 12 (the resident is excluded).
    expect(snap.metrics.flagging.system.n_quitters).toBe(12)
  })
})
