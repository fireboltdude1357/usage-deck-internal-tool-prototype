import { browser } from "$app/environment"
import { Schema } from "effect"
import { ProvisionedUsersSnapshot } from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import { refresh } from "$lib/refresh.svelte"
import { LATEST_SNAPSHOT_MONTH } from "$lib/snapshot-months"
import type { PageLoad } from "./$types"

// Live PostHog already produces total/lima/user_detail; no roster merge needed.
// Snapshot is only used as the 503 (POSTHOG_API_KEY unset) fallback so dev
// without a key still renders something. Snapshot month is per-client — see
// $lib/snapshot-months.ts.

export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser)
    return { snapshot: null, loadError: null, source: null as null | "posthog" | "fixture" }

  const refreshFlag = refresh.nonce > 0 ? "&refresh=1" : ""
  const live = await fetch(
    `/api/posthog/${selection.system}/provisioned?start=${selection.start}&end=${selection.end}${refreshFlag}`,
  )
  if (live.ok) {
    const raw = await live.json()
    return {
      snapshot: Schema.decodeUnknownSync(ProvisionedUsersSnapshot)(raw),
      loadError: null,
      source: "posthog" as const,
    }
  }

  if (live.status !== 503) {
    return {
      snapshot: null,
      loadError: `Failed to load provisioned users (${live.status})`,
      source: null,
    }
  }

  const fixture = await fetch(
    `/api/snapshot/${selection.system}/${LATEST_SNAPSHOT_MONTH[selection.system]}/provisioned_users.json`,
  )
  if (!fixture.ok) {
    return {
      snapshot: null,
      loadError: `Failed to load provisioned users (${fixture.status})`,
      source: null,
    }
  }
  const raw = await fixture.json()
  return {
    snapshot: Schema.decodeUnknownSync(ProvisionedUsersSnapshot)(raw),
    loadError: null,
    source: "fixture" as const,
  }
}
