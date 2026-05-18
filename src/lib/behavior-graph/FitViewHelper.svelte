<script lang="ts">
  import { useSvelteFlow } from "@xyflow/svelte"

  // Called inside <SvelteFlow> so useSvelteFlow() has the right Svelte context.
  const { fitView } = useSvelteFlow()

  let { graphKey }: { graphKey: string } = $props()

  $effect(() => {
    // Depends on graphKey: runs on initial appearance and whenever the graph
    // changes (client/range switch). Does NOT depend on selectedSession.
    const _key = graphKey
    // Slight delay lets dagre-laid-out nodes commit to DOM before fitting.
    const id = setTimeout(() => fitView({ duration: 300 }), 50)
    return () => clearTimeout(id)
  })
</script>
