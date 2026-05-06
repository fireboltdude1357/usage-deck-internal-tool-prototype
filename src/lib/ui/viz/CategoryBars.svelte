<script lang="ts">
  type Bar = { label: string; value: number; highlight?: boolean }

  let {
    bars,
    title,
  }: { bars: readonly Bar[]; title: string } = $props()

  const max = $derived(Math.max(1, ...bars.map((b) => b.value)))
  const anyHighlighted = $derived(bars.some((b) => b.highlight))
</script>

<div class="rounded-lg bg-white border border-slate-200 p-4 shadow-sm">
  <div class="text-sm font-medium text-slate-700 mb-3">{title}</div>
  {#if bars.length === 0}
    <div class="text-sm text-slate-500 italic">No data.</div>
  {:else}
    <ul class="space-y-1.5">
      {#each bars as bar (bar.label)}
        {@const pct = (bar.value / max) * 100}
        {@const dimmed = anyHighlighted && !bar.highlight}
        <li class="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-2">
          <span
            class="truncate text-xs {bar.highlight
              ? 'font-semibold text-slate-900'
              : dimmed
                ? 'text-slate-400'
                : 'text-slate-600'}"
            title={bar.label}
          >
            {bar.label}
          </span>
          <div class="relative h-5 rounded bg-slate-100">
            <div
              class="h-full rounded transition-[width] {bar.highlight
                ? 'bg-blue-600'
                : dimmed
                  ? 'bg-blue-100'
                  : 'bg-blue-300'}"
              style:width="{pct}%"
            ></div>
          </div>
          <span
            class="text-right text-xs tabular-nums {bar.highlight
              ? 'font-semibold text-slate-900'
              : dimmed
                ? 'text-slate-400'
                : 'text-slate-700'}"
          >
            {bar.value.toLocaleString()}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
