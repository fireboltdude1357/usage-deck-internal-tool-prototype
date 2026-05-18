<script lang="ts">
  import GraphCanvas from "$lib/behavior-graph/GraphCanvas.svelte"
  import SessionsList from "$lib/behavior-graph/SessionsList.svelte"
  import ErrorCard from "$lib/ui/ErrorCard.svelte"
  import LoadingIndicator from "$lib/ui/LoadingIndicator.svelte"
  import { selection } from "$lib/selection.svelte"
  import type { Session } from "$lib/behavior-graph/types"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  let minTransitionCount: number = $state(5)
  let selectedSession: Session | null = $state(null)

  const stateCount = $derived(data.graph?.meta.stateCount ?? 0)
  const edgeCount = $derived(data.graph?.meta.edgeCount ?? 0)
  const totalTransitions = $derived(data.graph?.meta.totalTransitions ?? 0)
  const client = $derived(selection.system)
</script>

<!--
  This page needs a full-viewport canvas below the TopBar. The layout wraps
  children in max-w-7xl padding, so we escape with negative margins. The
  canvas itself is absolutely positioned inside a relative container that
  fills the remaining viewport height.
-->
<div class="-mx-4 -my-6 flex" style="height: calc(100vh - 57px);">
  <!-- Left rail: filters -->
  <aside class="w-56 shrink-0 border-r border-slate-200 bg-white flex flex-col gap-4 p-4 overflow-y-auto">
    <h2 class="text-sm font-semibold text-slate-900">Behavior graph</h2>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Filters</h3>
      <label class="flex flex-col gap-1">
        <span class="text-xs text-slate-600">
          Min transitions: <strong class="text-slate-900">{minTransitionCount}</strong>
        </span>
        <input
          type="range"
          min="0"
          max="50"
          bind:value={minTransitionCount}
          class="w-full accent-blue-600"
        />
      </label>
      <p class="text-xs text-slate-400">
        Edges with fewer total transitions are hidden. Does not trigger a refetch.
      </p>
    </section>
  </aside>

  <!-- Center: canvas -->
  <div class="relative flex-1 min-w-0">
    {#if data.loadError && !data.graph}
      <div class="p-6">
        <ErrorCard message={data.loadError} />
      </div>
    {:else if !data.graph}
      <div class="flex h-full items-center justify-center p-6">
        <LoadingIndicator label="Querying PostHog for behavior graph…" />
      </div>
    {:else}
      <!-- Stats badge -->
      <div
        class="absolute top-3 left-3 z-10 rounded-md border border-slate-200 bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-slate-600 shadow-sm"
        style="pointer-events: none;"
      >
        <span class="font-semibold text-slate-900">{client.toUpperCase()}</span>
        · {stateCount} states
        · {edgeCount} edges
        · {totalTransitions.toLocaleString()} transitions
      </div>

      <!-- Full-height canvas -->
      <div class="absolute inset-0">
        <GraphCanvas
          graph={data.graph}
          {minTransitionCount}
          {selectedSession}
          onClearSession={() => { selectedSession = null }}
        />
      </div>
    {/if}
  </div>

  <!-- Right rail: sessions panel -->
  <aside class="w-80 shrink-0 flex flex-col overflow-hidden">
    <SessionsList
      sessions={data.sessions}
      loading={false}
      error={data.loadError}
      selectedSessionId={selectedSession?.sessionId ?? null}
      onSelect={(s) => { selectedSession = s }}
    />
  </aside>
</div>
