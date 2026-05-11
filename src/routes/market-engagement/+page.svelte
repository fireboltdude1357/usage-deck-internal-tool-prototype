<script lang="ts">
  import CategoryBars from "$lib/ui/viz/CategoryBars.svelte"
  import RetentionCard from "$lib/ui/viz/RetentionCard.svelte"
  import ErrorCard from "$lib/ui/ErrorCard.svelte"
  import type { MarketBar, MarketCard } from "$lib/schema/snapshot"
  import { selection } from "$lib/selection.svelte"
  import { hasMarkets } from "$lib/markets"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()
  const noMarkets = $derived(!hasMarkets(selection.system))

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

  const cards = $derived<readonly MarketCard[]>(
    data.snapshot ? data.snapshot.metrics.market_cards : [],
  )
  const calendarMonths = $derived(data.snapshot?.metrics.calendar_months ?? 7)
  const recurringMonths = $derived(data.snapshot?.metrics.recurring_window_months ?? 5)

  const leftMetricsFor = (c: MarketCard) => [
    {
      value: c.unique_providers,
      label: "Unique providers viewed in retention workflow",
      sub: "distinct provider profiles opened",
      context: `${c.pct_clinicians_viewed}% of ${c.clinicians.toLocaleString()} monitored clinicians`,
    },
    {
      value: c.avg_provider_views_per_month,
      label: "Provider views per month",
      sub: `avg across ${calendarMonths} calendar months (${c.total_provider_views} total)`,
    },
  ]
  const rightMetricsFor = (c: MarketCard) => [
    {
      value: c.unique_units,
      label: "Unique units viewed",
      sub: `${calendarMonths} months in window`,
    },
    {
      value: c.avg_unit_views_per_month,
      label: "Unit views per month",
      sub: `avg across ${calendarMonths} calendar months`,
    },
    {
      value: c.total_unit_views,
      label: "Total unit views",
      sub: "All drill-downs, excludes landing page",
    },
  ]
  const bottomMetricsFor = (c: MarketCard) => [
    {
      value: c.unique_users,
      label: `Unique users engaging with ${c.market}`,
      sub: "Aug 2025 – Feb 2026",
    },
    {
      value: c.recurring_leaders,
      label: `Recurring leaders (3+ of ${recurringMonths})`,
      sub: "Oct 2025 – Feb 2026",
    },
    {
      value: `${c.retention_rate}%`,
      label: "Retention rate",
      sub: `${c.recurring_leaders} leaders / ${c.total_users_in_window} total users in window`,
    },
  ]
</script>

<div class="space-y-8">
  {#if noMarkets}
    <div class="rounded border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
      <div class="font-medium text-slate-800">No market split for {selection.system.toUpperCase()}.</div>
      <p class="mt-1">
        Market-level retention is only available when the client has a regional
        breakdown configured. See <code>MARKETS_BY_CLIENT</code> in
        <code>src/lib/markets.ts</code>.
      </p>
    </div>
  {:else if data.loadError}
    <ErrorCard message={data.loadError} />
  {:else if !data.snapshot}
    <div class="text-sm text-slate-500 italic">Loading…</div>
  {:else}
    <section class="space-y-8">
      {#each cards as card (card.market)}
        <RetentionCard
          title="Leaders' Retention Workflow"
          kicker={`${data.snapshot.client.toUpperCase()} — ${card.market}`}
          leftHeader="Individual Clinician Level"
          leftMetrics={leftMetricsFor(card)}
          rightHeader="Unit Level"
          rightMetrics={rightMetricsFor(card)}
          bottomMetrics={bottomMetricsFor(card)}
          highlighted={selection.market === card.market}
          footnote={`Market = providers/units under ${card.market} BU codes. Period: Aug 2025 – Feb 2026 (${calendarMonths} months).
Recurring window: Oct 2025 – Feb 2026 (${recurringMonths} months). A user is "active" in a month iff they viewed a unit or provider page in this market during that month.`}
        />
      {/each}
    </section>

    <section>
      <h2 class="mb-3 text-lg font-semibold text-slate-900">Cross-market detail</h2>
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CategoryBars bars={providerBars} title="Provider views by market" />
        <CategoryBars bars={unitBars} title="Unit views by market" />
        <CategoryBars bars={userBars} title="Active users by market" />
        <CategoryBars bars={clinicianBars} title="Monitored clinicians by market" />
      </div>
    </section>
  {/if}
</div>
