<script lang="ts">
  import KpiTile from "$lib/ui/viz/KpiTile.svelte"
  import TimeSeries from "$lib/ui/viz/TimeSeries.svelte"
  import CategoryBars from "$lib/ui/viz/CategoryBars.svelte"
  import ErrorCard from "$lib/ui/ErrorCard.svelte"
  import { filterSeries } from "$lib/filter"
  import { selection } from "$lib/selection.svelte"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  const providerSeries = $derived(
    data.snapshot
      ? filterSeries(data.snapshot.metrics.provider_views_by_month, {
          start: selection.start,
          end: selection.end,
        })
      : [],
  )
  const unitSeries = $derived(
    data.snapshot
      ? filterSeries(data.snapshot.metrics.unit_views_by_month, {
          start: selection.start,
          end: selection.end,
        })
      : [],
  )
  const topUnits = $derived(
    data.snapshot
      ? data.snapshot.metrics.top_units_viewed.map((b) => ({
          label: b.label,
          value: b.value,
        }))
      : [],
  )
  const marketFilterShown = $derived(selection.market !== "all")
</script>

<div class="space-y-6">
  {#if data.loadError}
    <ErrorCard message={data.loadError} />
  {:else if !data.snapshot}
    <div class="text-sm text-slate-500 italic">Loading…</div>
  {:else}
    {#if marketFilterShown}
      <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Market filter is not applied to platform-wide metrics.
      </div>
    {/if}

    <section>
      <h2 class="mb-3 text-lg font-semibold text-slate-900">Headline metrics</h2>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        {#each data.snapshot.metrics.kpis as kpi (kpi.label)}
          <KpiTile {kpi} />
        {/each}
      </div>
    </section>

    <section class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <TimeSeries series={providerSeries} label="Provider views by month" />
      <TimeSeries series={unitSeries} label="Unit views by month" />
    </section>

    <section>
      <CategoryBars bars={topUnits} title="Top 10 units viewed" />
    </section>
  {/if}
</div>
