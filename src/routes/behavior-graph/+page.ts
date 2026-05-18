import { browser } from "$app/environment"
import { selection } from "$lib/selection.svelte"
import { refresh } from "$lib/refresh.svelte"
import type { ProcessedGraph, Session } from "$lib/behavior-graph/types"
import type { PageLoad } from "./$types"

export const load: PageLoad = async ({ fetch, depends }) => {
  depends("app:selection")
  if (!browser) return { graph: null, sessions: null, loadError: null }

  const refreshFlag = refresh.nonce > 0 ? "&refresh=1" : ""
  const url = `/api/posthog/behavior-graph?client=${selection.system}&from=${selection.start}&to=${selection.end}${refreshFlag}`
  const started = Date.now()
  console.log(`[bgraph] page.load → fetch ${url}`)

  let res: Response
  try {
    res = await fetch(url)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[bgraph] page.load fetch THREW ${Date.now() - started}ms: ${msg}`)
    return {
      graph: null,
      sessions: null,
      loadError: `Fetch failed: ${msg}`,
    }
  }

  const ms = Date.now() - started
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    console.warn(
      `[bgraph] page.load ← ${res.status} ${res.statusText} ${ms}ms body=${body.slice(0, 300)}`,
    )
    return {
      graph: null,
      sessions: null,
      loadError: `Failed to load behavior graph (${res.status}): ${body.slice(0, 200)}`,
    }
  }

  let raw: { graph: ProcessedGraph; sessions: Session[] }
  try {
    raw = await res.json()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[bgraph] page.load JSON parse FAIL ${ms}ms: ${msg}`)
    return {
      graph: null,
      sessions: null,
      loadError: `Bad JSON from behavior-graph endpoint: ${msg}`,
    }
  }

  const graph = raw.graph
  const sessions = raw.sessions
  console.log(
    `[bgraph] page.load ← ok ${ms}ms states=${graph?.meta?.stateCount ?? "?"} edges=${graph?.meta?.edgeCount ?? "?"} sessions=${sessions?.length ?? "?"}`,
  )

  return {
    graph,
    sessions,
    loadError: null,
  }
}
