import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { SuccessStoriesSnapshot } from "$lib/schema/snapshot"
import { deriveProviders, splitWindow } from "$lib/success-stories"
import {
  buildSuccessStoriesSnapshot,
  type ClaimsMonthlyRow,
  type EhrMonthlyRow,
  type EncountersMonthlyRow,
  type ProviderMetadataRow,
  type QuitProbRow,
} from "./success-stories.js"
import type { RosterRow } from "./roster.js"

const ENV = {
  client: "bsmh" as const,
  month: "2026-04" as const,
  generated_at: "2026-05-06T12:00:00Z",
}

const meta = (over: Partial<ProviderMetadataRow> = {}): ProviderMetadataRow => ({
  provider_id: "p-improver",
  provider_name: "Test Provider",
  specialty: "internal",
  category: "physician",
  department: "1430 : Internal Medicine",
  quit_prob: "0.05",
  run_date: "2026-02-01",
  model_ds: "2026-02-01",
  ...over,
})

const rosterRow = (over: Partial<RosterRow> = {}): RosterRow => ({
  provider_id: "p-improver",
  quit_prob: "0.05",
  run_date: "2026-02-01",
  businessunitname: "1430", // BSMH BU code → Hampton Roads
  department: "1430 : Internal Medicine",
  specialty: "internal",
  provider_name: "Test Provider",
  ...over,
})

const trajRow = (pid: string, date: string, q: number): QuitProbRow => ({
  provider_id: pid,
  run_date: date,
  quit_prob: q.toString(),
})

const claimsRow = (
  pid: string,
  batchDs: string,
  procedures: number,
  workRvu: number,
): ClaimsMonthlyRow => ({
  provider_id: pid,
  batch_ds: batchDs,
  procedures: procedures.toString(),
  work_rvu: workRvu.toString(),
})

const encsRow = (
  pid: string,
  batchDs: string,
  encounters: number,
  encDuration: number,
): EncountersMonthlyRow => ({
  provider_id: pid,
  batch_ds: batchDs,
  encounters: encounters.toString(),
  enc_duration: encDuration.toString(),
})

const ehrRow = (
  pid: string,
  batchDs: string,
  docTime: number,
  adminTime: number,
): EhrMonthlyRow => ({
  provider_id: pid,
  batch_ds: batchDs,
  doc_time: docTime.toString(),
  admin_time: adminTime.toString(),
})

// 5-month series — pre = Aug+Sep, post = Dec+Jan+Feb — with consistent
// "improving" values for one provider across all 5 metrics.
const improverInputs = (pid: string) => {
  const months = ["2025-08-01", "2025-09-01", "2025-12-01", "2026-01-01", "2026-02-01"]
  const isPre = (m: string) => m === "2025-08-01" || m === "2025-09-01"
  return {
    traj: months.map((m) => trajRow(pid, m, isPre(m) ? 0.05 : 0.025)),
    claims: months.map((m) =>
      claimsRow(pid, m, isPre(m) ? 100 : 120, isPre(m) ? 200 : 240),
    ),
    encs: months.map((m) =>
      encsRow(pid, m, isPre(m) ? 300 : 350, isPre(m) ? 20 : 25),
    ),
    ehr: months.map((m) =>
      ehrRow(pid, m, isPre(m) ? 5000 : 4000, isPre(m) ? 500 : 450),
    ),
  }
}

