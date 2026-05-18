import type { RawTransition, GraphEdge, GraphNode, ProcessedGraph } from "./types"
import { clusterFor } from "./clusters"

/**
 * Pre-classified state transitions → ProcessedGraph with:
 *   - Bidirectional edges merged
 *   - min-count threshold applied
 *
 * Input `from`/`to` are already state names (e.g., "Home", "Unit Detail").
 */
export function aggregate(
  raw: RawTransition[],
  client: string,
  minCount: number,
): ProcessedGraph {
  const directed = new Map<string, number>()
  const selfLoops = new Map<string, number>()

  for (const t of raw) {
    if (!t.from || !t.to) continue
    if (t.from === t.to) {
      selfLoops.set(t.from, (selfLoops.get(t.from) ?? 0) + t.count)
    } else {
      const key = `${t.from}→${t.to}`
      directed.set(key, (directed.get(key) ?? 0) + t.count)
    }
  }

  const pairs = new Map<
    string,
    { a: string; b: string; ab: number; ba: number }
  >()
  for (const [key, count] of directed) {
    const [src, dst] = key.split("→")
    const [a, b] = src < dst ? [src, dst] : [dst, src]
    const pKey = `${a}||${b}`
    const existing = pairs.get(pKey) ?? { a, b, ab: 0, ba: 0 }
    if (src === a) existing.ab += count
    else existing.ba += count
    pairs.set(pKey, existing)
  }

  const edges: GraphEdge[] = []
  const statesInEdges = new Set<string>()
  for (const [pKey, pair] of pairs) {
    if (pair.ab + pair.ba < minCount) continue
    edges.push({
      id: pKey,
      a: pair.a,
      b: pair.b,
      ab: pair.ab,
      ba: pair.ba,
    })
    statesInEdges.add(pair.a)
    statesInEdges.add(pair.b)
  }

  // Collect nodes — any state that appears in a visible edge OR has self-loops.
  const allStates = new Set<string>(statesInEdges)
  for (const s of selfLoops.keys()) allStates.add(s)

  const nodes: GraphNode[] = Array.from(allStates)
    .sort()
    .map((state) => ({
      id: state,
      cluster: clusterFor(state),
      reloads: selfLoops.get(state) ?? 0,
    }))

  const totalTransitions =
    Array.from(directed.values()).reduce((a, b) => a + b, 0) +
    Array.from(selfLoops.values()).reduce((a, b) => a + b, 0)

  return {
    client,
    meta: {
      totalTransitions,
      stateCount: nodes.length,
      edgeCount: edges.length,
    },
    nodes,
    edges,
  }
}
