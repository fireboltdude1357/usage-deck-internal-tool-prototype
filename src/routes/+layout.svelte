<script lang="ts">
  import "../app.css"
  import TopBar from "$lib/ui/TopBar.svelte"

  let { children } = $props()
</script>

<TopBar />
<main class="mx-auto max-w-7xl px-4 py-6">
  {@render children()}
</main>
