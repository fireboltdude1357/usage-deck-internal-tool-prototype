<script lang="ts">
  import { invalidate } from "$app/navigation"
  import type { Client } from "$lib/schema/snapshot"
  import { selection } from "$lib/selection.svelte"

  const SYSTEMS: { id: Client; label: string }[] = [
    { id: "bsmh", label: "BSMH" },
    { id: "ssm", label: "SSM" },
    { id: "duke", label: "Duke" },
    { id: "ucsf", label: "UCSF" },
  ]

  const onChange = (e: Event): void => {
    const target = e.currentTarget as HTMLSelectElement
    selection.setSystem(target.value as Client)
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
      <option value={sys.id}>{sys.label}</option>
    {/each}
  </select>
</label>
