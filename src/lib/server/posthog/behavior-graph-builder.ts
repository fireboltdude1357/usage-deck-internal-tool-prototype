import type { Client } from "$lib/schema/snapshot"
import type { ProcessedGraph, Session, RawTransition } from "$lib/behavior-graph/types"
import { classifyUrl } from "$lib/behavior-graph/classify-url"
import { aggregate } from "$lib/behavior-graph/aggregate"

const SESSION_GAP_MINUTES = 30
const MIN_PAGE_LOADS_PER_SESSION = 3
const MAX_SESSIONS = 100

export interface RawPageLoadEvent {
  timestamp: string
  distinct_id: string
  url: string
}

export interface BuildOptions {
  client: Client
  sessionGapMinutes?: number
  minPageLoadsPerSession?: number
  maxSessions?: number
  minTransitionCount?: number
}

export interface BehaviorGraphResult {
  graph: ProcessedGraph
  sessions: Session[]
}

export function buildBehaviorGraph(
  events: RawPageLoadEvent[],
  opts: BuildOptions,
): BehaviorGraphResult {
  const gapMs = (opts.sessionGapMinutes ?? SESSION_GAP_MINUTES) * 60 * 1000
  const minPageLoads = opts.minPageLoadsPerSession ?? MIN_PAGE_LOADS_PER_SESSION
  const maxSessions = opts.maxSessions ?? MAX_SESSIONS
  const minTransitionCount = opts.minTransitionCount ?? 0

  // Group by distinct_id; raw events arrive in timestamp-DESC order from the
  // single capped query, so we sort each user's slice ASC before splitting.
  const byUser = new Map<string, RawPageLoadEvent[]>()
  let droppedEmpty = 0
  for (const ev of events) {
    if (!ev.distinct_id || !ev.url) {
      droppedEmpty++
      continue
    }
    const list = byUser.get(ev.distinct_id)
    if (list) list.push(ev)
    else byUser.set(ev.distinct_id, [ev])
  }
  for (const list of byUser.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  }
  console.log(
    `[bgraph] builder grouped events=${events.length} users=${byUser.size} dropped(emptyId/url)=${droppedEmpty}`,
  )

  const allSessions: Session[] = []
  let candidateSessions = 0
  let sessionsBelowMinPageLoads = 0

  for (const [user, userEvents] of byUser) {
    // Within each user, events are chronological (ORDER BY distinct_id, timestamp).
    let sessionStart = 0
    for (let i = 1; i <= userEvents.length; i++) {
      const isLast = i === userEvents.length
      const gap = isLast
        ? Infinity
        : Date.parse(userEvents[i].timestamp) - Date.parse(userEvents[i - 1].timestamp)

      if (gap > gapMs || isLast) {
        const slice = userEvents.slice(sessionStart, i)
        if (slice.length > 0) candidateSessions++
        if (slice.length >= minPageLoads) {
          const sessionIndex = allSessions.filter((s) => s.user === user).length
          const startMs = Date.parse(slice[0].timestamp)
          const endMs = Date.parse(slice[slice.length - 1].timestamp)
          if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
            console.warn(
              `[bgraph] builder NaN timestamp user=${user} start=${slice[0].timestamp} end=${slice[slice.length - 1].timestamp} — session skipped`,
            )
          } else {
            allSessions.push({
              sessionId: `${user}__${sessionIndex}`,
              user,
              startTime: slice[0].timestamp,
              endTime: slice[slice.length - 1].timestamp,
              durationMs: endMs - startMs,
              pageCount: slice.length,
              events: slice.map((e) => ({ url: e.url, timestamp: e.timestamp })),
            })
          }
        } else if (slice.length > 0) {
          sessionsBelowMinPageLoads++
        }
        sessionStart = i
      }
    }
  }

  // Sort descending by startTime, keep most-recent N
  allSessions.sort((a, b) => b.startTime.localeCompare(a.startTime))
  const sessions = allSessions.slice(0, maxSessions)
  console.log(
    `[bgraph] builder sessions candidates=${candidateSessions} kept(≥${minPageLoads}pages)=${allSessions.length} dropped(<${minPageLoads}pages)=${sessionsBelowMinPageLoads} capped(max ${maxSessions})=${sessions.length}`,
  )

  // Build transition counts from the capped session set
  const transitionCounts = new Map<string, { from: string; to: string; count: number }>()
  const reloadCounts = new Map<string, number>()
  let classifiedEvents = 0
  let droppedNullClass = 0
  let droppedOtherClass = 0

  for (const session of sessions) {
    // Classify and collapse consecutive duplicates per session
    const states: string[] = []
    for (const ev of session.events) {
      const state = classifyUrl(ev.url)
      if (!state) {
        droppedNullClass++
        continue
      }
      if (state === "Other") {
        droppedOtherClass++
        continue
      }
      classifiedEvents++
      if (states.length > 0 && states[states.length - 1] === state) {
        // Same state as previous — count as reload
        reloadCounts.set(state, (reloadCounts.get(state) ?? 0) + 1)
      } else {
        states.push(state)
      }
    }

    // Count transitions between consecutive collapsed states
    for (let i = 1; i < states.length; i++) {
      const from = states[i - 1]
      const to = states[i]
      // Canonical key: lexicographic ordering
      const [a, b] = from < to ? [from, to] : [to, from]
      const key = `${a}||${b}`
      const existing = transitionCounts.get(key)
      if (existing) {
        existing.count += 1
      } else {
        transitionCounts.set(key, { from: a, to: b, count: 1 })
      }
    }
  }

  // Build RawTransition list for the aggregator, incorporating self-loop reloads
  const raw: RawTransition[] = []
  for (const t of transitionCounts.values()) {
    raw.push({ from: t.from, to: t.to, count: t.count })
  }
  // Self-loops from reload counts
  for (const [state, count] of reloadCounts) {
    raw.push({ from: state, to: state, count })
  }

  console.log(
    `[bgraph] builder classify classified=${classifiedEvents} dropped(null)=${droppedNullClass} dropped(Other)=${droppedOtherClass} transitions(unique)=${transitionCounts.size} reloads(states)=${reloadCounts.size}`,
  )

  const graph = aggregate(raw, opts.client, minTransitionCount)
  console.log(
    `[bgraph] builder aggregate nodes=${graph.nodes.length} edges=${graph.edges.length} totalTransitions=${graph.meta.totalTransitions} minTransitionCount=${minTransitionCount}`,
  )

  return { graph, sessions }
}
