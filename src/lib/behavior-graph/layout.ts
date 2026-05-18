import dagre from "@dagrejs/dagre"
import type { Node, Edge } from "@xyflow/svelte"

export const NODE_WIDTH = 180
export const NODE_HEIGHT = 70

export function layoutGraph(
  nodes: Node[],
  edges: Edge[],
): {
  nodes: Node[]
  edges: Edge[]
  centers: Record<string, { x: number; y: number }>
} {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: "TB", nodesep: 80, ranksep: 120 })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const centers: Record<string, { x: number; y: number }> = {}
  const laidOutNodes = nodes.map((node) => {
    const pos = g.node(node.id)
    centers[node.id] = { x: pos.x, y: pos.y }
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    }
  })

  return { nodes: laidOutNodes, edges, centers }
}
