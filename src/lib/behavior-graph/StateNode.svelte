<script lang="ts" module>
  import type { ClusterId } from "$lib/behavior-graph/types"

  export type StateNodeData = {
    label: string
    cluster: ClusterId | null
    reloads: number
    dimmed: boolean
    highlighted: boolean
    isGhost: boolean
  }
</script>

<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte"
  import { CLUSTER_META } from "$lib/behavior-graph/clusters"

  let { data }: { data: StateNodeData } = $props()

  const meta = $derived(data.cluster ? CLUSTER_META[data.cluster] : null)
  const color = $derived(meta?.color ?? "#94a3b8")
  const fill = $derived(meta?.fillcolor ?? "#f8fafc")
  const textColor = $derived(meta?.fontcolor ?? "#0f172a")

  const handleStyle = "opacity: 0; width: 1px; height: 1px; border: none; background: transparent;"

  const boxShadow = $derived(
    data.highlighted
      ? `0 0 0 3px ${color}44, 0 10px 28px rgba(15,23,42,0.12), 0 2px 6px rgba(15,23,42,0.06)`
      : "0 1px 2px rgba(15,23,42,0.04), 0 6px 16px rgba(15,23,42,0.04)"
  )
</script>

<div
  style="
    position: relative;
    background: {data.isGhost ? 'white' : `linear-gradient(180deg, ${fill} 0%, #ffffff 100%)`};
    border: {data.isGhost ? `2px dashed ${color}` : `1px solid ${color}66`};
    border-radius: 14px;
    padding: 12px 16px;
    min-width: 168px;
    box-shadow: {boxShadow};
    opacity: {data.dimmed ? 0.15 : 1};
    transition: opacity 300ms ease, box-shadow 300ms ease;
  "
>
  <Handle type="target" position={Position.Top} style={handleStyle} />

  <div style="display: flex; align-items: center; gap: 8px;">
    <span
      aria-hidden="true"
      style="
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: {color};
        flex-shrink: 0;
        box-shadow: 0 0 0 2px {color}22;
      "
    ></span>
    <span
      style="
        font-size: 12.5px;
        font-weight: 700;
        letter-spacing: -0.15px;
        color: {textColor};
        white-space: nowrap;
      "
    >
      {data.label}
    </span>
  </div>

  {#if data.reloads > 0 || data.isGhost}
    <div
      style="
        margin-top: 5px;
        margin-left: 17px;
        font-size: 10px;
        font-weight: 500;
        color: #94a3b8;
        font-style: {data.isGhost ? 'italic' : 'normal'};
        white-space: nowrap;
      "
    >
      {data.isGhost ? "session only" : `↻ ${data.reloads.toLocaleString()} reloads`}
    </div>
  {/if}

  <Handle type="source" position={Position.Bottom} style={handleStyle} />
</div>
