<script lang="ts">
  import { untrack } from "svelte"
  import { SvelteFlow, Background, Controls, MarkerType } from "@xyflow/svelte"
  import type { Node, Edge } from "@xyflow/svelte"
  import "@xyflow/svelte/dist/style.css"
  import type { ProcessedGraph, Session } from "$lib/behavior-graph/types"
  import { clusterFor } from "$lib/behavior-graph/clusters"
  import { layoutGraph, NODE_WIDTH, NODE_HEIGHT } from "$lib/behavior-graph/layout"
  import { sessionPath, pathDirEdgeSet, dirKey } from "$lib/behavior-graph/session-path"
  import StateNode from "$lib/behavior-graph/StateNode.svelte"
  import CurvedEdge from "$lib/behavior-graph/CurvedEdge.svelte"
  import SessionAnimator from "$lib/behavior-graph/SessionAnimator.svelte"
  import FitViewHelper from "$lib/behavior-graph/FitViewHelper.svelte"

  const nodeTypes = { state: StateNode }
  const edgeTypes = { curved: CurvedEdge }

  let {
    graph,
    minTransitionCount,
    selectedSession = null,
    onClearSession = () => {},
  }: {
    graph: ProcessedGraph
    minTransitionCount: number
    selectedSession?: Session | null
    onClearSession?: () => void
  } = $props()

  // Persistent center-coord positions: dagre on first render, drag-to-persist,
  // rebuild on graph change without snapping back.
  // $state.raw: Svelte won't track deep mutations — intentional, since
  // syncPosition() writes via property assignment on drag. The reassignment
  // below (positions = merged) IS reactive, so the read inside the same
  // effect must be untracked to avoid a feedback loop.
  let positions: Record<string, { x: number; y: number }> = $state.raw({})

  let nodes: Node[] = $state([])
  let edges: Edge[] = $state([])

  const maxCount = $derived(Math.max(1, ...graph.edges.map((e) => e.ab + e.ba)))

  // Changes when the graph data changes (client/range switch), not when selectedSession changes.
  const graphKey = $derived(`${graph.nodes.length}:${graph.meta.totalTransitions}`)

  // Session path derived state
  const pathSteps = $derived(selectedSession ? sessionPath(selectedSession) : [])
  const pathStates = $derived.by(() => {
    const s = new Set<string>()
    for (const step of pathSteps) s.add(step.state)
    return s
  })
  const pathDirEdges = $derived(pathDirEdgeSet(pathSteps))

  $effect(() => {
    const activeEdges = graph.edges.filter((e) => e.ab + e.ba >= minTransitionCount)
    console.log(
      `[bgraph] canvas rebuild graphKey=${graphKey} nodes=${graph.nodes.length} totalEdges=${graph.edges.length} activeEdges=${activeEdges.length} minTC=${minTransitionCount} selectedSession=${selectedSession?.sessionId ?? "none"}`,
    )

    // Build structural nodes + edges (full graph without filter)
    // then add ghosts for session-only states/edges
    const hasPath = pathStates.size > 0

    // All nodes from graph
    const structuralNodeMap = new Map(graph.nodes.map((n) => [n.id, n]))

    // Ghost nodes: session path visits a state not in the main graph
    const ghostNodeIds = new Set<string>()
    for (const state of pathStates) {
      if (!structuralNodeMap.has(state)) ghostNodeIds.add(state)
    }

    // Directed edge ids from full graph (not filtered by minTransitionCount) — for ghost detection
    const structuralEdgeIds = new Set<string>()
    for (const e of graph.edges) {
      if (e.ab > 0) structuralEdgeIds.add(dirKey(e.a, e.b))
      if (e.ba > 0) structuralEdgeIds.add(dirKey(e.b, e.a))
    }

    // Ghost edges: session path uses an edge not in structural graph
    const ghostEdges: Array<{ id: string; source: string; target: string }> = []
    for (const eid of pathDirEdges) {
      if (structuralEdgeIds.has(eid)) continue
      const arrowIdx = eid.indexOf("→")
      if (arrowIdx < 0) continue
      ghostEdges.push({ id: eid, source: eid.slice(0, arrowIdx), target: eid.slice(arrowIdx + 1) })
    }

    // Build dagre seed: all nodes (including ghosts) + visible active edges + ghost edges
    const allNodeIds = [...graph.nodes.map((n) => n.id), ...ghostNodeIds]
    const seedNodes: Node[] = allNodeIds.map((id) => ({
      id,
      type: "state",
      position: { x: 0, y: 0 },
      data: {},
    }))

    const seedEdges: Edge[] = [
      ...activeEdges.flatMap((e) => {
        const out: Edge[] = []
        if (e.ab > 0) out.push({ id: dirKey(e.a, e.b), source: e.a, target: e.b })
        if (e.ba > 0) out.push({ id: dirKey(e.b, e.a), source: e.b, target: e.a })
        return out
      }),
      ...ghostEdges.map((ge) => ({ id: ge.id, source: ge.source, target: ge.target })),
    ]

    let centers: Record<string, { x: number; y: number }>
    try {
      ;({ centers } = layoutGraph(seedNodes, seedEdges))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(
        `[bgraph] canvas dagre layout THREW: ${msg} (seedNodes=${seedNodes.length} seedEdges=${seedEdges.length})`,
      )
      centers = {}
    }

    // Preserve existing positions; fall back to dagre for new nodes. Untrack
    // the read — this effect also writes `positions = merged` below, and a
    // tracked read would make every write re-trigger the effect (feedback
    // loop: dagre + full RF rebuild on every microtask until depth limit).
    const cachedPositions = untrack(() => positions)
    const merged: Record<string, { x: number; y: number }> = {}
    let missingPositions = 0
    for (const id of allNodeIds) {
      const fromCache = cachedPositions[id]
      const fromDagre = centers[id]
      if (!fromCache && !fromDagre) missingPositions++
      merged[id] = fromCache ?? fromDagre ?? { x: 0, y: 0 }
    }
    if (missingPositions > 0) {
      console.warn(
        `[bgraph] canvas ${missingPositions}/${allNodeIds.length} nodes have no position (dagre missed them) — falling back to (0,0)`,
      )
    }
    if (ghostNodeIds.size > 0 || ghostEdges.length > 0) {
      console.log(
        `[bgraph] canvas ghosts nodes=${ghostNodeIds.size} edges=${ghostEdges.length}`,
      )
    }
    positions = merged

    // Build RF nodes
    const rfNodes: Node[] = [
      ...graph.nodes.map((n) => {
        const pos = merged[n.id]
        const onPath = !hasPath || pathStates.has(n.id)
        return {
          id: n.id,
          type: "state",
          position: {
            x: pos.x - NODE_WIDTH / 2,
            y: pos.y - NODE_HEIGHT / 2,
          },
          data: {
            label: n.id,
            cluster: n.cluster,
            reloads: n.reloads,
            dimmed: hasPath && !onPath,
            highlighted: hasPath && onPath,
            isGhost: false,
          },
        }
      }),
      ...[...ghostNodeIds].map((id) => {
        const pos = merged[id]
        return {
          id,
          type: "state",
          position: {
            x: pos.x - NODE_WIDTH / 2,
            y: pos.y - NODE_HEIGHT / 2,
          },
          data: {
            label: id,
            cluster: clusterFor(id),
            reloads: 0,
            dimmed: false,
            highlighted: true,
            isGhost: true,
          },
        }
      }),
    ]

    // Build RF edges: active (filtered) regular edges + ghost edges
    const rfEdges: Edge[] = [
      ...activeEdges.flatMap((e) => {
        const total = e.ab + e.ba
        const ratio = total / maxCount
        const penwidth = 1.5 + Math.min(ratio, 1) * 4.5

        let color = "#6b7280"
        if (ratio > 0.4) color = "#b91c1c"
        else if (ratio > 0.2) color = "#d97706"
        else if (ratio > 0.1) color = "#334155"

        const out: Edge[] = []

        if (e.ab > 0) {
          const eid = dirKey(e.a, e.b)
          const onPath = !hasPath || pathDirEdges.has(eid)
          const dimmed = hasPath && !onPath
          const strokeColor = dimmed ? "#cbd5e1" : color
          out.push({
            id: eid,
            source: e.a,
            target: e.b,
            type: "curved",
            style: `stroke: ${strokeColor}; stroke-width: ${dimmed ? 1.25 : penwidth}px;`,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: strokeColor,
              width: 18,
              height: 18,
            },
            data: { count: e.ab, color: dimmed ? "#94a3b8" : color, dimmed, isGhost: false },
          })
        }

        if (e.ba > 0) {
          const eid = dirKey(e.b, e.a)
          const onPath = !hasPath || pathDirEdges.has(eid)
          const dimmed = hasPath && !onPath
          const strokeColor = dimmed ? "#cbd5e1" : color
          out.push({
            id: eid,
            source: e.b,
            target: e.a,
            type: "curved",
            style: `stroke: ${strokeColor}; stroke-width: ${dimmed ? 1.25 : penwidth}px;`,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: strokeColor,
              width: 18,
              height: 18,
            },
            data: { count: e.ba, color: dimmed ? "#94a3b8" : color, dimmed, isGhost: false },
          })
        }

        return out
      }),
      ...ghostEdges.map((ge) => ({
        id: ge.id,
        source: ge.source,
        target: ge.target,
        type: "curved",
        style: "stroke: #94a3b8; stroke-width: 1.5px; stroke-dasharray: 5 4;",
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#94a3b8",
          width: 16,
          height: 16,
        },
        data: { count: 0, color: "#94a3b8", dimmed: false, isGhost: true },
      })),
    ]

    nodes = rfNodes
    edges = rfEdges
  })

  function syncPosition(node: Node): void {
    positions[node.id] = {
      x: node.position.x + NODE_WIDTH / 2,
      y: node.position.y + NODE_HEIGHT / 2,
    }
  }
</script>

<div class="w-full h-full">
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    {edgeTypes}
    minZoom={0.2}
    maxZoom={2}
    proOptions={{ hideAttribution: true }}
    nodesDraggable={true}
    onnodedrag={({ targetNode }) => { if (targetNode) syncPosition(targetNode) }}
    onnodedragstop={({ targetNode }) => { if (targetNode) syncPosition(targetNode) }}
  >
    <Background patternColor="#e2e8f0" gap={24} />
    <Controls showLock={false} />
    <FitViewHelper {graphKey} />

    {#if selectedSession && pathSteps.length >= 2}
      {#key selectedSession.sessionId}
        <SessionAnimator
          session={selectedSession}
          path={pathSteps}
          nodePositions={positions}
          onClose={onClearSession}
        />
      {/key}
    {/if}
  </SvelteFlow>
</div>
