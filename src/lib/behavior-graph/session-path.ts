import type { Session, PathStep } from "./types"
import { classifyUrl } from "./classify-url"

/**
 * Convert a session's raw URL events into a sequence of classified state
 * hops. Consecutive duplicate states are collapsed into a single PathStep
 * with an `eventCount` reflecting how many raw page loads landed on that
 * state. Events classified to `Other` or null (ingest/unknown) are dropped.
 */
export function sessionPath(session: Session): PathStep[] {
  const steps: PathStep[] = []
  for (const ev of session.events) {
    const state = classifyUrl(ev.url)
    if (!state || state === "Other") continue
    const last = steps[steps.length - 1]
    if (last && last.state === state) {
      last.eventCount += 1
      last.endTime = ev.timestamp
    } else {
      steps.push({
        state,
        eventCount: 1,
        startTime: ev.timestamp,
        endTime: ev.timestamp,
      })
    }
  }
  return steps
}

/** Canonical edge id (matches `aggregate.ts`): lexicographic `${a}||${b}`. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}||${b}` : `${b}||${a}`
}

/** Directional edge id — matches the ids graph-canvas assigns after splitting bidi edges. */
export function dirKey(from: string, to: string): string {
  return `${from}→${to}`
}

/** Set of canonical (unordered) edge ids used by a session path. */
export function pathEdgeSet(steps: PathStep[]): Set<string> {
  const set = new Set<string>()
  for (let i = 1; i < steps.length; i++) {
    if (steps[i - 1].state === steps[i].state) continue
    set.add(pairKey(steps[i - 1].state, steps[i].state))
  }
  return set
}

/** Set of directional edge ids used by a session path. */
export function pathDirEdgeSet(steps: PathStep[]): Set<string> {
  const set = new Set<string>()
  for (let i = 1; i < steps.length; i++) {
    if (steps[i - 1].state === steps[i].state) continue
    set.add(dirKey(steps[i - 1].state, steps[i].state))
  }
  return set
}
