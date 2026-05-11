<script lang="ts">
  let {
    value,
    label,
    sub,
    context,
    muted = false,
  }: {
    value: string | number
    label: string
    sub?: string
    context?: string
    muted?: boolean
  } = $props()

  const displayValue = $derived(
    typeof value === "number" ? value.toLocaleString() : value,
  )
</script>

<div class="mb-10 last:mb-0">
  <div
    class="text-[56px] leading-[1.1] font-extrabold mb-1.5
      {muted ? 'text-slate-400' : 'text-slate-900'}"
  >
    {displayValue}
  </div>
  <div class="text-base font-semibold text-slate-900 leading-snug mb-1">
    {label}
  </div>
  {#if sub}
    <div class="text-sm text-slate-400 leading-snug">{sub}</div>
  {/if}
  {#if context}
    <div class="text-sm font-medium text-teal-600 mt-1">{context}</div>
  {/if}
</div>
