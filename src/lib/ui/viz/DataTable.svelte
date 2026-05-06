<script lang="ts" generics="T extends Record<string, unknown>">
  type Column = { key: keyof T; label: string }

  let {
    rows,
    columns,
  }: { rows: readonly T[]; columns: readonly Column[] } = $props()

  let sortKey = $state<keyof T | null>(null)
  let sortDir = $state<"asc" | "desc">("desc")

  const sorted = $derived.by(() => {
    if (!sortKey) return [...rows]
    const k = sortKey
    const dir = sortDir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = a[k]
      const bv = b[k]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  })

  const toggleSort = (key: keyof T): void => {
    if (sortKey === key) {
      sortDir = sortDir === "asc" ? "desc" : "asc"
    } else {
      sortKey = key
      sortDir = "desc"
    }
  }
</script>

<div class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
  <table class="min-w-full divide-y divide-slate-200 text-sm">
    <thead class="bg-slate-50">
      <tr>
        {#each columns as col (String(col.key))}
          <th
            class="px-3 py-2 text-left text-xs uppercase tracking-wide text-slate-500 cursor-pointer select-none"
            onclick={() => toggleSort(col.key)}
          >
            {col.label}
            {#if sortKey === col.key}
              <span class="text-slate-400">{sortDir === "asc" ? "▲" : "▼"}</span>
            {/if}
          </th>
        {/each}
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100">
      {#each sorted as row, i (i)}
        <tr class={i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}>
          {#each columns as col (String(col.key))}
            <td class="px-3 py-2 text-slate-700">
              {row[col.key] ?? ""}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>
