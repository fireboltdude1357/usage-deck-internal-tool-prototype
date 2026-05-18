import { describe, expect, it } from "vitest"
import { buildBehaviorGraph } from "$lib/server/posthog/behavior-graph-builder"
import type { RawPageLoadEvent } from "$lib/server/posthog/behavior-graph-builder"

const ts = (base: string, offsetMinutes: number): string => {
  const d = new Date(base)
  d.setMinutes(d.getMinutes() + offsetMinutes)
  return d.toISOString()
}

const BASE = "2025-09-01T10:00:00.000Z"

describe("buildBehaviorGraph — session splitting", () => {
  it("splits into two sessions when gap exceeds 30 minutes", () => {
    const events: RawPageLoadEvent[] = [
      { distinct_id: "u1@x.com", url: "/", timestamp: ts(BASE, 0) },
      { distinct_id: "u1@x.com", url: "/units", timestamp: ts(BASE, 5) },
      { distinct_id: "u1@x.com", url: "/providers", timestamp: ts(BASE, 10) },
      // 31-minute gap — new session
      { distinct_id: "u1@x.com", url: "/", timestamp: ts(BASE, 41) },
      { distinct_id: "u1@x.com", url: "/units/abc", timestamp: ts(BASE, 46) },
      { distinct_id: "u1@x.com", url: "/providers", timestamp: ts(BASE, 51) },
    ]
    const { sessions } = buildBehaviorGraph(events, { client: "bsmh" })
    const userSessions = sessions.filter((s) => s.user === "u1@x.com")
    expect(userSessions).toHaveLength(2)
  })

  it("does not split when gap is exactly at the boundary (< 30 min)", () => {
    const events: RawPageLoadEvent[] = [
      { distinct_id: "u2@x.com", url: "/", timestamp: ts(BASE, 0) },
      { distinct_id: "u2@x.com", url: "/units", timestamp: ts(BASE, 29) },
      { distinct_id: "u2@x.com", url: "/providers", timestamp: ts(BASE, 40) },
    ]
    const { sessions } = buildBehaviorGraph(events, { client: "bsmh" })
    expect(sessions.filter((s) => s.user === "u2@x.com")).toHaveLength(1)
  })
})

describe("buildBehaviorGraph — minimum page loads filter", () => {
  it("drops sessions with fewer than 3 page loads", () => {
    const events: RawPageLoadEvent[] = [
      // Short session (2 page loads) — should be dropped
      { distinct_id: "u3@x.com", url: "/", timestamp: ts(BASE, 0) },
      { distinct_id: "u3@x.com", url: "/units", timestamp: ts(BASE, 5) },
    ]
    const { sessions } = buildBehaviorGraph(events, { client: "bsmh" })
    expect(sessions.filter((s) => s.user === "u3@x.com")).toHaveLength(0)
  })

  it("keeps sessions with exactly 3 page loads", () => {
    const events: RawPageLoadEvent[] = [
      { distinct_id: "u4@x.com", url: "/", timestamp: ts(BASE, 0) },
      { distinct_id: "u4@x.com", url: "/units", timestamp: ts(BASE, 5) },
      { distinct_id: "u4@x.com", url: "/providers", timestamp: ts(BASE, 10) },
    ]
    const { sessions } = buildBehaviorGraph(events, { client: "bsmh" })
    expect(sessions.filter((s) => s.user === "u4@x.com")).toHaveLength(1)
  })
})

describe("buildBehaviorGraph — maxSessions cap", () => {
  it("keeps only the most-recent N sessions", () => {
    // Build 5 valid sessions for one user with large gaps between them
    const events: RawPageLoadEvent[] = []
    for (let s = 0; s < 5; s++) {
      const sessionBase = s * 120 // 2-hour gaps — each is a distinct session
      for (let p = 0; p < 3; p++) {
        events.push({
          distinct_id: "u5@x.com",
          url: p === 0 ? "/" : p === 1 ? "/units" : "/providers",
          timestamp: ts(BASE, sessionBase + p),
        })
      }
    }
    const { sessions } = buildBehaviorGraph(events, { client: "bsmh", maxSessions: 3 })
    expect(sessions).toHaveLength(3)
  })
})

