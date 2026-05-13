<script lang="ts">
  import KpiTile from "$lib/ui/viz/KpiTile.svelte"
  import TimeSeries from "$lib/ui/viz/TimeSeries.svelte"
  import CategoryBars from "$lib/ui/viz/CategoryBars.svelte"
  import ErrorCard from "$lib/ui/ErrorCard.svelte"
  import { selection } from "$lib/selection.svelte"
  import type { EngagementDefinition } from "$lib/schema/snapshot"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  // Default to rolling 3-mo (the original definition); persist nothing — tab
  // resets on reload, which is fine for an experimentation surface.
  let activeDefinition: EngagementDefinition = $state("rolling_3mo")

  const adoptersSeries = $derived(
    data.snapshot?.metrics.adoption.map((p) => ({
      month: p.month,
      value: p.adopters,
    })) ?? [],
  )
  const newAdoptersBars = $derived(
    data.snapshot?.metrics.adoption.map((p) => ({
      label: p.month,
      value: p.new_adopters,
    })) ?? [],
  )
  const activeView = $derived(
    data.snapshot?.metrics.views.find((v) => v.definition === activeDefinition) ??
      data.snapshot?.metrics.views[0],
  )

  const marketFilterShown = $derived(selection.market !== "all")
</script>

<div class="space-y-6">
  {#if data.loadError}
    <ErrorCard message={data.loadError} />
  {:else if !data.snapshot || !activeView}
    <div class="text-sm text-slate-500 italic">Loading…</div>
  {:else}
    {#if marketFilterShown}
      <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Market filter is not applied to adoption/engagement metrics.
      </div>
    {/if}

    <section>
      <header class="mb-3">
        <h2 class="text-lg font-semibold text-slate-900">Adoption vs. engagement</h2>
        <p class="text-sm text-slate-500">
          <span class="font-medium text-slate-700">Adopter:</span> any user with at least one
          session in the picker window (cumulative). The adoption curve below is the same across
          every tab; the engagement curve and KPIs change with the definition.
        </p>
      </header>
    </section>

    <section>
      <div class="flex flex-wrap gap-1 border-b border-slate-200">
        {#each data.snapshot.metrics.views as v (v.definition)}
          {@const active = v.definition === activeDefinition}
          <button
            type="button"
            onclick={() => (activeDefinition = v.definition)}
            class="border-b-2 px-3 py-2 text-sm
              {active
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'}"
          >
            {v.label}
          </button>
        {/each}
      </div>
      <p class="mt-2 text-sm text-slate-500">
        <span class="font-medium text-slate-700">Engaged:</span>
        {activeView.description}
      </p>
    </section>

    <section>
      <div class="grid grid-cols-2 gap-3 md:grid-cols-3">
        {#each activeView.kpis as kpi (kpi.label)}
          <KpiTile {kpi} />
        {/each}
      </div>
    </section>

    <section class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <TimeSeries series={adoptersSeries} label="Cumulative adopters by month" />
      <TimeSeries
        series={activeView.engaged_by_month}
        label={`Engaged users by month — ${activeView.label}`}
      />
    </section>

    <section>
      <CategoryBars bars={newAdoptersBars} title="New adopters per month" />
    </section>
  {/if}
</div>
