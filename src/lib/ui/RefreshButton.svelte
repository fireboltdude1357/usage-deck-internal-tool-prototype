<script lang="ts">
  import { invalidate } from "$app/navigation"
  import { navigating } from "$app/state"
  import { refresh } from "$lib/refresh.svelte"

  const busy = $derived(navigating.to !== null)

  const onClick = async (): Promise<void> => {
    refresh.bump()
    await invalidate("app:selection")
  }
</script>

<button
  type="button"
  onclick={onClick}
  disabled={busy}
  class="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2 py-1 text-sm shadow-sm hover:bg-slate-50 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
  title="Bypass cache and refetch from PostHog"
>
  <span class="inline-block {busy ? 'animate-spin' : ''}" aria-hidden="true">↻</span>
  <span>{busy ? "Refreshing…" : "Refresh"}</span>
</button>
