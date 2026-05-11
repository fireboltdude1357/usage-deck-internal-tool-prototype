<script lang="ts">
  import ProviderCard from "$lib/ui/viz/ProviderCard.svelte"
  import CategoryBars from "$lib/ui/viz/CategoryBars.svelte"
  import ErrorCard from "$lib/ui/ErrorCard.svelte"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  // Show providers with ≥3 improvements (matches iter-12 messaging).
  const threshold = 3
  const featured = $derived(
    data.derived ? data.derived.providers.filter((p) => p.n_improvements >= threshold) : [],
  )
  const belowThreshold = $derived(
    data.derived ? data.derived.providers.filter((p) => p.n_improvements < threshold) : [],
  )
  const belowCount12 = $derived(belowThreshold.filter((p) => p.n_improvements >= 1).length)
  const belowCount0 = $derived(belowThreshold.filter((p) => p.n_improvements === 0).length)

  const categoryBars = $derived(
    data.derived
      ? [
          { label: "Lower turnover risk", value: data.derived.categories.turnover },
          { label: "Higher patient volume", value: data.derived.categories.volume },
          { label: "More time with patients", value: data.derived.categories.time_with_patients },
          { label: "More efficient workflows", value: data.derived.categories.efficiency },
          { label: "Higher work RVUs", value: data.derived.categories.rvu },
        ]
      : [],
  )
</script>

<div class="space-y-6">
  {#if data.snapshotError}
    <ErrorCard message={data.snapshotError} />
  {:else if data.rangeTooSmall}
    <div class="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
      The selected range doesn't have enough months for a pre/post comparison.
      Widen the range to cover at least two months of available data.
    </div>
  {:else if !data.derived}
    <div class="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
      No success-stories snapshot exists for this client yet.
    </div>
  {:else}
    {#if data.cohortError}
      <div class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <strong>Heads up:</strong> {data.cohortError}
      </div>
    {/if}

    <section class="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
      <div class="text-center">
        <div class="text-6xl font-bold text-teal-600">{featured.length}</div>
        <div class="mt-1 text-base font-semibold text-teal-600">
          providers improved on 3+ of 5 metrics
        </div>
        <div class="mx-auto mt-2 max-w-xl text-sm text-slate-500">
          {#if data.derived.cohortApplied}
            {data.derived.funnel.cohort} providers viewed in PostHog
            → {data.derived.funnel.analyzed} with sufficient data analyzed
            (gate ≥ {data.derived.min_pre_procedures} pre procedures).
          {:else}
            {data.derived.funnel.analyzed} analyzable providers in the model
            (gate ≥ {data.derived.min_pre_procedures} pre procedures, cohort filter unavailable).
          {/if}
          Pre = {data.derived.pre_months.join(", ")}.
          Post = {data.derived.post_months.join(", ")}.
        </div>
        <div class="mt-4 flex flex-wrap justify-center gap-2">
          <span class="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {data.derived.funnel.by_improvement_count.five} improved on 5/5
          </span>
          <span class="rounded-full bg-teal-100 px-3 py-1 text-xs font-semibold text-teal-700">
            {data.derived.funnel.by_improvement_count.four} on 4/5
          </span>
          <span class="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
            {data.derived.funnel.by_improvement_count.three} on 3/5
          </span>
        </div>
      </div>
    </section>

    <section>
      <CategoryBars bars={categoryBars} title="Improvements by category (all analyzed providers)" />
    </section>

    <section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {#each featured as p (p.provider_id)}
        <ProviderCard provider={p} />
      {/each}
    </section>

    {#if belowThreshold.length > 0}
      <div class="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <strong>{belowThreshold.length} additional providers</strong> improved on fewer than 3 metrics
        and are not shown above ({belowCount12} improved on 1–2 metrics, {belowCount0} showed no improvement).
      </div>
    {/if}
  {/if}
</div>
