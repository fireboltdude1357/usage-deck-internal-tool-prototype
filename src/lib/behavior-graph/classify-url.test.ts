import { describe, expect, it } from "vitest"
import { classifyUrl } from "./classify-url"

describe("classifyUrl", () => {
  it("returns null for null/undefined input", () => {
    expect(classifyUrl(null)).toBeNull()
    expect(classifyUrl(undefined)).toBeNull()
    expect(classifyUrl("")).toBeNull()
  })

  it("returns null for ingest and well-known paths", () => {
    expect(classifyUrl("/ingest/foo")).toBeNull()
    expect(classifyUrl("/.well-known/openid-configuration")).toBeNull()
  })

  it("classifies home", () => {
    expect(classifyUrl("/")).toBe("Home")
    expect(classifyUrl("/home")).toBe("Home")
    expect(classifyUrl("/home/")).toBe("Home")
  })

  // Hard rule: era 2 `/regions/` paths must classify (CLAUDE.md PostHog URL eras)
  it("era 2: /regions/ → Units List", () => {
    expect(classifyUrl("/regions")).toBe("Units List")
    expect(classifyUrl("/regions/")).toBe("Units List")
  })

  it("era 2: /regions/{uuid} → Region Detail", () => {
    expect(classifyUrl("/regions/abc-123")).toBe("Region Detail")
  })

  it("era 2: /regions/{uuid}/{uuid} → Provider in Region", () => {
    expect(classifyUrl("/regions/abc-123/def-456")).toBe("Provider in Region")
  })

  it("era 2: /regions/{uuid}/tasks → Region Task", () => {
    expect(classifyUrl("/regions/abc-123/tasks")).toBe("Region Task")
    expect(classifyUrl("/regions/abc-123/initiatives")).toBe("Region Task")
  })

  // Hard rule: era 3 `/units/` paths must classify (CLAUDE.md PostHog URL eras)
  it("era 3: /units/ → Units List", () => {
    expect(classifyUrl("/units")).toBe("Units List")
    expect(classifyUrl("/units/")).toBe("Units List")
  })

  it("era 3: /units/{uuid} → Unit Detail", () => {
    expect(classifyUrl("/units/abc-123")).toBe("Unit Detail")
  })

  it("era 3: /units/{uuid}/{uuid}/{uuid} → Provider in Unit", () => {
    expect(classifyUrl("/units/abc/def/ghi")).toBe("Provider in Unit")
  })

  // Hard rule: /physicians/units/ must classify (CLAUDE.md PostHog URL eras)
  it("era 3: /physicians/units/... → Provider in Unit", () => {
    expect(classifyUrl("/physicians/units/abc-123/def-456")).toBe("Provider in Unit")
  })

  // Hard rule: /nurses/units/ must classify (CLAUDE.md PostHog URL eras)
  it("era 3: /nurses/units/... → Provider in Unit", () => {
    expect(classifyUrl("/nurses/units/abc-123/def-456")).toBe("Provider in Unit")
  })

  it("classifies shared paths across eras", () => {
    expect(classifyUrl("/providers")).toBe("Providers List")
    expect(classifyUrl("/providers/")).toBe("Providers List")
    expect(classifyUrl("/provider/123")).toBe("Provider Detail")
    expect(classifyUrl("/risk-factors")).toBe("Risk Factors")
    expect(classifyUrl("/risk-factors/12/interventions")).toBe("Risk Factors")
    expect(classifyUrl("/interventions")).toBe("Interventions")
    expect(classifyUrl("/execdash")).toBe("Exec Dashboard")
    expect(classifyUrl("/glossary")).toBe("Glossary")
    expect(classifyUrl("/settings")).toBe("Settings")
    expect(classifyUrl("/settings/filters")).toBe("Filters")
    expect(classifyUrl("/settings/filters/new")).toBe("New Filter")
    expect(classifyUrl("/admin")).toBe("Admin")
  })

  it("strips query strings and hashes before classifying", () => {
    expect(classifyUrl("/home?ref=email")).toBe("Home")
    expect(classifyUrl("/units#top")).toBe("Units List")
  })

  it("returns Other for unrecognized paths", () => {
    expect(classifyUrl("/unknown-path")).toBe("Other")
  })
})
