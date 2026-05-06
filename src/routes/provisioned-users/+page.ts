import { browser } from "$app/environment"
import { Schema } from "effect"
import { ProvisionedUsersSnapshot } from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import type { PageLoad } from "./$types"

export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser) return { snapshot: null, loadError: null }
  const res = await fetch(
    `/api/snapshot/${selection.system}/2026-04/provisioned_users.json`,
  )
  if (!res.ok) {
    return {
      snapshot: null,
      loadError: `Failed to load provisioned users (${res.status})`,
    }
  }
  const raw = await res.json()
  return {
    snapshot: Schema.decodeUnknownSync(ProvisionedUsersSnapshot)(raw),
    loadError: null,
  }
}
