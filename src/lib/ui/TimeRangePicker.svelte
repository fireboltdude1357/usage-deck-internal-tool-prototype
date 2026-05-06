<script lang="ts">
  import { selection } from "$lib/selection.svelte"
  import type { Month } from "$lib/schema/snapshot"

  // Available months in the v1 BSMH fixture window. Phase 03+ widens this.
  const MONTHS = [
    "2025-08",
    "2025-09",
    "2025-10",
    "2025-11",
    "2025-12",
    "2026-01",
    "2026-02",
  ] as const

  const onStart = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement
    selection.set({ start: target.value as Month })
  }
  const onEnd = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement
    selection.set({ end: target.value as Month })
  }
</script>

<div class="flex items-center gap-2 text-sm">
  <span class="text-slate-500">Range</span>
  <select
    class="rounded border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
    value={selection.start}
    onchange={onStart}
  >
    {#each MONTHS as m (m)}
      <option value={m}>{m}</option>
    {/each}
  </select>
  <span class="text-slate-400">→</span>
  <select
    class="rounded border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
    value={selection.end}
    onchange={onEnd}
  >
    {#each MONTHS as m (m)}
      <option value={m}>{m}</option>
    {/each}
  </select>
</div>