describe("buildSuccessStoriesSnapshot", () => {
  it("emits a per-provider monthly series", () => {
    const inp = improverInputs("p-improver")
    const snap = buildSuccessStoriesSnapshot(
      {
        roster: [rosterRow()],
        metadata: [meta()],
        quitProb: inp.traj,
        claims: inp.claims,
        encounters: inp.encs,
        ehr: inp.ehr,
      },
      ENV,
    )
    expect(snap.metrics.providers).toHaveLength(1)
    const p = snap.metrics.providers[0]
    expect(p.market).toBe("Hampton Roads")
    expect(p.monthly.map((m) => m.month)).toEqual([
      "2025-08", "2025-09", "2025-12", "2026-01", "2026-02",
    ])
    // Spot-check one month carries all metrics merged from the four inputs.
    const aug = p.monthly.find((m) => m.month === "2025-08")!
    expect(aug.procedures).toBe(100)
    expect(aug.work_rvu).toBe(200)
    expect(aug.encounters).toBe(300)
    expect(aug.enc_duration).toBe(20)
    expect(aug.doc_time).toBe(5000)
    expect(aug.admin_time).toBe(500)
    expect(aug.quit_prob).toBeCloseTo(0.05)
  })

  it("emits available_months across all providers, sorted", () => {
    const a = improverInputs("p-a")
    const b = improverInputs("p-b")
    const snap = buildSuccessStoriesSnapshot(
      {
        roster: [rosterRow({ provider_id: "p-a" }), rosterRow({ provider_id: "p-b" })],
        metadata: [meta({ provider_id: "p-a" }), meta({ provider_id: "p-b" })],
        quitProb: [...a.traj, ...b.traj],
        claims: [...a.claims, ...b.claims],
        encounters: [...a.encs, ...b.encs],
        ehr: [...a.ehr, ...b.ehr],
      },
      ENV,
    )
    expect(snap.metrics.available_months).toEqual([
      "2025-08", "2025-09", "2025-12", "2026-01", "2026-02",
    ])
  })

  it("leaves market null for clients without a BU mapping (Duke)", () => {
    const inp = improverInputs("p-improver")
    const snap = buildSuccessStoriesSnapshot(
      {
        roster: [rosterRow({ businessunitname: "Anything" })],
        metadata: [meta()],
        quitProb: inp.traj,
        claims: inp.claims,
        encounters: inp.encs,
        ehr: inp.ehr,
      },
      { ...ENV, client: "duke" },
    )
    expect(snap.metrics.providers[0].market).toBe(null)
  })

  it("envelope validates against SuccessStoriesSnapshot schema", () => {
    const inp = improverInputs("p-improver")
    const snap = buildSuccessStoriesSnapshot(
      {
        roster: [rosterRow()],
        metadata: [meta()],
        quitProb: inp.traj,
        claims: inp.claims,
        encounters: inp.encs,
        ehr: inp.ehr,
      },
      ENV,
    )
    expect(() => Schema.decodeUnknownSync(SuccessStoriesSnapshot)(snap)).not.toThrow()
  })
})

describe("splitWindow", () => {
  const available = [
    "2025-08", "2025-09", "2025-10", "2025-11",
    "2025-12", "2026-01", "2026-02", "2026-03",
  ] as const

  it("splits 4 months into 2 pre + 2 post", () => {
    const { pre, post } = splitWindow("2025-08", "2025-11", available)
    expect(pre).toEqual(["2025-08", "2025-09"])
    expect(post).toEqual(["2025-10", "2025-11"])
  })

  it("gives post the longer half on odd counts", () => {
    const { pre, post } = splitWindow("2025-08", "2026-02", available) // 7 months
    expect(pre).toEqual(["2025-08", "2025-09", "2025-10"])
    expect(post).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"])
  })

  it("returns empty halves when the range is too small", () => {
    const { pre, post } = splitWindow("2025-08", "2025-08", available)
    expect(pre).toEqual([])
    expect(post).toEqual([])
  })
})

