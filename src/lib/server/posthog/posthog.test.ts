import { describe, expect, it } from "vitest"
import { monthBoundaries, rowsToObjects } from "./pagination"
import {
  providerViewEventsQuery,
  unitViewEventsQuery,
  monthlyUserActivityQuery,
} from "./queries"
import {
  buildPlatformSnapshot,
  type ProviderEvent,
  type UnitEvent,
  type MonthlyActivity,
} from "./aggregator"

describe("monthBoundaries", () => {
  it("expands a single month", () => {
    expect(monthBoundaries("2025-08", "2025-08")).toEqual([
      { from: "2025-08-01", to: "2025-09-01" },
    ])
  })

  it("expands a multi-month range, exclusive `to`", () => {
    expect(monthBoundaries("2025-08", "2025-10")).toEqual([
      { from: "2025-08-01", to: "2025-09-01" },
      { from: "2025-09-01", to: "2025-10-01" },
      { from: "2025-10-01", to: "2025-11-01" },
    ])
  })

  it("crosses year boundary", () => {
    const result = monthBoundaries("2025-12", "2026-02")
    expect(result).toEqual([
      { from: "2025-12-01", to: "2026-01-01" },
      { from: "2026-01-01", to: "2026-02-01" },
      { from: "2026-02-01", to: "2026-03-01" },
    ])
  })
})

describe("rowsToObjects", () => {
  it("zips columns with row values", () => {
    const result = rowsToObjects(
      [
        ["2025-08", "u1@example.com", "abc"],
        ["2025-09", "u2@example.com", "def"],
      ],
      ["month", "user_email", "id"],
      (r) => ({
        month: r.month as string,
        user_email: r.user_email as string,
        id: r.id as string,
      }),
    )
    expect(result).toEqual([
      { month: "2025-08", user_email: "u1@example.com", id: "abc" },
      { month: "2025-09", user_email: "u2@example.com", id: "def" },
    ])
  })
})

describe("query builders", () => {
  it("provider query covers all URL eras", () => {
    const q = providerViewEventsQuery("bsmh", "2025-08-01", "2025-09-01")
    expect(q).toContain("regions|units|physicians/units|nurses/units")
    // 3-segment regex (3 UUID groups separated by `/`)
    expect(q).toMatch(/\[a-f0-9-\]\{36\}\/\[a-f0-9-\]\{36\}\/\[a-f0-9-\]\{36\}/)
    expect(q).toContain("client-username` = 'bsmh'")
    expect(q).toContain("@mercy.com")
    expect(q).toContain("@bshsi.org")
    expect(q).toContain("timestamp >= '2025-08-01'")
    expect(q).toContain("timestamp < '2025-09-01'")
  })

  it("unit query is 2-segment and excludes /units/overview", () => {
    const q = unitViewEventsQuery("bsmh", "2025-08-01", "2025-09-01")
    // 2-segment regex (2 UUID groups, end-anchored)
    expect(q).toMatch(/\[a-f0-9-\]\{36\}\/\[a-f0-9-\]\{36\}\$/)
    expect(q).toContain("/units/overview")
    expect(q).toContain("NOT properties.url LIKE")
  })

  it("monthly user activity uses GROUP BY (P4-allowed exception)", () => {
    const q = monthlyUserActivityQuery("bsmh", "2025-08-01", "2025-09-01")
    expect(q).toContain("GROUP BY month, user_email")
    expect(q).toContain("count() AS event_count")
    expect(q).toContain("NOT match(properties.url, '^/(ingest|_admin)')")
  })

  it("client filter switches per client", () => {
    const ssm = providerViewEventsQuery("ssm", "2025-08-01", "2025-09-01")
    expect(ssm).toContain("client-username` = 'ssm'")
    expect(ssm).toContain("@ssmhealth.com")
    expect(ssm).toContain("@health.slu.edu")

    const duke = providerViewEventsQuery("duke", "2025-08-01", "2025-09-01")
    expect(duke).toContain("client-username` = 'duke'")
    expect(duke).toContain("@duke.edu")
  })
})

describe("buildPlatformSnapshot", () => {
  // Two months, two users, hand-tuned so the recurring window logic exercises.
  const providerEvents: ProviderEvent[] = [
    { month: "2025-08", user_email: "a@x", provider_legacy_id: "p1" },
    { month: "2025-08", user_email: "a@x", provider_legacy_id: "p2" },
    { month: "2025-09", user_email: "b@x", provider_legacy_id: "p1" },
  ]
  const unitEvents: UnitEvent[] = [
    { month: "2025-08", user_email: "a@x", group_uuid: "g1234567abcdef" },
    { month: "2025-08", user_email: "a@x", group_uuid: "g1234567abcdef" },
    { month: "2025-09", user_email: "b@x", group_uuid: "h7654321zyxwvu" },
  ]
  const monthlyActivity: MonthlyActivity[] = [
    { month: "2025-10", user_email: "a@x", event_count: 3 },
    { month: "2025-11", user_email: "a@x", event_count: 4 },
    { month: "2025-12", user_email: "a@x", event_count: 1 },
    { month: "2025-10", user_email: "b@x", event_count: 1 },
    { month: "2025-08", user_email: "c@x", event_count: 2 }, // outside recurring window
  ]

  const snap = buildPlatformSnapshot({
    client: "bsmh",
    startMonth: "2025-08",
    endMonth: "2025-09",
    providerEvents,
    unitEvents,
    monthlyActivity,
  })

  it("envelope is well-formed", () => {
    expect(snap.client).toBe("bsmh")
    expect(snap.month).toBe("2025-09")
    expect(snap.source).toBe("posthog")
  })

  it("counts unique providers and units", () => {
    expect(kpi(snap, "Unique providers viewed")?.value).toBe(2)
    expect(kpi(snap, "Unique units viewed")?.value).toBe(2)
  })

  it("active platform users counts distinct emails across activity", () => {
    expect(kpi(snap, "Active platform users")?.value).toBe(3)
  })

  it("recurring leaders + retention against fixed Oct–Feb window", () => {
    // Only "a@x" had ≥ 3 active months in Oct–Feb. "b@x" had 1. "c@x" outside window.
    const leaders = kpi(snap, "Recurring leaders (3+ mo)")
    expect(leaders?.value).toBe(1)
    expect(leaders?.denominator).toBe(2) // a@x + b@x in window
    expect(kpi(snap, "Retention rate")?.value).toBe(50) // 1/2
  })

  it("series include all months in range with zero-fill", () => {
    expect(snap.metrics.provider_views_by_month).toEqual([
      { month: "2025-08", value: 2 },
      { month: "2025-09", value: 1 },
    ])
    expect(snap.metrics.unit_views_by_month).toEqual([
      { month: "2025-08", value: 2 },
      { month: "2025-09", value: 1 },
    ])
  })

  it("top units uses 8-char prefix labels and counts descending", () => {
    expect(snap.metrics.top_units_viewed).toEqual([
      { label: "g1234567…", value: 2 },
      { label: "h7654321…", value: 1 },
    ])
  })

  it("retention is 0 when window is empty rather than NaN", () => {
    const empty = buildPlatformSnapshot({
      client: "bsmh",
      startMonth: "2025-08",
      endMonth: "2025-08",
      providerEvents: [],
      unitEvents: [],
      monthlyActivity: [],
    })
    expect(kpi(empty, "Retention rate")?.value).toBe(0)
  })
})

const kpi = (
  snap: ReturnType<typeof buildPlatformSnapshot>,
  label: string,
): { value: number; denominator?: number } | undefined =>
  snap.metrics.kpis.find((k) => k.label === label)
