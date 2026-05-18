export type { Client } from "$lib/schema/snapshot"

export type RawTransition = {
  from: string
  to: string
  count: number
}

export type ClusterId =
  | "home"
  | "browse"
  | "drill-down"
  | "provider-analysis"
  | "configuration"

export type GraphNode = {
  id: string
  cluster: ClusterId | null
  reloads: number
}

export type GraphEdge = {
  id: string
  a: string
  b: string
  ab: number
  ba: number
}

export type ProcessedGraph = {
  client: string
  meta: {
    totalTransitions: number
    stateCount: number
    edgeCount: number
  }
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export type SessionEvent = {
  url: string
  timestamp: string
}

export type Session = {
  sessionId: string
  user: string
  startTime: string
  endTime: string
  durationMs: number
  pageCount: number
  events: SessionEvent[]
}

export type SessionsFile = {
  client: string
  generatedAt: string
  sessionCount: number
  sessionGapMinutes: number
  sessions: Session[]
}

/** Classified session path — consecutive duplicate states are collapsed. */
export type PathStep = {
  state: string
  eventCount: number
  startTime: string
  endTime: string
}
