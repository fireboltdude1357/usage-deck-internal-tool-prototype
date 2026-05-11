import type { Client, Market } from "$lib/schema/snapshot"
import { MARKETS_BY_CLIENT } from "$lib/markets"

// Per-client mapping from `provider_info_v2.businessunitname` → Market.
//
// BSMH: many BU codes roll up into 6 markets. Vendored verbatim from
//   parent-db-investigations/.../bsmh-usage-deck/engagement/
//   market-engagement-metrics/10-retention-workflow-visuals/scripts/generate-html.py
//   (`BU_CODE_MARKET`). Source of truth is the investigation script; keep in sync.
// SSM: businessunitname IS the market label (no consolidation). Mapping derived
//   from public.businessunits — re-run scripts/snapshot/probe-businessunits.ts
//   to refresh after upstream changes.
// Duke: businessunits are *departments* (Pediatrics, Surgery, …), not regions.
// UCSF: single unit.
export const BU_CODE_MARKET: Record<Client, Record<string, Market>> = {
  bsmh: {
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
  },
  ssm: {
    "SSM Health Continuum of Care": "SSM Health Continuum of Care",
    "SSM Health Corporate": "SSM Health Corporate",
    "SSM Health Mid-Missouri": "SSM Health Mid-Missouri",
    "SSM Health Oklahoma": "SSM Health Oklahoma",
    "SSM Health Southern Illinois": "SSM Health Southern Illinois",
    "SSM Health St. Louis": "SSM Health St. Louis",
    "SSM Health Wisconsin": "SSM Health Wisconsin",
  },
  duke: {},
  ucsf: {},
}

// Re-export so existing callers can import market lists from one place.
export { MARKETS_BY_CLIENT }
