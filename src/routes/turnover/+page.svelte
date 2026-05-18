<script lang="ts">
  import { selection } from "$lib/selection.svelte"
  import { MARKETS_BY_CLIENT, hasMarkets } from "$lib/markets"
  import ErrorCard from "$lib/ui/ErrorCard.svelte"
  import DataTable from "$lib/ui/viz/DataTable.svelte"
  import TurnoverChart from "$lib/ui/TurnoverChart.svelte"
  import {
    formatLeadMonths,
    formatPercent,
    latestActualRate,
    quarterLabel,
    seriesFor,
    yoyDelta,
  } from "$lib/turnover"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  const client = $derived(selection.system)
  const markets = $derived(MARKETS_BY_CLIENT[client])
  const showMarkets = $derived(hasMarkets(client) && (data.monthly?.length ?? 0) > 0)

  const monthly = $derived(data.monthly ?? [])
  const flagging = $derived(data.snapshot?.metrics.flagging ?? null)
  const providerDetail = $derived(data.snapshot?.metrics.provider_detail ?? [])
  const benchmarks = $derived(data.snapshot?.metrics.national_benchmarks ?? null)
  const forecastOrigin = $derived(data.snapshot?.metrics.forecast_origin ?? null)

  // §1 KPI tiles (system-level)
  const sysOverallRate = $derived(latestActualRate(monthly, "system", "all"))
  const sysOverallYoy = $derived(yoyDelta(monthly, "system", "all"))
  const sysApcRate = $derived(latestActualRate(monthly, "system", "apc"))
  const sysApcYoy = $derived(yoyDelta(monthly, "system", "apc"))
  const sysPhysRate = $derived(latestActualRate(monthly, "system", "physician"))
  const sysPhysYoy = $derived(yoyDelta(monthly, "system", "physician"))

  const fmtKpi = (rate: number | null, delta: number | null) => {
    if (rate === null) return { value: "—", deltaText: null, deltaUp: null }
    return {
      value: formatPercent(rate),
      deltaText: delta === null ? null : formatPercent(Math.abs(delta), 2) + " YoY",
      // For turnover, lower is better — invert the "up = good" colour.
      deltaUp: delta === null ? null : delta < 0,
      sign: delta === null ? null : delta < 0 ? "▼" : "▲",
    }
  }

  const sysKpis = $derived([
    { label: "All providers (rolling 12 mo)", ...fmtKpi(sysOverallRate, sysOverallYoy) },
    { label: "APC", ...fmtKpi(sysApcRate, sysApcYoy) },
    { label: "Physician", ...fmtKpi(sysPhysRate, sysPhysYoy) },
  ])

  const sysOverallSeries = $derived(seriesFor(monthly, "system", "all"))
  const sysApcSeries = $derived(seriesFor(monthly, "system", "apc"))
  const sysPhysSeries = $derived(seriesFor(monthly, "system", "physician"))

  // §4 — KPI tiles for retrospective flagging
  const flagKpis = $derived(
    flagging
      ? [
          {
            label: "Providers identified before departure",
            value: formatPercent(flagging.system.flag_rate, 1),
            sub: `${flagging.system.n_flagged} of ${flagging.system.n_quitters} departed`,
          },
          {
            label: "Median advance notice",
            value: formatLeadMonths(flagging.system.median_lead_months),
            sub: `mean ${formatLeadMonths(flagging.system.mean_lead_months)}`,
          },
          {
            label: "Avg flagged per month",
            value: flagging.system.avg_flagged_per_month.toFixed(1),
            sub: `against headcount ${flagging.system.most_recent_headcount.toLocaleString()}`,
          },
        ]
      : [],
  )

  // §4 — by-market identification table
  const byMarketRows = $derived(
    flagging?.by_market.map((m) => ({
      market: m.market,
      quitters: m.n_quitters,
      flagged: m.n_flagged,
      flag_rate: formatPercent(m.flag_rate, 1),
      mean_lead: formatLeadMonths(m.mean_lead_months),
      per_month: m.avg_flagged_per_month.toFixed(1),
    })) ?? [],
  )

  // §4 — active provider risk flagging (currently-active flagged counts)
  const activeRows = $derived(
    flagging?.active.by_market.map((m) => ({
      market: m.market,
      active: m.active,
      flagged: m.flagged,
      flagged_pct: m.active > 0 ? formatPercent(m.flagged / m.active, 1) : "—",
      quit: m.quit,
    })) ?? [],
  )

  // §4 — provider detail bucketed by market for clients with markets;
  // a single "All providers" bucket for duke/ucsf.
  type ProviderRow = {
    name: string
    category: string
    specialty: string
    quit_date: string
    flag_date: string
    months_prior: string
  }
  const providerRowsByBucket = $derived.by(() => {
    const fmt = (r: (typeof providerDetail)[number]): ProviderRow => ({
      name: r.name,
      category: r.category,
      specialty: r.specialty,
      quit_date: r.quit_date,
      flag_date: r.flag_date ?? "—",
      months_prior: r.months_prior === null ? "not flagged" : String(r.months_prior),
    })
    if (!showMarkets) {
      return [{ label: "All departures", rows: providerDetail.map(fmt) }]
    }
    return markets.map((market) => ({
      label: market,
      rows: providerDetail.filter((p) => p.market === market).map(fmt),
    }))
  })

  const providerColumns: { key: keyof ProviderRow; label: string }[] = [
    { key: "name", label: "Provider" },
    { key: "category", label: "Category" },
    { key: "specialty", label: "Specialty" },
    { key: "quit_date", label: "Quit date" },
    { key: "flag_date", label: "First flagged" },
    { key: "months_prior", label: "Months prior" },
  ]
  const byMarketColumns = [
    { key: "market" as const, label: "Market" },
    { key: "quitters" as const, label: "Quitters" },
    { key: "flagged" as const, label: "Flagged before" },
    { key: "flag_rate" as const, label: "Flag rate" },
    { key: "mean_lead" as const, label: "Mean lead" },
    { key: "per_month" as const, label: "Avg/mo" },
  ]
  const activeColumns = [
    { key: "market" as const, label: "Market" },
    { key: "active" as const, label: "Active providers" },
    { key: "flagged" as const, label: "Currently flagged" },
    { key: "flagged_pct" as const, label: "Flagged %" },
    { key: "quit" as const, label: "Quit in window" },
  ]

  const analysisWindowLabel = $derived(
    flagging
      ? `${quarterLabel(flagging.analysis_window.start)} – ${quarterLabel(flagging.analysis_window.end)}`
      : "",
  )
