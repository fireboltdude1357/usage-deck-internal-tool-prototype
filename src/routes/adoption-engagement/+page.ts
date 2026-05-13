import { browser } from "$app/environment"
import { Schema } from "effect"
import { AdoptionEngagementSnapshot } from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import { refresh } from "$lib/refresh.svelte"
import { LATEST_SNAPSHOT_MONTH } from "$lib/snapshot-months"
import type { PageLoad } from "./$types"

// Prefer live PostHog data; fall back to the fixture snapshot only when the
// PostHog route returns 503 (POSTHOG_API_KEY unset). Same pattern as the other
// page loaders.
export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser) return { snapshot: null, loadError: null, source: null }

  const refreshFlag = refresh.nonce > 0 ? "&refresh=1" : ""
  const live = await fetch(
    `/api/posthog/${selection.system}/adoption-engagement?start=${selection.start}&end=${selection.end}${refreshFlag}`,
  )
  if (live.ok) {
    const raw = await live.json()
    return {
      snapshot: Schema.decodeUnknownSync(AdoptionEngagementSnapshot)(raw),
      loadError: null,
      source: "posthog" as const,
    }
  }

  if (live.status !== 503) {
    return {
      snapshot: null,
      loadError: `Failed to load adoption/engagement metrics (${live.status})`,
      source: null,
    }
  }

  const fixture = await fetch(
    `/api/snapshot/${selection.system}/${LATEST_SNAPSHOT_MONTH[selection.system]}/adoption_engagement.json`,
  )
  if (!fixture.ok) {
    return {
      snapshot: null,
      loadError: `Failed to load adoption/engagement metrics (${fixture.status})`,
      source: null,
    }
  }
  const raw = await fixture.json()
  return {
    snapshot: Schema.decodeUnknownSync(AdoptionEngagementSnapshot)(raw),
    loadError: null,
    source: "fixture" as const,
  }
}
