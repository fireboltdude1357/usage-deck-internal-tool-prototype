import type { ClusterId } from "./types"

export const CLUSTER_META: Record<
  ClusterId,
  { label: string; color: string; fillcolor: string; fontcolor: string }
> = {
  home: {
    label: "Home",
    color: "#2563EB",
    fillcolor: "#DBEAFE",
    fontcolor: "#1E3A8A",
  },
  browse: {
    label: "Browse",
    color: "#059669",
    fillcolor: "#D1FAE5",
    fontcolor: "#065F46",
  },
  "drill-down": {
    label: "Drill Down",
    color: "#D97706",
    fillcolor: "#FEF3C7",
    fontcolor: "#92400E",
  },
  "provider-analysis": {
    label: "Provider Analysis",
    color: "#DC2626",
    fillcolor: "#FEE2E2",
    fontcolor: "#991B1B",
  },
  configuration: {
    label: "Configuration",
    color: "#7C3AED",
    fillcolor: "#EDE9FE",
    fontcolor: "#5B21B6",
  },
}

const STATE_TO_CLUSTER: Record<string, ClusterId> = {
  "Home": "home",
  "Providers List": "browse",
  "Glossary": "browse",
  "Exec Dashboard": "browse",
  "Units List": "drill-down",
  "Unit Detail": "drill-down",
  "Region Detail": "drill-down",
  "Provider in Region": "drill-down",
  "Provider in Unit": "drill-down",
  "Region Task": "drill-down",
  "Provider Detail": "provider-analysis",
  "Risk Factors": "provider-analysis",
  "Interventions": "provider-analysis",
  "Filters": "configuration",
  "New Filter": "configuration",
  "Settings": "configuration",
  "Admin": "configuration",
}

export function clusterFor(state: string): ClusterId | null {
  return STATE_TO_CLUSTER[state] ?? null
}
