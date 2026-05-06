import { describe, expect, it } from "vitest"
import { monthBoundaries, rowsToObjects } from "./pagination"
import {
  providerViewEventsQuery,
  unitViewEventsQuery,
  monthlyUserActivityQuery,
  userActivityByMonthQuery,
} from "./queries"
import {
  buildMarketSnapshot,
  buildPlatformSnapshot,
  buildProvisionedSnapshot,
  type ProviderEvent,
  type UnitEvent,
  type MonthlyActivity,
  type UserActivityMonth,
} from "./aggregator"
import { BU_UUID_MARKET } from "./config"

// Pick the first three known BU UUIDs from each market for fixture-friendly tests.
const HAMPTON = "5504e035-7756-540b-93a7-9b0591b04a54"
const LIMA = "b8586708-4179-5f5d-b0fb-c0391f9adc77"
const KENTUCKY = "b227f07a-fb70-5287-bcc3-36f508a7d982"

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
  it("provider query covers all URL eras and extracts bu_uuid", () => {
    const q = providerViewEventsQuery("bsmh", "2025-08-01", "2025-09-01")
    expect(q).toContain("regions|units|physicians/units|nurses/units")
    expect(q).toMatch(/\[a-f0-9-\]\{36\}\/\[a-f0-9-\]\{36\}\/\[a-f0-9-\]\{36\}/)
    expect(q).toContain("AS bu_uuid")
    expect(q).toContain("AS provider_legacy_id")
    expect(q).toContain("client-username` = 'bsmh'")
    expect(q).toContain("@mercy.com")
    expect(q).toContain("@bshsi.org")
    expect(q).toContain("timestamp >= '2025-08-01'")
    expect(q).toContain("timestamp < '2025-09-01'")
  })

  it("unit query is 2-segment, excludes /units/overview, extracts bu_uuid", () => {
    const q = unitViewEventsQuery("bsmh", "2025-08-01", "2025-09-01")
    expect(q).toMatch(/\[a-f0-9-\]\{36\}\/\[a-f0-9-\]\{36\}\$/)
    expect(q).toContain("/units/overview")
    expect(q).toContain("NOT properties.url LIKE")
    expect(q).toContain("AS bu_uuid")
    expect(q).toContain("AS group_uuid")
  })

  it("monthly user activity uses GROUP BY (P4-allowed exception)", () => {
    const q = monthlyUserActivityQuery("bsmh", "2025-08-01", "2025-09-01")
    expect(q).toContain("GROUP BY month, user_email")
    expect(q).toContain("count() AS event_count")
    expect(q).toContain("NOT match(properties.url, '^/(ingest|_admin)')")
  })

  it("user activity by month emits per-user day-level columns", () => {
    const q = userActivityByMonthQuery("bsmh", "2025-08-01", "2025-09-01")
    expect(q).toContain("count() AS page_loads")
    expect(q).toContain("count(DISTINCT toDate(timestamp)) AS active_days")
    expect(q).toContain("AS first_seen")
    expect(q).toContain("AS last_seen")
    expect(q).toContain("GROUP BY month, user_email")
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

describe("BU_UUID_MARKET", () => {
  it("covers all six BSMH markets", () => {
    const markets = new Set(Object.values(BU_UUID_MARKET))
    expect(markets).toEqual(
      new Set(["Hampton Roads", "Lorain", "Lima", "Youngstown", "Kentucky", "Toledo"]),
    )
  })
})

describe("buildPlatformSnapshot", () => {
  const providerEvents: ProviderEvent[] = [
    { month: "2025-08", user_email: "a@x", bu_uuid: HAMPTON, provider_legacy_id: "p1" },
    { month: "2025-08", user_email: "a@x", bu_uuid: HAMPTON, provider_legacy_id: "p2" },
    { month: "2025-09", user_email: "b@x", bu_uuid: LIMA, provider_legacy_id: "p1" },
  ]
  const unitEvents: UnitEvent[] = [
    { month: "2025-08", user_email: "a@x", bu_uuid: HAMPTON, group_uuid: "g1234567abcdef" },
    { month: "2025-08", user_email: "a@x", bu_uuid: HAMPTON, group_uuid: "g1234567abcdef" },
    { month: "2025-09", user_email: "b@x", bu_uuid: LIMA, group_uuid: "h7654321zyxwvu" },
  ]
  const monthlyActivity: MonthlyActivity[] = [
    { month: "2025-10", user_email: "a@x", event_count: 3 },
    { month: "2025-11", user_email: "a@x", event_count: 4 },
    { month: "2025-12", user_email: "a@x", event_count: 1 },
    { month: "2025-10", user_email: "b@x", event_count: 1 },
    { month: "2025-08", user_email: "c@x", event_count: 2 },
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
    const leaders = kpi(snap, "Recurring leaders (3+ mo)")
    expect(leaders?.value).toBe(1)
    expect(leaders?.denominator).toBe(2)
    expect(kpi(snap, "Retention rate")?.value).toBe(50)
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

describe("buildMarketSnapshot", () => {
  const providers: ProviderEvent[] = [
    { month: "2025-08", user_email: "a@x", bu_uuid: HAMPTON, provider_legacy_id: "p1" },
    { month: "2025-08", user_email: "a@x", bu_uuid: HAMPTON, provider_legacy_id: "p2" },
    { month: "2025-08", user_email: "b@x", bu_uuid: LIMA, provider_legacy_id: "p3" },
  ]
  const units: UnitEvent[] = [
    { month: "2025-08", user_email: "a@x", bu_uuid: HAMPTON, group_uuid: "g1" },
    { month: "2025-08", user_email: "c@x", bu_uuid: KENTUCKY, group_uuid: "g2" },
    { month: "2025-08", user_email: "d@x", bu_uuid: "unmapped-uuid-not-in-map", group_uuid: "g3" },
  ]

  const m = buildMarketSnapshot({
    client: "bsmh",
    startMonth: "2025-08",
    endMonth: "2025-08",
    providerEvents: providers,
    unitEvents: units,
  })

  it("envelope source is posthog", () => {
    expect(m.source).toBe("posthog")
    expect(m.client).toBe("bsmh")
  })

  it("buckets provider views by market via BU_UUID_MARKET", () => {
    const counts = Object.fromEntries(
      m.metrics.provider_views_by_market.map((b) => [b.market, b.value]),
    )
    expect(counts["Hampton Roads"]).toBe(2)
    expect(counts["Lima"]).toBe(1)
    expect(counts["Kentucky"]).toBe(0)
    expect(counts["Toledo"]).toBe(0)
  })

  it("buckets unit views by market and zero-fills missing markets", () => {
    const counts = Object.fromEntries(
      m.metrics.unit_views_by_market.map((b) => [b.market, b.value]),
    )
    expect(counts["Hampton Roads"]).toBe(1)
    expect(counts["Kentucky"]).toBe(1)
    expect(counts["Lima"]).toBe(0)
    expect(counts["Toledo"]).toBe(0)
  })

  it("drops unmapped bu_uuids silently", () => {
    const total = m.metrics.unit_views_by_market.reduce((n, b) => n + b.value, 0)
    expect(total).toBe(2) // d@x's unit view dropped
  })

  it("users_by_market counts distinct emails per market across both event types", () => {
    const counts = Object.fromEntries(
      m.metrics.users_by_market.map((b) => [b.market, b.value]),
    )
    expect(counts["Hampton Roads"]).toBe(1) // a@x (provider + unit)
    expect(counts["Lima"]).toBe(1) // b@x
    expect(counts["Kentucky"]).toBe(1) // c@x
  })

  it("clinicians_by_market is empty (filled by snapshot sibling)", () => {
    expect(m.metrics.clinicians_by_market).toEqual([])
  })
})

describe("buildProvisionedSnapshot", () => {
  const providers: ProviderEvent[] = [
    { month: "2025-08", user_email: "lima-only@x", bu_uuid: LIMA, provider_legacy_id: "p1" },
    { month: "2025-09", user_email: "lima-only@x", bu_uuid: LIMA, provider_legacy_id: "p2" },
    { month: "2025-08", user_email: "mixed@x", bu_uuid: HAMPTON, provider_legacy_id: "p3" },
    { month: "2025-08", user_email: "mixed@x", bu_uuid: HAMPTON, provider_legacy_id: "p4" },
    { month: "2025-08", user_email: "mixed@x", bu_uuid: LIMA, provider_legacy_id: "p5" },
  ]
  const units: UnitEvent[] = [
    { month: "2025-08", user_email: "no-region@x", bu_uuid: "unmapped-uuid", group_uuid: "g1" },
  ]
  const userActivity: UserActivityMonth[] = [
    {
      month: "2025-08",
      user_email: "lima-only@x",
      page_loads: 10,
      active_days: 4,
      first_seen: "2025-08-12",
      last_seen: "2025-08-30",
    },
    {
      month: "2025-09",
      user_email: "lima-only@x",
      page_loads: 5,
      active_days: 2,
      first_seen: "2025-09-05",
      last_seen: "2025-09-20",
    },
    {
      month: "2025-08",
      user_email: "mixed@x",
      page_loads: 20,
      active_days: 6,
      first_seen: "2025-08-01",
      last_seen: "2025-08-28",
    },
    {
      month: "2025-08",
      user_email: "no-region@x",
      page_loads: 2,
      active_days: 1,
      first_seen: "2025-08-15",
      last_seen: "2025-08-15",
    },
  ]

  const p = buildProvisionedSnapshot({
    client: "bsmh",
    startMonth: "2025-08",
    endMonth: "2025-09",
    providerEvents: providers,
    unitEvents: units,
    userActivity,
    provisionedTotal: 37,
    provisionedLima: 7,
  })

  it("merges per-month activity into per-user totals", () => {
    const lima = p.metrics.user_detail.find((r) => r.email === "lima-only@x")
    expect(lima?.page_loads).toBe(15)
    expect(lima?.active_days).toBe(6)
    expect(lima?.first_seen).toBe("2025-08-12")
    expect(lima?.last_seen).toBe("2025-09-20")
  })

  it("attributes user.market by most-frequent region (option A)", () => {
    const limaUser = p.metrics.user_detail.find((r) => r.email === "lima-only@x")
    expect(limaUser?.market).toBe("Lima")

    // mixed@x viewed Hampton Roads twice + Lima once → Hampton Roads wins.
    const mixedUser = p.metrics.user_detail.find((r) => r.email === "mixed@x")
    expect(mixedUser?.market).toBe("Hampton Roads")
  })

  it("leaves market undefined when user has no region-attributable events", () => {
    const orphan = p.metrics.user_detail.find((r) => r.email === "no-region@x")
    expect(orphan?.market).toBeUndefined()
  })

  it("sorts user_detail by page_loads descending", () => {
    const loads = p.metrics.user_detail.map((r) => r.page_loads)
    expect(loads).toEqual([...loads].sort((a, b) => b - a))
  })

  it("total = unique logged-in users with provisionedTotal as denominator", () => {
    expect(p.metrics.total.value).toBe(3) // 3 distinct emails in userActivity
    expect(p.metrics.total.denominator).toBe(37)
    expect(p.metrics.total.label).toBe("Logged in")
  })

  it("lima = users attributed to Lima with provisionedLima as denominator", () => {
    expect(p.metrics.lima.value).toBe(1) // only lima-only@x
    expect(p.metrics.lima.denominator).toBe(7)
  })

  it("omits denominator when client config is null (e.g. SSM/Duke/UCSF)", () => {
    const p2 = buildProvisionedSnapshot({
      client: "ssm",
      startMonth: "2025-08",
      endMonth: "2025-08",
      providerEvents: [],
      unitEvents: [],
      userActivity: [],
      provisionedTotal: null,
      provisionedLima: null,
    })
    expect(p2.metrics.total.denominator).toBeUndefined()
    expect(p2.metrics.lima.denominator).toBeUndefined()
  })
})

const kpi = (
  snap: ReturnType<typeof buildPlatformSnapshot>,
  label: string,
): { value: number; denominator?: number } | undefined =>
  snap.metrics.kpis.find((k) => k.label === label)
