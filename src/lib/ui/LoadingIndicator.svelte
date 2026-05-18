<script lang="ts">
  import { onMount, onDestroy } from "svelte"

  let {
    label = "Querying PostHog…",
    hint = "Cold queries can take 30–60s.",
  }: { label?: string; hint?: string } = $props()

  let elapsed = $state(0)
  let timer: ReturnType<typeof setInterval> | null = null

  onMount(() => {
    const started = Date.now()
    timer = setInterval(() => {
      elapsed = Math.floor((Date.now() - started) / 1000)
    }, 250)
  })

  onDestroy(() => {
    if (timer) clearInterval(timer)
  })
</script>

<div
  class="flex flex-col items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-6 py-10 text-center"
  role="status"
  aria-live="polite"
>
  <div class="relative h-8 w-8">
    <span
      class="absolute inset-0 inline-block animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
      aria-hidden="true"
    ></span>
  </div>
  <div class="text-sm font-medium text-slate-900">{label}</div>
  <div class="text-xs text-slate-500">
    {elapsed}s elapsed · {hint}
  </div>
</div>
