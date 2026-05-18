import { describe, expect, it } from "vitest"
import { sessionPath, pairKey, dirKey, pathEdgeSet, pathDirEdgeSet } from "./session-path"
import type { Session } from "./types"

const makeSession = (urls: string[]): Session => ({
  sessionId: "test-session",
  user: "user@test.com",
  startTime: "2025-09-01T10:00:00Z",
  endTime: "2025-09-01T10:30:00Z",
  durationMs: 1800000,
  pageCount: urls.length,
  events: urls.map((url, i) => ({
    url,
    timestamp: `2025-09-01T10:${String(i).padStart(2, "0")}:00Z`,
  })),
})

describe("sessionPath", () => {
  it("collapses consecutive duplicate states", () => {
    const session = makeSession(["/", "/", "/units/abc"])
    const steps = sessionPath(session)
    expect(steps).toHaveLength(2)
    expect(steps[0].state).toBe("Home")
    expect(steps[0].eventCount).toBe(2)
    expect(steps[1].state).toBe("Unit Detail")
    expect(steps[1].eventCount).toBe(1)
  })

  it("drops Other and null states", () => {
    const session = makeSession(["/unknown-path", "/home", "/ingest/capture", "/providers"])
    const steps = sessionPath(session)
    expect(steps.map((s) => s.state)).toEqual(["Home", "Providers List"])
  })

  it("tracks startTime and endTime correctly when collapsing", () => {
    const session = makeSession(["/", "/", "/"])
    const steps = sessionPath(session)
    expect(steps).toHaveLength(1)
    expect(steps[0].startTime).toBe("2025-09-01T10:00:00Z")
    expect(steps[0].endTime).toBe("2025-09-01T10:02:00Z")
  })

  it("handles empty events", () => {
    const session = makeSession([])
    expect(sessionPath(session)).toEqual([])
  })

  it("handles all-Other session", () => {
    const session = makeSession(["/unknown", "/also-unknown"])
    expect(sessionPath(session)).toEqual([])
  })
})

describe("pairKey", () => {
  it("produces lexicographic ordering", () => {
    expect(pairKey("Home", "Unit Detail")).toBe("Home||Unit Detail")
    expect(pairKey("Unit Detail", "Home")).toBe("Home||Unit Detail")
  })
})

describe("dirKey", () => {
  it("preserves direction with arrow separator", () => {
    expect(dirKey("Home", "Unit Detail")).toBe("Home→Unit Detail")
    expect(dirKey("Unit Detail", "Home")).toBe("Unit Detail→Home")
  })
})

describe("pathEdgeSet", () => {
  it("returns canonical unordered edge ids for a path", () => {
    const session = makeSession(["/", "/units", "/providers", "/"])
    const steps = sessionPath(session)
    const edges = pathEdgeSet(steps)
    // Home → Units List → Providers List → Home
    expect(edges.has("Home||Units List")).toBe(true)
    expect(edges.has("Providers List||Units List")).toBe(true)
    expect(edges.has("Home||Providers List")).toBe(true)
  })

  it("does not add self-edges for collapsed states", () => {
    const session = makeSession(["/", "/", "/units"])
    const steps = sessionPath(session)
    const edges = pathEdgeSet(steps)
    expect(edges.has("Home||Home")).toBe(false)
  })
})

describe("pathDirEdgeSet", () => {
  it("produces direction-aware keys", () => {
    const session = makeSession(["/", "/units", "/"])
    const steps = sessionPath(session)
    const edges = pathDirEdgeSet(steps)
    expect(edges.has("Home→Units List")).toBe(true)
    expect(edges.has("Units List→Home")).toBe(true)
    expect(edges.has("Home→Units List→Home")).toBe(false)
  })
})
