<script lang="ts">
  import { invalidate } from "$app/navigation"
  import type { Client } from "$lib/schema/snapshot"
  import { selection } from "$lib/selection.svelte"

  // BSMH is the only system with v1 fixtures; the others are visible-but-disabled
  // so the menu hints at what's coming next.
  const SYSTEMS: { id: Client; label: string; available: boolean }[] = [
    { id: "bsmh", label: "BSMH", available: true },
    { id: "ssm", label: "SSM", available: false },
    { id: "duke", label: "Duke", available: false },
    { id: "ucsf", label: "UCSF", available: false },
  ]

  const onChange = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement
    selection.set({ system: target.value as Client })
    invalidate("app:selection")
  }
</script>

<label class="flex items-center gap-2 text-sm">
  <span class="text-slate-500">System</span>
  <select
    class="rounded border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
    value={selection.system}
    onchange={onChange}
  >
    {#each SYSTEMS as sys (sys.id)}
      <option value={sys.id} disabled={!sys.available}>
        {sys.label}{sys.available ? "" : " (data not yet available)"}
      </option>
    {/each}
  </select>
</label>
