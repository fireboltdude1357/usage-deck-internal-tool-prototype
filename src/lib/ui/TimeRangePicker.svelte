<script lang="ts">
  import { invalidate } from "$app/navigation"
  import { selection } from "$lib/selection.svelte"
  import type { Month } from "$lib/schema/snapshot"
  import { AVAILABLE_MONTHS } from "$lib/snapshot-months"

  // selection.setSystem() snaps start/end into AVAILABLE_MONTHS[system]
  // whenever the client changes, so this $derived can repopulate without
  // worrying about stale months in the bound <select> values.
  const months = $derived(AVAILABLE_MONTHS[selection.system])

  const onStart = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement
    selection.set({ start: target.value as Month })
    invalidate("app:selection")
  }
  const onEnd = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement
    selection.set({ end: target.value as Month })
    invalidate("app:selection")
  }
</script>

<div class="flex items-center gap-2 text-sm">
  <span class="text-slate-500">Range</span>
  <select
    class="rounded border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
    value={selection.start}
    onchange={onStart}
  >
    {#each months as m (m)}
      <option value={m}>{m}</option>
    {/each}
  </select>
  <span class="text-slate-400">→</span>
  <select
    class="rounded border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
    value={selection.end}
    onchange={onEnd}
  >
    {#each months as m (m)}
      <option value={m}>{m}</option>
    {/each}
  </select>
</div>