describe("deriveProviders", () => {
  // Build a single-provider monthly series from improverInputs above, then
  // round-trip it through the producer so the test exercises the real shape.
  const buildSnap = () => {
    const inp = improverInputs("p-improver")
    return buildSuccessStoriesSnapshot(
      {
        roster: [rosterRow()],
        metadata: [meta()],
        quitProb: inp.traj,
        claims: inp.claims,
        encounters: inp.encs,
        ehr: inp.ehr,
      },
      ENV,
    )
  }

  it("scores a provider who improved on all 5 categories", () => {
    const snap = buildSnap()
    const derived = deriveProviders(
      snap.metrics.providers,
      ["2025-08", "2025-09"],
      ["2025-12", "2026-01", "2026-02"],
      { minPreProcedures: 10, marketFilter: null },
    )
    expect(derived).toHaveLength(1)
    const p = derived[0]
    expect(p.n_improvements).toBe(5)
    expect([...p.improvements].sort()).toEqual(
      ["efficiency", "rvu", "time_with_patients", "turnover", "volume"].sort(),
    )
  })

  it("drops providers below the pre_procedures gate", () => {
    const inp = improverInputs("p-low")
    // override pre months to 5 procedures (below gate of 10)
    const claims = inp.claims.map((r) =>
      r.batch_ds === "2025-08-01" || r.batch_ds === "2025-09-01"
        ? { ...r, procedures: "5" }
        : r,
    )
    const snap = buildSuccessStoriesSnapshot(
      {
        roster: [rosterRow({ provider_id: "p-low" })],
        metadata: [meta({ provider_id: "p-low" })],
        quitProb: inp.traj,
        claims,
        encounters: inp.encs,
        ehr: inp.ehr,
      },
      ENV,
    )
    const derived = deriveProviders(
      snap.metrics.providers,
      ["2025-08", "2025-09"],
      ["2025-12", "2026-01", "2026-02"],
      { minPreProcedures: 10, marketFilter: null },
    )
    expect(derived).toHaveLength(0)
  })

  it("drops providers missing trajectory data on either side", () => {
    // Provider only has pre-window quit_prob — can't compute post.
    const inp = improverInputs("p-no-post")
    const trimmed = inp.traj.filter((r) => r.run_date === "2025-08-01" || r.run_date === "2025-09-01")
    const snap = buildSuccessStoriesSnapshot(
      {
        roster: [rosterRow({ provider_id: "p-no-post" })],
        metadata: [meta({ provider_id: "p-no-post" })],
        quitProb: trimmed,
        claims: inp.claims,
        encounters: inp.encs,
        ehr: inp.ehr,
      },
      ENV,
    )
    const derived = deriveProviders(
      snap.metrics.providers,
      ["2025-08", "2025-09"],
      ["2025-12", "2026-01", "2026-02"],
      { minPreProcedures: 10, marketFilter: null },
    )
    expect(derived).toHaveLength(0)
  })

  it("filters by market when requested", () => {
    const inpA = improverInputs("p-a")
    const inpB = improverInputs("p-b")
    const snap = buildSuccessStoriesSnapshot(
      {
        roster: [
          rosterRow({ provider_id: "p-a", businessunitname: "1430" }), // Hampton Roads
          rosterRow({ provider_id: "p-b", businessunitname: "6010" }), // Lorain
        ],
        metadata: [meta({ provider_id: "p-a" }), meta({ provider_id: "p-b" })],
        quitProb: [...inpA.traj, ...inpB.traj],
        claims: [...inpA.claims, ...inpB.claims],
        encounters: [...inpA.encs, ...inpB.encs],
        ehr: [...inpA.ehr, ...inpB.ehr],
      },
      ENV,
    )
    const derived = deriveProviders(
      snap.metrics.providers,
      ["2025-08", "2025-09"],
      ["2025-12", "2026-01", "2026-02"],
      { minPreProcedures: 10, marketFilter: "Hampton Roads" },
    )
    expect(derived.map((p) => p.provider_id)).toEqual(["p-a"])
  })

  it("sorts by n_improvements desc, then turnover.pct asc", () => {
    // p-5imp: full improver. p-3imp: improvements only on turnover/efficiency/rvu.
    const months = ["2025-08-01", "2025-09-01", "2025-12-01", "2026-01-01", "2026-02-01"]
    const isPre = (m: string) => m === "2025-08-01" || m === "2025-09-01"

    const five = {
      traj: months.map((m) => trajRow("p-5imp", m, isPre(m) ? 0.05 : 0.025)),
      claims: months.map((m) =>
        claimsRow("p-5imp", m, isPre(m) ? 100 : 120, isPre(m) ? 200 : 240),
      ),
      encs: months.map((m) => encsRow("p-5imp", m, isPre(m) ? 300 : 350, isPre(m) ? 20 : 25)),
      ehr: months.map((m) => ehrRow("p-5imp", m, isPre(m) ? 5000 : 4000, isPre(m) ? 500 : 450)),
    }
    // 3imp: flat procedures/encounters/enc_duration; improving turnover/efficiency/rvu only.
    const three = {
      traj: months.map((m) => trajRow("p-3imp", m, isPre(m) ? 0.05 : 0.04)),
      claims: months.map((m) =>
        claimsRow("p-3imp", m, isPre(m) ? 100 : 100, isPre(m) ? 200 : 220),
      ),
      encs: months.map((m) => encsRow("p-3imp", m, isPre(m) ? 300 : 300, isPre(m) ? 20 : 20)),
      ehr: months.map((m) => ehrRow("p-3imp", m, isPre(m) ? 5000 : 4500, isPre(m) ? 500 : 480)),
    }
    const snap = buildSuccessStoriesSnapshot(
      {
        roster: [rosterRow({ provider_id: "p-5imp" }), rosterRow({ provider_id: "p-3imp" })],
        metadata: [meta({ provider_id: "p-5imp" }), meta({ provider_id: "p-3imp" })],
        quitProb: [...five.traj, ...three.traj],
        claims: [...five.claims, ...three.claims],
        encounters: [...five.encs, ...three.encs],
        ehr: [...five.ehr, ...three.ehr],
      },
      ENV,
    )
    const derived = deriveProviders(
      snap.metrics.providers,
      ["2025-08", "2025-09"],
      ["2025-12", "2026-01", "2026-02"],
      { minPreProcedures: 10, marketFilter: null },
    )
    expect(derived.map((p) => p.provider_id)).toEqual(["p-5imp", "p-3imp"])
  })
})
