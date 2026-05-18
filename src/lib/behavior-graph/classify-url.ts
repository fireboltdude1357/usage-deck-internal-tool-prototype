// Handles all URL eras simultaneously. Era 2 uses `/regions/` paths; era 3
// uses `/units/`, `/physicians/units/`, `/nurses/units/`. Both are classified
// here — dropping any era silently loses pre-Oct 2025 data (CLAUDE.md hard rule).
export function classifyUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const path = url.split("?")[0].split("#")[0]
  if (path.startsWith("/ingest") || path.startsWith("/.well-known")) return null

  if (path === "/" || path === "/home" || path === "/home/") return "Home"

  // Era 3 location paths
  if (path === "/units" || path === "/units/") return "Units List"
  if (path.startsWith("/units/")) {
    const parts = path.replace(/\/$/, "").split("/")
    return parts.length >= 4 ? "Provider in Unit" : "Unit Detail"
  }
  if (path.startsWith("/physicians/units/") || path.startsWith("/nurses/units/")) {
    return "Provider in Unit"
  }

  // Era 2 location paths
  if (path === "/regions" || path === "/regions/") return "Units List"
  if (path.startsWith("/regions/")) {
    if (path.includes("tasks") || path.includes("initiatives")) return "Region Task"
    const parts = path.replace(/\/$/, "").split("/")
    return parts.length >= 4 ? "Provider in Region" : "Region Detail"
  }

  // Shared across eras
  if (path === "/providers" || path === "/providers/") return "Providers List"
  if (path.startsWith("/provider")) return "Provider Detail"
  if (path.startsWith("/risk-factors")) return "Risk Factors"
  if (path.startsWith("/interventions")) return "Interventions"
  if (path.startsWith("/execdash")) return "Exec Dashboard"
  if (path.startsWith("/glossary")) return "Glossary"
  if (path.startsWith("/settings")) {
    if (path.includes("filters/new")) return "New Filter"
    if (path.includes("filters")) return "Filters"
    return "Settings"
  }
  if (path.startsWith("/admin")) return "Admin"

  return "Other"
}
