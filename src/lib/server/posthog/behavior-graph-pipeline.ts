import { Effect } from "effect"
import type { Client } from "$lib/schema/snapshot"
import type { ProcessedGraph, Session } from "$lib/behavior-graph/types"
import { rowsToObjects } from "./pagination"
import { pageLoadEventsForBehaviorGraphQuery } from "./behavior-graph-query"
import { buildBehaviorGraph, type RawPageLoadEvent } from "./behavior-graph-builder"
import { runHogQL, type PostHogError } from "./client"
import { cached } from "./cache"
import type { PipelineOptions } from "./pipeline"

const asString = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""))

// Raw page-load events explode at the row level (~thousands per month), so the
// usual fetchByMonth+bisect pattern (built for aggregated rows) cascades into
// dozens of slow queries. Instead, pull the 20k most-recent events for the full
// window in one shot — matches the viewer's Python RAW_EVENT_LIMIT — then sort
// (distinct_id, timestamp) in TS for session synthesis.
const monthBoundsToIso = (startMonth: string, endMonth: string): { from: string; to: string } => {
  const [ey, em] = endMonth.split("-").map(Number)
  const nextY = em === 12 ? ey + 1 : ey
  const nextM = em === 12 ? 1 : em + 1
  return {
    from: `${startMonth}-01`,
    to: `${nextY}-${String(nextM).padStart(2, "0")}-01`,
  }
}

const fetchPageLoadEvents = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<readonly RawPageLoadEvent[], PostHogError> =>
  cached(
    `behavior-graph-events:${client}:${startMonth}:${endMonth}`,
    Effect.suspend(() => {
      const { from, to } = monthBoundsToIso(startMonth, endMonth)
      console.log(
        `[bgraph] fetch events client=${client} window=${from}→${to} (months ${startMonth}..${endMonth})`,
      )
      return runHogQL(pageLoadEventsForBehaviorGraphQuery(client, from, to), {
        label: `behavior-graph-events ${client} ${startMonth}..${endMonth}`,
      }).pipe(
        Effect.tap((res) =>
          Effect.sync(() => {
            console.log(
              `[bgraph] events raw rows=${res.results.length} columns=[${res.columns.join(",")}]`,
            )
            if (res.results.length === 0) {
              console.warn(
                `[bgraph] events EMPTY for client=${client} ${from}→${to} — check email domains / client-username / event name`,
              )
            } else if (res.results.length >= 20000) {
              console.warn(
                `[bgraph] events hit RAW_EVENT_LIMIT (20000) — older events were truncated; consider narrowing window`,
              )
            }
          }),
        ),
        Effect.map((res) => {
          const mapped = rowsToObjects<RawPageLoadEvent>(res.results, res.columns, (r) => ({
            timestamp: asString(r.timestamp),
            distinct_id: asString(r.distinct_id),
            url: asString(r.url),
          }))
          const sample = mapped[0]
          if (sample) {
            console.log(
              `[bgraph] events mapped=${mapped.length} sample.ts=${sample.timestamp} sample.user=${sample.distinct_id} sample.url=${sample.url.slice(0, 80)}`,
            )
          }
          return mapped
        }),
      )
    }),
  )

export interface BehaviorGraphOutput {
  readonly graph: ProcessedGraph
  readonly sessions: readonly Session[]
}

const behaviorGraphImpl = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<BehaviorGraphOutput, PostHogError> =>
  fetchPageLoadEvents(client, startMonth, endMonth).pipe(
    Effect.map((events) => {
      const builderStart = Date.now()
      console.log(`[bgraph] build start events=${events.length} client=${client}`)
      const { graph, sessions } = buildBehaviorGraph(events as RawPageLoadEvent[], {
        client,
      })
      const buildMs = Date.now() - builderStart
      console.log(
        `[bgraph] build done ${buildMs}ms states=${graph.meta.stateCount} edges=${graph.meta.edgeCount} transitions=${graph.meta.totalTransitions} sessions=${sessions.length}`,
      )
      if (graph.meta.stateCount === 0) {
        console.warn(
          `[bgraph] build produced ZERO states — all events were dropped (classify-url returned null/Other for every row?)`,
        )
      }
      if (sessions.length === 0) {
        console.warn(
          `[bgraph] build produced ZERO sessions — every candidate had fewer than minPageLoadsPerSession events`,
        )
      }
      return { graph, sessions }
    }),
  )

export const runBehaviorGraphPipeline = (
  client: Client,
  startMonth: string,
  endMonth: string,
  opts: PipelineOptions = {},
): Effect.Effect<BehaviorGraphOutput, PostHogError> =>
  cached(
    `behavior-graph:${client}:${startMonth}:${endMonth}`,
    behaviorGraphImpl(client, startMonth, endMonth),
    { bypass: opts.refresh },
  )
