import { browser } from "$app/environment"
import { Schema } from "effect"
import { PlatformSnapshot } from "$lib/schema/snapshot"
import { selection } from "$lib/selection.svelte"
import { refresh } from "$lib/refresh.svelte"
import type { PageLoad } from "./$types"

// Phase 02: prefer live PostHog data; fall back to the fixture snapshot when
// the PostHog route returns 503 (POSTHOG_API_KEY unset, e.g., dev without a key).
const FETCH_WINDOW = { start: "2025-08", end: "2026-02" } as const
const FIXTURE_SNAPSHOT_MONTH = "2026-04"

export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser) return { snapshot: null, loadError: null, source: null }

  const refreshFlag = refresh.nonce > 0 ? "&refresh=1" : ""
  const live = await fetch(
    `/api/posthog/${selection.system}/metrics?start=${FETCH_WINDOW.start}&end=${FETCH_WINDOW.end}${refreshFlag}`,
  )
  if (live.ok) {
    const raw = await live.json()
    return {
      snapshot: Schema.decodeUnknownSync(PlatformSnapshot)(raw),
      loadError: null,
      source: "posthog" as const,
    }
  }

  // 503 == PostHog not configured; quietly fall back. Anything else is a real failure.
  if (live.status !== 503) {
    return {
      snapshot: null,
      loadError: `Failed to load platform metrics (${live.status})`,
      source: null,
    }
  }

  const fixture = await fetch(
    `/api/snapshot/${selection.system}/${FIXTURE_SNAPSHOT_MONTH}/metrics.json`,
  )
  if (!fixture.ok) {
    return {
      snapshot: null,
      loadError: `Failed to load platform metrics (${fixture.status})`,
      source: null,
    }
  }
  const raw = await fixture.json()
  return {
    snapshot: Schema.decodeUnknownSync(PlatformSnapshot)(raw),
    loadError: null,
    source: "fixture" as const,
  }
}
