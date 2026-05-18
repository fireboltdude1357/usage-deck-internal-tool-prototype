<script lang="ts">
  import KpiTile from "$lib/ui/viz/KpiTile.svelte"
  import TimeSeries from "$lib/ui/viz/TimeSeries.svelte"
  import CategoryBars from "$lib/ui/viz/CategoryBars.svelte"
  import RetentionCard from "$lib/ui/viz/RetentionCard.svelte"
  import ErrorCard from "$lib/ui/ErrorCard.svelte"
  import LoadingIndicator from "$lib/ui/LoadingIndicator.svelte"
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

  // Derived card-friendly numbers.
  const pctClinicians = $derived.by(() => {
    if (!data.snapshot) return 0
    const m = data.snapshot.metrics
    if (m.clinicians_monitored === 0) return 0
    const uniqProviders = m.kpis.find((k) => k.label === "Unique providers viewed")?.value ?? 0
    return Math.round((uniqProviders / m.clinicians_monitored) * 1000) / 10
  })
  const uniqueProviders = $derived(
    data.snapshot?.metrics.kpis.find((k) => k.label === "Unique providers viewed")
      ?.value ?? 0,
  )
  const uniqueUnits = $derived(
    data.snapshot?.metrics.kpis.find((k) => k.label === "Unique units viewed")
      ?.value ?? 0,
  )
  const avgProviderViews = $derived.by(() => {
    if (!data.snapshot) return 0
    const m = data.snapshot.metrics
    return m.calendar_months === 0
      ? 0
      : Math.round(m.total_provider_views / m.calendar_months)
  })
  const avgUnitViews = $derived.by(() => {
    if (!data.snapshot) return 0
    const m = data.snapshot.metrics
    return m.calendar_months === 0
      ? 0
      : Math.round(m.total_unit_views / m.calendar_months)
  })

  const leftMetrics = $derived(
    data.snapshot
      ? [
          {
            value: uniqueProviders,
            label: "Unique providers included in retention workflow",
            sub: "distinct provider profiles opened",
            context: `${pctClinicians}% of ${data.snapshot.metrics.clinicians_monitored.toLocaleString()} monitored clinicians`,
          },
          {
            value: avgProviderViews,
            label: "Provider views per month",
            sub: `avg across ${data.snapshot.metrics.calendar_months} calendar months (${data.snapshot.metrics.total_provider_views} total)`,
          },
          {
            value: data.snapshot.metrics.risk_factor_views.total,
            label: "Risk factor views",
            sub: `${data.snapshot.metrics.risk_factor_views.overview} overview + ${data.snapshot.metrics.risk_factor_views.drilldown} drill-downs`,
          },
        ]
      : [],
  )
  const rightMetrics = $derived(
    data.snapshot
      ? [
          {
            value: uniqueUnits,
            label: "Unique units viewed",
            sub: `${data.snapshot.metrics.calendar_months} months in window`,
          },
          {
            value: avgUnitViews,
            label: "Unit views per month",
            sub: `avg across ${data.snapshot.metrics.calendar_months} calendar months`,
          },
          {
            value: data.snapshot.metrics.total_unit_views,
            label: "Total unit views",
            sub: "All drill-downs, excludes landing page",
          },
        ]
      : [],
  )
  const bottomMetrics = $derived(
    data.snapshot
      ? [
          {
            value: data.snapshot.metrics.unique_users,
            label: "Unique users on platform",
            sub: "Aug 2025 – Feb 2026",
          },
          {
            value: data.snapshot.metrics.recurring_leaders,
            label: `Recurring leaders (3+ of ${data.snapshot.metrics.recurring_window_months})`,
            sub: "Oct 2025 – Feb 2026",
          },
          {
            value: `${data.snapshot.metrics.retention_rate}%`,
            label: "Retention rate",
            sub: `${data.snapshot.metrics.recurring_leaders} leaders / ${data.snapshot.metrics.total_users_in_window} total users in window`,
          },
        ]
      : [],
  )
</script>

<div class="space-y-6">
  {#if data.loadError}
    <ErrorCard message={data.loadError} />
  {:else if !data.snapshot}
    <LoadingIndicator />
  {:else}
    {#if marketFilterShown}
      <div class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Market filter is not applied to platform-wide metrics.
      </div>
    {/if}

    <RetentionCard
      title="Leaders' Retention Workflow"
      kicker={`${data.snapshot.client.toUpperCase()} — Platform`}
      leftHeader="Individual Clinician Level"
      leftMetrics={leftMetrics}
      rightHeader="Unit Level"
      rightMetrics={rightMetrics}
      bottomMetrics={bottomMetrics}
      footnote={`Client users only. Period: Aug 2025 – Feb 2026 (${data.snapshot.metrics.calendar_months} months).
URL coverage: /regions/ and /units/ eras. Recurring window: Oct 2025 – Feb 2026 (${data.snapshot.metrics.recurring_window_months} months).`}
    />

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