</script>

<div class="space-y-10">
  {#if data.loadError}
    <ErrorCard message={data.loadError} />
  {:else if !data.snapshot}
    <div class="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
      No turnover snapshot exists for {client.toUpperCase()} yet.
    </div>
  {:else}
    {#if showMarkets}
      <div class="rounded-md border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        All markets shown below — the top-bar market picker is a filter for
        other pages and does not affect this view.
      </div>
    {/if}

    <!-- §1 system-wide turnover -->
    <section class="space-y-4">
      <header>
        <h2 class="text-lg font-semibold text-slate-900">System-wide turnover</h2>
        <p class="text-sm text-slate-500">
          Rolling 12-month turnover rate.
          {#if forecastOrigin}
            Actuals through {forecastOrigin}; everything past is projected ★.
          {/if}
        </p>
      </header>
      <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
        {#each sysKpis as k (k.label)}
          <div class="rounded-lg bg-white border border-slate-200 p-4 shadow-sm">
            <div class="text-xs uppercase tracking-wide text-slate-500">{k.label}</div>
            <div class="mt-1 text-3xl font-semibold text-slate-900">{k.value}</div>
            {#if k.deltaText}
              <div
                class="mt-2 inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded
                  {k.deltaUp ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}"
              >
                <span>{k.sign}</span>
                <span>{k.deltaText}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TurnoverChart label="All providers" series={sysOverallSeries} />
        <TurnoverChart
          label="APC"
          series={sysApcSeries}
          stroke="stroke-teal-600"
          fill="fill-teal-600"
        />
        <TurnoverChart
          label="Physician"
          series={sysPhysSeries}
          stroke="stroke-violet-600"
          fill="fill-violet-600"
        />
      </div>
    </section>

    <!-- §2/§3 per-market deep dives -->
    {#if showMarkets}
      <section class="space-y-6">
        <header>
          <h2 class="text-lg font-semibold text-slate-900">Market deep-dive</h2>
          <p class="text-sm text-slate-500">
            Same three-line chart per market. Sparse months indicate the producer
            didn't have a full 12-month trailing window for that market yet.
          </p>
        </header>
        {#each markets as market (market)}
          {@const overall = seriesFor(monthly, market, "all")}
          {@const apc = seriesFor(monthly, market, "apc")}
          {@const phys = seriesFor(monthly, market, "physician")}
          {@const rate = latestActualRate(monthly, market, "all")}
          <div class="space-y-3">
            <div class="flex items-baseline gap-3">
              <h3 class="text-base font-semibold text-slate-800">{market}</h3>
              {#if rate !== null}
                <span class="text-sm text-slate-500">latest {formatPercent(rate)}</span>
              {/if}
            </div>
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <TurnoverChart label="All" series={overall} />
              <TurnoverChart
                label="APC"
                series={apc}
                stroke="stroke-teal-600"
                fill="fill-teal-600"
              />
              <TurnoverChart
                label="Physician"
                series={phys}
                stroke="stroke-violet-600"
                fill="fill-violet-600"
              />
            </div>
          </div>
        {/each}
      </section>
    {/if}

    <!-- §4 retrospective flagging -->
    {#if flagging}
      <section class="space-y-6">
        <header>
          <h2 class="text-lg font-semibold text-slate-900">
            Retrospective flagging — {analysisWindowLabel}
          </h2>
          <p class="text-sm text-slate-500">
            How many departing providers were identified as elevated quit risk
            before they left, and how much advance notice the model gave.
            Flag threshold: top {100 - flagging.flag_percentile}th percentile of
            quit probability.
          </p>
        </header>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
          {#each flagKpis as k (k.label)}
            <div class="rounded-lg bg-white border border-slate-200 p-4 shadow-sm">
              <div class="text-xs uppercase tracking-wide text-slate-500">{k.label}</div>
              <div class="mt-1 text-3xl font-semibold text-slate-900">{k.value}</div>
              <div class="mt-1 text-xs text-slate-500">{k.sub}</div>
            </div>
          {/each}
        </div>

        {#if showMarkets && byMarketRows.length > 0}
          <div class="space-y-2">
            <h3 class="text-sm font-semibold text-slate-700">Identification by market</h3>
            <DataTable rows={byMarketRows} columns={byMarketColumns} />
          </div>
          <div class="space-y-2">
            <h3 class="text-sm font-semibold text-slate-700">Active provider risk flagging</h3>
            <DataTable rows={activeRows} columns={activeColumns} />
          </div>
        {/if}

        <div class="space-y-6">
          <h3 class="text-sm font-semibold text-slate-700">Provider detail</h3>
          {#each providerRowsByBucket as bucket (bucket.label)}
            {#if bucket.rows.length > 0}
              <div class="space-y-2">
                <div class="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {bucket.label} · {bucket.rows.length} provider{bucket.rows.length === 1 ? "" : "s"}
                </div>
                <DataTable rows={bucket.rows} columns={providerColumns} />
              </div>
            {/if}
          {/each}
        </div>
      </section>
    {/if}

    <footer class="border-t border-slate-200 pt-4 text-xs text-slate-500">
      National benchmarks reference: SullivanCotter,
      <em>APP Turnover: A Costly Reality</em> (2025) —
      {#if benchmarks}
        APC {formatPercent(benchmarks.apc, 1)}, Physician {formatPercent(benchmarks.physician, 1)}.
      {/if}
      Reference lines intentionally omitted from charts.
    </footer>
  {/if}
</div>
