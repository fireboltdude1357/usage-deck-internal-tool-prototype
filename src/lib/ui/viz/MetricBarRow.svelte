<script lang="ts">
  // One pre/post comparison row inside a ProviderCard. Mirrors the iter-12
  // investigation HTML: label + ▲/— badge + dual horizontal bars (pre on top,
  // post below) scaled to the larger of the two values.
  let {
    label,
    pre,
    post,
    pct,
    improved,
    unit = "",
    decimals = 1,
    formatPre,
    formatPost,
  }: {
    label: string
    pre: number | null
    post: number | null
    pct: number | null
    improved: boolean
    unit?: string
    decimals?: number
    formatPre?: (v: number | null) => string
    formatPost?: (v: number | null) => string
  } = $props()

  const defaultFmt = (v: number | null) => {
    if (v === null) return "N/A"
    return decimals === 0
      ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  }
  const fmtPre = $derived(formatPre ?? defaultFmt)
  const fmtPost = $derived(formatPost ?? defaultFmt)
  const fmtPct = (p: number | null) => {
    if (p === null) return "N/A"
    const v = p * 100
    return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`
  }

  const max = $derived(Math.max(Math.abs(pre ?? 0), Math.abs(post ?? 0)) || 1)
  const preWidth = $derived(Math.min(100, Math.max(2, (Math.abs(pre ?? 0) / max) * 100)))
  const postWidth = $derived(Math.min(100, Math.max(2, (Math.abs(post ?? 0) / max) * 100)))
</script>

<div class="space-y-1.5">
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      {#if improved}
        <span
          class="inline-flex h-4 w-4 items-center justify-center rounded-full bg-teal-600 text-white"
          aria-label="improved"
        >
          <svg viewBox="0 0 12 12" class="h-2.5 w-2.5" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 6l3 3 5-5" />
          </svg>
        </span>
      {:else}
        <span class="inline-flex h-4 w-4 items-center justify-center text-slate-300">—</span>
      {/if}
      <span class="text-sm font-medium text-slate-700">{label}</span>
    </div>
    <span
      class="rounded px-2 py-0.5 text-xs font-semibold tabular-nums
        {improved ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}"
    >
      {fmtPct(pct)}
    </span>
  </div>

  <div class="ml-6 space-y-1">
    <div class="flex items-center gap-2">
      <span class="w-12 text-xs text-slate-400">Before</span>
      <div class="relative h-2.5 flex-1 rounded bg-slate-100">
        <div class="h-full rounded bg-slate-400" style:width="{preWidth}%"></div>
      </div>
      <span class="w-20 text-right text-xs tabular-nums text-slate-500">
        {fmtPre(pre)}{unit}
      </span>
    </div>
    <div class="flex items-center gap-2">
      <span class="w-12 text-xs text-slate-400">After</span>
      <div class="relative h-2.5 flex-1 rounded bg-slate-100">
        <div
          class="h-full rounded {improved ? 'bg-teal-500' : 'bg-slate-400'}"
          style:width="{postWidth}%"
        ></div>
      </div>
      <span
        class="w-20 text-right text-xs font-medium tabular-nums
          {improved ? 'text-teal-700' : 'text-slate-500'}"
      >
        {fmtPost(post)}{unit}
      </span>
    </div>
  </div>
</div>
