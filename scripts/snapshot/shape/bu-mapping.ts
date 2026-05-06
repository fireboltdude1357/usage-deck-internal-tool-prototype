import type { Market } from "$lib/schema/snapshot"

// BSMH businessunitname (BU code) → Market.
// Vendored verbatim from
//   parent-db-investigations/.../bsmh-usage-deck/engagement/
//   market-engagement-metrics/10-retention-workflow-visuals/scripts/generate-html.py
// (`BU_CODE_MARKET`). Source of truth is the investigation script; keep in sync
// when the codes change there.
export const BU_CODE_MARKET: Record<string, Market> = {
  "1412": "Hampton Roads",
  "1430": "Hampton Roads",
  "1431": "Hampton Roads",
  "6010": "Lorain",
  "6051": "Lorain",
  "6052": "Lorain",
  "6076": "Lorain",
  "6090": "Lorain",
  "6077": "Lima",
  "6410": "Lima",
  "6413": "Lima",
  "6176": "Youngstown",
  "6177": "Youngstown",
  "6190": "Youngstown",
  "6610": "Kentucky",
  "9230": "Kentucky",
  "9254": "Kentucky",
  "9803": "Kentucky",
  "6730": "Toledo",
  "6734": "Toledo",
  "6735": "Toledo",
}
