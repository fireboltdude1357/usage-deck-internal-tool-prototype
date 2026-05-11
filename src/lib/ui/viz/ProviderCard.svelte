<script lang="ts">
  import MetricBarRow from "./MetricBarRow.svelte"
  import type { ProviderDerived } from "$lib/success-stories"

  let { provider }: { provider: ProviderDerived } = $props()

  // Tier badge — gold (5/5) → teal (4/5) → blue (3/5) → slate.
  const badgeClasses = $derived(
    provider.n_improvements === 5
      ? "bg-amber-100 text-amber-800"
      : provider.n_improvements === 4
        ? "bg-teal-100 text-teal-700"
        : provider.n_improvements === 3
          ? "bg-blue-100 text-blue-700"
          : "bg-slate-100 text-slate-600",
  )

  const fmtPct = (v: number | null) => {
    if (v === null) return "N/A"
    return `${(v * 100).toFixed(2)}%`
  }
  const fmt0 = (v: number | null) => (v === null ? "N/A" : v.toLocaleString(undefined, { maximumFractionDigits: 0 }))
</script>

<div class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
  <div class="mb-4 flex items-start justify-between gap-3">
    <div class="min-w-0">
      <div class="truncate text-base font-semibold text-slate-900">
        {provider.name}
      </div>
      <div class="truncate text-xs text-slate-500">
        {provider.specialty} · {provider.category} · {provider.department}
      </div>
    </div>
    <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold {badgeClasses}">
      {provider.n_improvements}/5 improved
    </span>
  </div>

  <div class="space-y-3">
    <MetricBarRow
      label="Turnover Risk"
      pre={provider.turnover.pre}
      post={provider.turnover.post}
      pct={provider.turnover.pct}
      improved={provider.turnover.improved}
      formatPre={fmtPct}
      formatPost={fmtPct}
    />
    <MetricBarRow
      label="Patient Volume"
      pre={provider.procedures.pre}
      post={provider.procedures.post}
      pct={provider.procedures.pct}
      improved={provider.volume_improved}
      decimals={0}
      unit=" proc"
      formatPre={fmt0}
      formatPost={fmt0}
    />
    <MetricBarRow
      label="Work RVUs"
      pre={provider.rvu.pre}
      post={provider.rvu.post}
      pct={provider.rvu.pct}
      improved={provider.rvu.improved}
      decimals={1}
    />
    <MetricBarRow
      label="Time with Patients"
      pre={provider.enc_duration.pre}
      post={provider.enc_duration.post}
      pct={provider.enc_duration.pct}
      improved={provider.enc_duration.improved}
      decimals={0}
      unit=" min"
      formatPre={fmt0}
      formatPost={fmt0}
    />
    <MetricBarRow
      label="Workflow Efficiency"
      pre={provider.doc_time.pre}
      post={provider.doc_time.post}
      pct={provider.doc_time.pct}
      improved={provider.efficiency_improved}
      decimals={0}
      unit=" min doc"
      formatPre={fmt0}
      formatPost={fmt0}
    />
  </div>
</div>
