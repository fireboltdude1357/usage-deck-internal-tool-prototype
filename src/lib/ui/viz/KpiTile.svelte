<script lang="ts">
  import type { Kpi } from "$lib/schema/snapshot"

  let { kpi }: { kpi: Kpi } = $props()

  const formatValue = (k: Kpi): string => {
    if (k.unit === "percent") return `${k.value}%`
    return k.value.toLocaleString()
  }

  const ratio = $derived(
    kpi.denominator !== undefined ? `of ${kpi.denominator.toLocaleString()}` : null,
  )
  const deltaSign = $derived(
    kpi.delta === undefined ? null : kpi.delta >= 0 ? "▲" : "▼",
  )
</script>

<div class="rounded-lg bg-white border border-slate-200 p-4 shadow-sm">
  <div class="text-xs uppercase tracking-wide text-slate-500">{kpi.label}</div>
  <div class="mt-1 flex items-baseline gap-2">
    <div class="text-3xl font-semibold text-slate-900">{formatValue(kpi)}</div>
    {#if ratio}
      <div class="text-sm text-slate-500">{ratio}</div>
    {/if}
  </div>
  {#if kpi.delta !== undefined && deltaSign}
    <div
      class="mt-2 inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded
        {kpi.delta >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}"
    >
      <span>{deltaSign}</span>
      <span>{Math.abs(kpi.delta)}%</span>
    </div>
  {/if}
</div>
