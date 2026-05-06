import { describe, expect, it } from "vitest"
import { Schema, Either } from "effect"
import {
  Market,
  Month,
  PlatformSnapshot,
  MarketSnapshot,
  ProvisionedUsersSnapshot,
} from "./snapshot.js"

const platformFixture = {
  client: "bsmh",
  month: "2026-04",
  generated_at: "2026-05-01T17:30:00Z",
  source: "posthog",
  metrics: {
    kpis: [{ label: "Unique providers viewed", value: 142, unit: "count" }],
    provider_views_by_month: [{ month: "2025-08", value: 9 }],
    unit_views_by_month: [{ month: "2025-08", value: 91 }],
    top_units_viewed: [{ label: "ICU", value: 12 }],
  },
}

const marketFixture = {
  client: "bsmh",
  month: "2026-04",
  generated_at: "2026-05-01T17:30:00Z",
  source: "posthog",
  metrics: {
    provider_views_by_market: [{ market: "Lima", value: 7 }],
    unit_views_by_market: [{ market: "Lima", value: 14 }],
    users_by_market: [{ market: "Lima", value: 7 }],
    clinicians_by_market: [{ market: "Lima", value: 23 }],
  },
}

const provisionedFixture = {
  client: "bsmh",
  month: "2026-04",
  generated_at: "2026-05-01T17:30:00Z",
  source: "posthog",
  metrics: {
    total: { label: "Logged in", value: 22, denominator: 37, unit: "count" },
    lima: { label: "Lima logged in", value: 7, denominator: 7, unit: "count" },
    user_detail: [
      {
        email: "user01@mercy.com",
        market: "Lima",
        page_loads: 1975,
        active_days: 10,
        first_seen: "2025-08-12",
        last_seen: "2026-02-18",
      },
    ],
  },
}

describe("snapshot Schemas", () => {
  it("PlatformSnapshot decodes a well-formed fixture", () => {
    expect(() => Schema.decodeUnknownSync(PlatformSnapshot)(platformFixture)).not.toThrow()
  })

  it("MarketSnapshot decodes a well-formed fixture", () => {
    expect(() => Schema.decodeUnknownSync(MarketSnapshot)(marketFixture)).not.toThrow()
  })

  it("ProvisionedUsersSnapshot decodes a well-formed fixture", () => {
    expect(() =>
      Schema.decodeUnknownSync(ProvisionedUsersSnapshot)(provisionedFixture),
    ).not.toThrow()
  })

  it("rejects a malformed inner field (string where number expected)", () => {
    const bad = {
      ...platformFixture,
      metrics: {
        ...platformFixture.metrics,
        kpis: [{ label: "x", value: "not a number" }],
      },
    }
    const result = Schema.decodeUnknownEither(PlatformSnapshot)(bad)
    expect(Either.isLeft(result)).toBe(true)
  })

  it("rejects an unknown Market literal", () => {
    const result = Schema.decodeUnknownEither(Market)("Atlantis")
    expect(Either.isLeft(result)).toBe(true)
  })

  it("rejects a malformed Month string", () => {
    const result = Schema.decodeUnknownEither(Month)("2026-13")
    expect(Either.isLeft(result)).toBe(true)
  })

  it("accepts an optional UserRow market", () => {
    const fixture = {
      ...provisionedFixture,
      metrics: {
        ...provisionedFixture.metrics,
        user_detail: [
          {
            email: "userNN@bshsi.org",
            page_loads: 12,
            active_days: 1,
            first_seen: "2025-08-12",
            last_seen: "2025-08-12",
          },
        ],
      },
    }
    expect(() => Schema.decodeUnknownSync(ProvisionedUsersSnapshot)(fixture)).not.toThrow()
  })
})
