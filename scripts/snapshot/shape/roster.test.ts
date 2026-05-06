import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  MarketSnapshot,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
} from "$lib/schema/snapshot"
import {
  buildMarketSnapshot,
  buildPlatformSnapshot,
  buildProvisionedSnapshot,
  rosterToMarketCounts,
  type RosterRow,
} from "./roster.js"

const row = (overrides: Partial<RosterRow> = {}): RosterRow => ({
  provider_id: "p1",
  quit_prob: "0.10",
  run_date: "2026-04-01",
  businessunitname: "1412", // Hampton Roads
  department: "Cardiology",
  specialty: "MD",
  provider_name: "Doe, Jane",
  ...overrides,
})

const ENV = {
  client: "bsmh" as const,
  month: "2026-04" as const,
  generated_at: "2026-05-06T12:00:00Z",
}

describe("rosterToMarketCounts", () => {
  it("groups by businessunitname → market and sorts desc", () => {
    const rows = [
      row({ businessunitname: "1412" }), // Hampton Roads
      row({ businessunitname: "1430" }), // Hampton Roads
      row({ businessunitname: "6010" }), // Lorain
      row({ businessunitname: "6077" }), // Lima
      row({ businessunitname: "6077" }), // Lima
      row({ businessunitname: "6077" }), // Lima
    ]
    expect(rosterToMarketCounts(rows)).toEqual([
      { market: "Lima", value: 3 },
      { market: "Hampton Roads", value: 2 },
      { market: "Lorain", value: 1 },
    ])
  })

  it("drops unmapped BU codes (non-BSMH inputs)", () => {
    const rows = [row({ businessunitname: "9999" }), row({ businessunitname: "" })]
    expect(rosterToMarketCounts(rows)).toEqual([])
  })
})

describe("envelope builders", () => {
  const rows = [
    row({ businessunitname: "6077" }), // Lima
    row({ businessunitname: "6410" }), // Lima
    row({ businessunitname: "1412" }), // Hampton Roads
  ]

  it("buildMarketSnapshot validates against MarketSnapshot Schema", () => {
    const snap = buildMarketSnapshot(rows, ENV)
    expect(() => Schema.decodeUnknownSync(MarketSnapshot)(snap)).not.toThrow()
    expect(snap.metrics.clinicians_by_market).toEqual([
      { market: "Lima", value: 2 },
      { market: "Hampton Roads", value: 1 },
    ])
    expect(snap.metrics.provider_views_by_market).toEqual([])
  })

  it("buildProvisionedSnapshot validates and counts Lima", () => {
    const snap = buildProvisionedSnapshot(rows, ENV)
    expect(() => Schema.decodeUnknownSync(ProvisionedUsersSnapshot)(snap)).not.toThrow()
    expect(snap.metrics.total.value).toBe(3)
    expect(snap.metrics.lima.value).toBe(2)
    expect(snap.metrics.user_detail).toEqual([])
  })

  it("buildPlatformSnapshot validates with the roster-size KPI", () => {
    const snap = buildPlatformSnapshot(rows, ENV)
    expect(() => Schema.decodeUnknownSync(PlatformSnapshot)(snap)).not.toThrow()
    expect(snap.metrics.kpis).toEqual([
      { label: "Clinicians monitored", value: 3, unit: "count" },
    ])
    expect(snap.metrics.provider_views_by_month).toEqual([])
  })
})
