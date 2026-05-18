import { describe, expect, it } from "vitest"
import { aggregate } from "./aggregate"
import type { RawTransition } from "./types"

describe("aggregate", () => {
  const transitions: RawTransition[] = [
    { from: "Home", to: "Unit Detail", count: 5 },
    { from: "Unit Detail", to: "Home", count: 3 },
    { from: "Home", to: "Providers List", count: 2 },
    { from: "Home", to: "Home", count: 4 }, // self-loop
  ]

  it("round-trips to correct node and edge counts", () => {
    const graph = aggregate(transitions, "bsmh", 0)
    // States: Home, Unit Detail, Providers List
    expect(graph.nodes).toHaveLength(3)
    // Edges: Home↔Unit Detail, Home↔Providers List
    expect(graph.edges).toHaveLength(2)
  })

  it("merges bidirectional transitions into a single edge", () => {
    const graph = aggregate(transitions, "bsmh", 0)
    const homeUnit = graph.edges.find(
      (e) =>
        (e.a === "Home" && e.b === "Unit Detail") ||
        (e.a === "Unit Detail" && e.b === "Home"),
    )
    expect(homeUnit).toBeDefined()
    // a is lexicographically first: "Home" < "Unit Detail"
    expect(homeUnit?.a).toBe("Home")
    expect(homeUnit?.ab).toBe(5)
    expect(homeUnit?.ba).toBe(3)
  })

  it("records self-loop reloads on the node", () => {
    const graph = aggregate(transitions, "bsmh", 0)
    const home = graph.nodes.find((n) => n.id === "Home")
    expect(home?.reloads).toBe(4)
  })

  it("assigns clusters from clusterFor", () => {
    const graph = aggregate(transitions, "bsmh", 0)
    const home = graph.nodes.find((n) => n.id === "Home")
    expect(home?.cluster).toBe("home")
    const unit = graph.nodes.find((n) => n.id === "Unit Detail")
    expect(unit?.cluster).toBe("drill-down")
  })

  it("applies minCount threshold to filter low-traffic edges", () => {
    const graph = aggregate(transitions, "bsmh", 6)
    // Home→Unit Detail: 5+3=8 passes. Home→Providers List: 2 dropped.
    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].a).toBe("Home")
    expect(graph.edges[0].b).toBe("Unit Detail")
  })

  it("totalTransitions sums directed + self-loop counts", () => {
    const graph = aggregate(transitions, "bsmh", 0)
    // directed: 5+3+2=10, self: 4 → total 14
    expect(graph.meta.totalTransitions).toBe(14)
  })

  it("populates the client field", () => {
    const graph = aggregate(transitions, "bsmh", 0)
    expect(graph.client).toBe("bsmh")
  })

  it("handles empty input without throwing", () => {
    const graph = aggregate([], "bsmh", 0)
    expect(graph.nodes).toHaveLength(0)
    expect(graph.edges).toHaveLength(0)
    expect(graph.meta.totalTransitions).toBe(0)
  })

  it("skips transitions with missing from/to", () => {
    const raw: RawTransition[] = [
      { from: "", to: "Home", count: 3 },
      { from: "Home", to: "", count: 2 },
      { from: "Home", to: "Unit Detail", count: 1 },
    ]
    const graph = aggregate(raw, "bsmh", 0)
    expect(graph.edges).toHaveLength(1)
    expect(graph.nodes).toHaveLength(2)
  })
})
