<script lang="ts">
  import { selection, type MarketParam } from "$lib/selection.svelte"

  const MARKETS: MarketParam[] = [
    "all",
    "Hampton Roads",
    "Lorain",
    "Lima",
    "Youngstown",
    "Kentucky",
    "Toledo",
  ]

  const onChange = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement
    selection.set({ market: target.value as MarketParam })
  }
</script>

<label class="flex items-center gap-2 text-sm">
  <span class="text-slate-500">Market</span>
  <select
    class="rounded border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
    value={selection.market}
    onchange={onChange}
  >
    {#each MARKETS as m (m)}
      <option value={m}>{m === "all" ? "All markets" : m}</option>
    {/each}
  </select>
</label>
