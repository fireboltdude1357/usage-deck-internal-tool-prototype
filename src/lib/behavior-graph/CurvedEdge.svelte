<script lang="ts" module>
  export type CurvedEdgeData = {
    count: number
    color: string
    dimmed: boolean
    isGhost: boolean
  }
</script>

<script lang="ts">
  import { BaseEdge, EdgeLabel } from "@xyflow/svelte"
  import type { EdgeProps } from "@xyflow/svelte"

  const CURVE_FRACTION = 0.18
  const MAX_OFFSET = 70

  let { id, sourceX, sourceY, targetX, targetY, markerEnd, style, data }: EdgeProps = $props()

  const d = $derived((data ?? { count: 0, color: "#6b7280", dimmed: false, isGhost: false }) as CurvedEdgeData)

  const dx = $derived(targetX - sourceX)
  const dy = $derived(targetY - sourceY)
  const len = $derived(Math.max(Math.hypot(dx, dy), 1))
  const offset = $derived(Math.min(MAX_OFFSET, len * CURVE_FRACTION))

  // Perpendicular unit vector +90° from source→target; flips sign for reverse
  // direction so each half of a bidi pair curves to opposite sides.
  const perpX = $derived((-dy / len) * offset)
  const perpY = $derived((dx / len) * offset)

  const midX = $derived((sourceX + targetX) / 2)
  const midY = $derived((sourceY + targetY) / 2)
  const cpX = $derived(midX + perpX)
  const cpY = $derived(midY + perpY)

  const edgePath = $derived(`M ${sourceX},${sourceY} Q ${cpX},${cpY} ${targetX},${targetY}`)

  // Midpoint of quadratic bezier at t=0.5: 0.25*P0 + 0.5*P1 + 0.25*P2
  const labelX = $derived(0.25 * sourceX + 0.5 * cpX + 0.25 * targetX)
  const labelY = $derived(0.25 * sourceY + 0.5 * cpY + 0.25 * targetY)

  const opacity = $derived(d.dimmed ? 0.18 : 1)
  const edgeStyle = $derived(`${style ?? ""}; opacity: ${opacity};`)
</script>

<BaseEdge {id} path={edgePath} style={edgeStyle} {markerEnd} />

{#if !d.isGhost && d.count > 0}
  <EdgeLabel x={labelX} y={labelY} transparent>
    <span
      style="
        display: inline-block;
        background: white;
        color: {d.color};
        border: 1.5px solid {d.color};
        padding: 2px 9px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.2;
        letter-spacing: 0.15px;
        font-variant-numeric: tabular-nums;
        box-shadow: 0 1px 3px rgba(15,23,42,0.12);
        white-space: nowrap;
        opacity: {opacity};
      "
    >
      {d.count}
    </span>
  </EdgeLabel>
{/if}