describe("buildBehaviorGraph — transition aggregation", () => {
  it("produces correct transition edges from a single session", () => {
    const events: RawPageLoadEvent[] = [
      { distinct_id: "u6@x.com", url: "/", timestamp: ts(BASE, 0) },
      { distinct_id: "u6@x.com", url: "/units", timestamp: ts(BASE, 5) },
      { distinct_id: "u6@x.com", url: "/providers", timestamp: ts(BASE, 10) },
    ]
    const { graph } = buildBehaviorGraph(events, { client: "bsmh" })
    // Expect edges: Home↔Units List, Units List↔Providers List
    expect(graph.edges.length).toBeGreaterThanOrEqual(2)
    const stateIds = graph.nodes.map((n) => n.id)
    expect(stateIds).toContain("Home")
    expect(stateIds).toContain("Units List")
    expect(stateIds).toContain("Providers List")
  })

  it("collapses consecutive duplicate states before counting transitions", () => {
    // Home → Home → Units List → Units List — should yield one Home→Units List transition
    const events: RawPageLoadEvent[] = [
      { distinct_id: "u7@x.com", url: "/", timestamp: ts(BASE, 0) },
      { distinct_id: "u7@x.com", url: "/", timestamp: ts(BASE, 2) },
      { distinct_id: "u7@x.com", url: "/units", timestamp: ts(BASE, 5) },
      { distinct_id: "u7@x.com", url: "/units", timestamp: ts(BASE, 7) },
      { distinct_id: "u7@x.com", url: "/providers", timestamp: ts(BASE, 10) },
    ]
    const { graph } = buildBehaviorGraph(events, { client: "bsmh" })
    const homeUnit = graph.edges.find(
      (e) =>
        (e.a === "Home" && e.b === "Units List") ||
        (e.a === "Units List" && e.b === "Home"),
    )
    expect(homeUnit).toBeDefined()
    // The reload counts go to the self-loop on each node
    const homeNode = graph.nodes.find((n) => n.id === "Home")
    expect(homeNode?.reloads).toBeGreaterThanOrEqual(1)
  })

  it("skips events with null/invalid distinct_id or url", () => {
    const events: RawPageLoadEvent[] = [
      { distinct_id: "", url: "/", timestamp: ts(BASE, 0) },
      { distinct_id: "u8@x.com", url: "", timestamp: ts(BASE, 1) },
      { distinct_id: "u8@x.com", url: "/", timestamp: ts(BASE, 2) },
      { distinct_id: "u8@x.com", url: "/units", timestamp: ts(BASE, 5) },
      { distinct_id: "u8@x.com", url: "/providers", timestamp: ts(BASE, 10) },
    ]
    // Should not throw; the blank-id event is ignored
    expect(() => buildBehaviorGraph(events, { client: "bsmh" })).not.toThrow()
  })
})

describe("buildBehaviorGraph — session shape", () => {
  it("session has correct shape: sessionId, user, startTime, endTime, durationMs, pageCount, events", () => {
    const events: RawPageLoadEvent[] = [
      { distinct_id: "u9@x.com", url: "/", timestamp: ts(BASE, 0) },
      { distinct_id: "u9@x.com", url: "/units", timestamp: ts(BASE, 5) },
      { distinct_id: "u9@x.com", url: "/providers", timestamp: ts(BASE, 10) },
    ]
    const { sessions } = buildBehaviorGraph(events, { client: "bsmh" })
    expect(sessions).toHaveLength(1)
    const s = sessions[0]
    expect(s.sessionId).toContain("u9@x.com")
    expect(s.user).toBe("u9@x.com")
    expect(s.startTime).toBe(ts(BASE, 0))
    expect(s.endTime).toBe(ts(BASE, 10))
    expect(s.durationMs).toBe(10 * 60 * 1000)
    expect(s.pageCount).toBe(3)
    expect(s.events).toHaveLength(3)
  })
})
