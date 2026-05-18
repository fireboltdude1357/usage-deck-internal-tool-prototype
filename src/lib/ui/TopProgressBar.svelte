<script lang="ts">
  import { navigating } from "$app/state"
  import { refresh } from "$lib/refresh.svelte"

  // `navigating.to` only fires for real route navigation — not for
  // `invalidate()` re-runs. Combine it with refresh.pending (incremented
  // around every invalidate we initiate) so the bar shows for refreshes
  // and picker changes too.
  const active = $derived(navigating.to !== null || refresh.pending)
</script>

{#if active}
  <div
    class="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-blue-100"
    role="progressbar"
    aria-label="Loading"
  >
    <div class="slider h-full w-1/3 bg-blue-600"></div>
  </div>
{/if}

<style>
  .slider {
    animation: slide 1.1s ease-in-out infinite;
  }
  @keyframes slide {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(400%);
    }
  }
</style>
