<script lang="ts">
  import { page } from "$app/state"
  import SystemPicker from "./SystemPicker.svelte"
  import MarketPicker from "./MarketPicker.svelte"
  import TimeRangePicker from "./TimeRangePicker.svelte"
  import RefreshButton from "./RefreshButton.svelte"

  const TABS = [
    { href: "/platform-engagement", label: "Platform engagement" },
    { href: "/market-engagement", label: "Market engagement" },
    { href: "/provisioned-users", label: "Provisioned users" },
  ]
</script>

<header class="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
  <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
    <div class="text-sm font-semibold tracking-wide text-slate-900">
      internal-tool
    </div>
    <div class="ml-auto flex flex-wrap items-center gap-3">
      <SystemPicker />
      <MarketPicker />
      <TimeRangePicker />
      <RefreshButton />
    </div>
  </div>
  <nav class="mx-auto flex max-w-7xl items-center gap-1 px-4">
    {#each TABS as tab (tab.href)}
      {@const active = page.url.pathname === tab.href}
      <a
        href={tab.href}
        class="border-b-2 px-3 py-2 text-sm
          {active
            ? 'border-blue-600 text-blue-700'
            : 'border-transparent text-slate-600 hover:text-slate-900'}"
      >
        {tab.label}
      </a>
    {/each}
  </nav>
</header>
