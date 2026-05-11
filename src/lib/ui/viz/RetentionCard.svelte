<script lang="ts">
  import MetricBlock from "./MetricBlock.svelte"

  type Metric = {
    value: string | number
    label: string
    sub?: string
    context?: string
  }

  let {
    title,
    kicker,
    leftHeader,
    leftMetrics,
    rightHeader,
    rightMetrics,
    bottomTitle = "Platform Engagement",
    bottomMetrics,
    footnote,
    highlighted = false,
  }: {
    title: string
    kicker?: string
    leftHeader: string
    leftMetrics: readonly Metric[]
    rightHeader: string
    rightMetrics: readonly Metric[]
    bottomTitle?: string
    bottomMetrics: readonly Metric[]
    footnote?: string
    highlighted?: boolean
  } = $props()
</script>

<div
  class="bg-white border rounded-md p-12 max-w-[1200px] mx-auto
    {highlighted ? 'border-teal-500 ring-2 ring-teal-100' : 'border-slate-200'}"
>
  {#if kicker}
    <div
      class="text-xs uppercase tracking-[0.15em] font-semibold text-slate-600 mb-1.5"
    >
      {kicker}
    </div>
  {/if}
  <div class="text-3xl font-bold text-slate-900 mb-2">{title}</div>
  <div class="w-12 h-1 bg-teal-600 mb-12"></div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-8">
    <div>
      <div class="flex items-center gap-2.5 mb-9">
        <div class="w-1 h-[18px] bg-teal-600 flex-shrink-0"></div>
        <div
          class="text-xs uppercase tracking-[0.15em] font-semibold text-slate-600"
        >
          {leftHeader}
        </div>
      </div>
      {#each leftMetrics as m, i (i)}
        <MetricBlock
          value={m.value}
          label={m.label}
          sub={m.sub}
          context={m.context}
        />
      {/each}
    </div>

    <div>
      <div class="flex items-center gap-2.5 mb-9">
        <div class="w-1 h-[18px] bg-teal-600 flex-shrink-0"></div>
        <div
          class="text-xs uppercase tracking-[0.15em] font-semibold text-slate-600"
        >
          {rightHeader}
        </div>
      </div>
      {#each rightMetrics as m, i (i)}
        <MetricBlock
          value={m.value}
          label={m.label}
          sub={m.sub}
          context={m.context}
        />
      {/each}
    </div>
  </div>

  <hr class="border-t border-slate-200 my-12" />

  <div>
    <div class="text-2xl font-bold text-slate-900 mb-2">{bottomTitle}</div>
    <div class="w-12 h-1 bg-teal-600 mb-9"></div>

    <div class="grid grid-cols-1 md:grid-cols-3 gap-12">
      {#each bottomMetrics as m, i (i)}
        <MetricBlock
          value={m.value}
          label={m.label}
          sub={m.sub}
          context={m.context}
        />
      {/each}
    </div>
  </div>

  {#if footnote}
    <div class="text-xs text-slate-400 leading-relaxed mt-12 whitespace-pre-line">
      {footnote}
    </div>
  {/if}
</div>
