<script lang="ts">
  import KpiTile from "$lib/ui/viz/KpiTile.svelte"
  import DataTable from "$lib/ui/viz/DataTable.svelte"
  import ErrorCard from "$lib/ui/ErrorCard.svelte"
  import { filterByMarket } from "$lib/filter"
  import { selection } from "$lib/selection.svelte"
  import type { PageProps } from "./$types"

  let { data }: PageProps = $props()

  const rows = $derived(
    data.snapshot
      ? filterByMarket(data.snapshot.metrics.user_detail, selection.market).map(
          (r) => ({
            email: r.email,
            market: r.market ?? "—",
            page_loads: r.page_loads,
            active_days: r.active_days,
            first_seen: r.first_seen,
            last_seen: r.last_seen,
          }),
        )
      : [],
  )

  const columns = [
    { key: "email" as const, label: "Email" },
    { key: "market" as const, label: "Market" },
    { key: "page_loads" as const, label: "Page loads" },
    { key: "active_days" as const, label: "Active days" },
    { key: "first_seen" as const, label: "First seen" },
    { key: "last_seen" as const, label: "Last seen" },
  ]
</script>

<div class="space-y-6">
  {#if data.loadError}
    <ErrorCard message={data.loadError} />
  {:else if !data.snapshot}
    <div class="text-sm text-slate-500 italic">Loading…</div>
  {:else}
    <section class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <KpiTile kpi={data.snapshot.metrics.total} />
      <KpiTile kpi={data.snapshot.metrics.lima} />
    </section>

    <section>
      <h2 class="mb-3 text-lg font-semibold text-slate-900">User detail</h2>
      <DataTable {rows} {columns} />
      {#if rows.length === 0}
        <div class="mt-3 text-sm text-slate-500 italic">
          No users match the selected market.
        </div>
      {/if}
    </section>
  {/if}
</div>
