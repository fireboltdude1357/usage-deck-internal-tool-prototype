<script lang="ts">
  import {
    Chart,
    Svg,
    Axis,
    Grid,
    Spline,
    Points,
    Highlight,
    Tooltip,
  } from "layerchart"
  import { scaleBand, scaleLinear } from "d3-scale"
  import { curveMonotoneX } from "d3-shape"
  import type { MonthPoint } from "$lib/schema/snapshot"

  let {
    series,
    label,
  }: { series: readonly MonthPoint[]; label: string } = $props()

  const data = $derived(series.map((p) => ({ ...p })))
</script>

<div class="rounded-lg bg-white border border-slate-200 p-4 shadow-sm">
  <div class="text-sm font-medium text-slate-700 mb-3">{label}</div>
  {#if data.length === 0}
    <div class="text-sm text-slate-500 italic">No data in selected range.</div>
  {:else}
    <div class="h-56">
      <Chart
        {data}
        x="month"
        y="value"
        xScale={scaleBand().padding(0.2)}
        yScale={scaleLinear()}
        yBaseline={0}
        yNice
        padding={{ left: 36, bottom: 28, top: 12, right: 12 }}
        tooltip={{ mode: "bisect-band" }}
      >
        <Svg>
          <Grid y class="stroke-slate-200" />
          <Axis placement="left" classes={{ tickLabel: "text-xs fill-slate-500" }} />
          <Axis placement="bottom" classes={{ tickLabel: "text-xs fill-slate-500" }} />
          <Spline
            curve={curveMonotoneX}
            class="stroke-blue-600 stroke-2 fill-none"
          />
          <Points class="fill-blue-600 stroke-white stroke-1" r={4} />
          <Highlight lines points />
        </Svg>

        <Tooltip.Root let:data>
          <Tooltip.Header>{data.month}</Tooltip.Header>
          <Tooltip.List>
            <Tooltip.Item label={label} value={data.value} />
          </Tooltip.List>
        </Tooltip.Root>
      </Chart>
    </div>
  {/if}
</div>
