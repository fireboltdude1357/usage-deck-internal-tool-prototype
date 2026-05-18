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
  import type { TurnoverChartPoint } from "$lib/turnover"
  import { formatPercent } from "$lib/turnover"

  let {
    series,
    label,
    stroke = "stroke-blue-600",
    fill = "fill-blue-600",
    yFormat = (v: number) => formatPercent(v),
  }: {
    series: readonly TurnoverChartPoint[]
    label: string
    stroke?: string
    fill?: string
    yFormat?: (v: number) => string
  } = $props()

  // We render two splines — actual + projection — sharing one Chart so the
  // axes line up. The projection series prepends the last actual point so
  // the dashed segment continues from the end of the solid line.
  const sorted = $derived([...series].sort((a, b) => a.month.localeCompare(b.month)))
  const lastActualIdx = $derived.by(() => {
    let i = -1
    sorted.forEach((p, idx) => {
      if (!p.is_projection) i = idx
    })
    return i
  })
  const actuals = $derived(sorted.filter((p) => !p.is_projection))
  const projections = $derived.by(() => {
    const proj = sorted.filter((p) => p.is_projection)
    if (proj.length === 0) return []
    if (lastActualIdx >= 0) return [sorted[lastActualIdx], ...proj]
    return proj
  })
  // Combined data drives axis domain + tooltip bisect. Tag rows so the
  // tooltip can label the projection segment distinctly.
  const data = $derived(sorted.map((p) => ({ ...p })))
</script>

<div class="rounded-lg bg-white border border-slate-200 p-4 shadow-sm">
  <div class="flex items-baseline justify-between mb-3">
    <div class="text-sm font-medium text-slate-700">{label}</div>
    {#if projections.length > 0}
      <div class="text-xs text-slate-500">solid = actual · dashed = projected ★</div>
    {/if}
  </div>
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
        padding={{ left: 44, bottom: 28, top: 12, right: 12 }}
        tooltip={{ mode: "bisect-band" }}
      >
        <Svg>
          <Grid y class="stroke-slate-200" />
          <Axis
            placement="left"
            classes={{ tickLabel: "text-xs fill-slate-500" }}
            format={yFormat}
          />
          <Axis placement="bottom" classes={{ tickLabel: "text-xs fill-slate-500" }} />
          {#if actuals.length > 0}
            <Spline
              data={actuals.map((p) => ({ ...p }))}
              curve={curveMonotoneX}
              class="{stroke} stroke-2 fill-none"
            />
          {/if}
          {#if projections.length > 0}
            <Spline
              data={projections.map((p) => ({ ...p }))}
              curve={curveMonotoneX}
              class="{stroke} stroke-2 fill-none opacity-60 [stroke-dasharray:4,3]"
            />
          {/if}
          <Points class="{fill} stroke-white stroke-1" r={3.5} />
          <Highlight lines points />
        </Svg>

        <Tooltip.Root let:data>
          <Tooltip.Header>
            {data.month}{data.is_projection ? " · projected ★" : ""}
          </Tooltip.Header>
          <Tooltip.List>
            <Tooltip.Item label={label} value={yFormat(data.value)} />
          </Tooltip.List>
        </Tooltip.Root>
      </Chart>
    </div>
  {/if}
</div>
