<script lang="ts">
  import "../app.css"
  import { navigating, page } from "$app/state"
  import TopBar from "$lib/ui/TopBar.svelte"
  import TopProgressBar from "$lib/ui/TopProgressBar.svelte"
  import LoadingIndicator from "$lib/ui/LoadingIndicator.svelte"

  let { children } = $props()

  // Mirror the TopBar tab list so the browser tab title matches whichever
  // section the user clicked, even before the loader resolves.
  const TAB_LABELS: Record<string, string> = {
    "/platform-engagement": "Platform engagement",
    "/market-engagement": "Market engagement",
    "/provisioned-users": "Provisioned users",
    "/success-stories": "Success stories",
    "/adoption-engagement": "Adoption vs. engagement",
    "/behavior-graph": "Behavior graph",
    "/turnover": "Turnover",
  }

  // Tab→tab navigation: SvelteKit holds the *previous* page on screen until
  // the new loader resolves, which makes long PostHog queries feel frozen.
  // Replace the page body with the loading indicator while navigating to a
  // different pathname. Same-pathname invalidations (RefreshButton, picker
  // changes) keep the current page visible; the top bar covers those.
  const switchingPages = $derived(
    navigating.to !== null && navigating.to.url.pathname !== page.url.pathname,
  )

  const activePath = $derived(navigating.to?.url.pathname ?? page.url.pathname)
  const pageTitle = $derived(
    TAB_LABELS[activePath]
      ? `${TAB_LABELS[activePath]} · internal-tool`
      : "internal-tool",
  )
</script>

<svelte:head>
  <title>{pageTitle}</title>
</svelte:head>

<TopProgressBar />
<TopBar />
<main class="mx-auto max-w-7xl px-4 py-6">
  {#if switchingPages}
    <LoadingIndicator />
  {:else}
    {@render children()}
  {/if}
</main>
