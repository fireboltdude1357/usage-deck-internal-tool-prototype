<script lang="ts">
  import CategoryBars from "$lib/ui/viz/CategoryBars.svelte"
  import ErrorCard from "$lib/ui/ErrorCard.svelte"
  import type { MarketBar } from "$lib/schema/snapshot"
  import { selection } from "$lib/selection.svelte"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  const toBars = (rows: readonly MarketBar[]) =>
    rows.map((r) => ({
      label: r.market,
      value: r.value,
      highlight: selection.market !== "all" && r.market === selection.market,
    }))

  const providerBars = $derived(
    data.snapshot ? toBars(data.snapshot.metrics.provider_views_by_market) : [],
  )
  const unitBars = $derived(
    data.snapshot ? toBars(data.snapshot.metrics.unit_views_by_market) : [],
  )
  const userBars = $derived(
    data.snapshot ? toBars(data.snapshot.metrics.users_by_market) : [],
  )
  const clinicianBars = $derived(
    data.snapshot ? toBars(data.snapshot.metrics.clinicians_by_market) : [],
  )
</script>

<div class="space-y-6">
  {#if data.loadError}
    <ErrorCard message={data.loadError} />
  {:else if !data.snapshot}
    <div class="text-sm text-slate-500 italic">Loading…</div>
  {:else}
    <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      Time-range filter is not applied — market metrics are aggregated across the snapshot window.
    </div>

    <section class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <CategoryBars bars={providerBars} title="Provider views by market" />
      <CategoryBars bars={unitBars} title="Unit views by market" />
      <CategoryBars bars={userBars} title="Active users by market" />
      <CategoryBars bars={clinicianBars} title="Monitored clinicians by market" />
    </section>
  {/if}
</div>
