import type { Client, Market } from "$lib/schema/snapshot"
import { MARKETS_BY_CLIENT } from "$lib/markets"

export { MARKETS_BY_CLIENT }

// One PostHog project; clients are distinguished by `properties.\`client-username\`` and email
// domains. See archive/design/data-sources.md § PostHog.
export const POSTHOG_PROJECT_ID = "71649"
export const POSTHOG_ENDPOINT = `https://us.posthog.com/api/projects/${POSTHOG_PROJECT_ID}/query/`

export interface ClientConfig {
  readonly clientUsername: string
  readonly emailDomains: readonly string[]
  // Hardcoded operational counts. Provisioned = accounts created out-of-band by
  // the client (we don't have a query for this); Lima = subset on the Lima pilot.
  // `null` means "unknown — fill in before launching this client."
  readonly provisionedTotal: number | null
  readonly provisionedLima: number | null
}

export const CLIENTS: Record<Client, ClientConfig> = {
  bsmh: {
    clientUsername: "bsmh",
    emailDomains: ["@mercy.com", "@bshsi.org"],
    provisionedTotal: 37,
    provisionedLima: 7,
  },
  // TODO: confirm provisioned-user counts for SSM with the client before launch.
  ssm: {
    clientUsername: "ssm",
    emailDomains: ["@ssmhealth.com", "@health.slu.edu"],
    provisionedTotal: null,
    provisionedLima: null,
  },
  // TODO: confirm provisioned-user counts for Duke with the client before launch.
  duke: {
    clientUsername: "duke",
    emailDomains: ["@duke.edu"],
    provisionedTotal: null,
    provisionedLima: null,
  },
  // TODO: confirm provisioned-user counts for UCSF with the client before launch.
  ucsf: {
    clientUsername: "ucsf",
    emailDomains: ["@ucsf.edu"],
    provisionedTotal: null,
    provisionedLima: null,
  },
}

// v1 BSMH window. Used as the default fetch window so date-range picker stays
// client-side filtering only and date changes don't trigger refetches.
export const V1_WINDOW = { start: "2025-08", end: "2026-02" } as const

// Fixed 5-month window for "Recurring leaders" / "Retention rate" KPIs. Locked
// per platform-engagement-metrics.md; not user-configurable.
export const RECURRING_WINDOW = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02"] as const

// Per-client BU UUID → Market. The first UUID segment of a `/regions|units/.../...`
// URL is the bu_uuid; PostHog events carry these but no human label.
//
// BSMH: vendored from archive/design/market-engagement-metrics.md
//   § "BU UUID to Market Mapping" (originally from the parent investigation's
//   generate-html.py). Many BUs roll up into 6 markets.
// SSM: derived from public.businessunits (run scripts/snapshot/probe-businessunits.ts
//   to re-derive). businessunit_name IS the market label — no consolidation.
// Duke: businessunits are departments (Pediatrics, Surgery, …), not regions.
// UCSF: one unit.
//
// Clients with no entries here (Duke, UCSF) don't get a market split — see
// MARKETS_BY_CLIENT.
export const BU_UUID_MARKET: Record<Client, Record<string, Market>> = {
  bsmh: {
    "5504e035-7756-540b-93a7-9b0591b04a54": "Hampton Roads",
    "6e085dfc-d112-5705-bb6e-75f32e6ca545": "Hampton Roads",
    "224caf39-2a30-5204-80c7-7e5327286c7c": "Hampton Roads",
    "b227f07a-fb70-5287-bcc3-36f508a7d982": "Kentucky",
    "96a073fd-26b1-55d1-b954-80290553d5f6": "Kentucky",
    "6974b71d-4e93-59e3-8e17-688aaee08671": "Kentucky",
    "b8586708-4179-5f5d-b0fb-c0391f9adc77": "Lima",
    "0d0182e2-2a15-5aca-b9b4-d07ba1718403": "Lima",
    "5194a183-35cd-54c1-8423-ac12e0897b83": "Lima",
    "e4a8128d-0120-507b-9a4e-df96c4b1ee4d": "Lorain",
    "93f18369-6264-5684-bfd0-03b4f64c07c9": "Lorain",
    "b24a47bf-4f9c-5d14-a12b-131fe7265cfa": "Lorain",
    "4cbdfbe4-c17c-5a17-9dd5-a622ecb97f5f": "Toledo",
    "cf67e06a-1a79-5db7-bc0f-6de4c2f289e1": "Toledo",
    "3d9d5ea8-74d9-5c5e-985e-674c7b946959": "Youngstown",
    "1f0a6910-9caa-5314-9ada-c87bbb0c27ea": "Youngstown",
  },
  ssm: {
    "2809e59a-0b5f-5da0-bb34-2768f9642c41": "SSM Health Continuum of Care",
    "1305cb02-63c1-53eb-af7e-bd6eb19dce7e": "SSM Health Corporate",
    "d14f688c-62f4-532f-8477-28caceadea0d": "SSM Health Mid-Missouri",
    "9943faa7-e116-5162-9a01-f6fc8834c18a": "SSM Health Oklahoma",
    "f8b40c88-8f8c-5667-9817-7656b5392ea9": "SSM Health Southern Illinois",
    "12d405c4-db13-52c4-93fe-974f60590789": "SSM Health St. Louis",
    "763bd8fd-b7c4-5504-99e3-ab44b9692f84": "SSM Health Wisconsin",
  },
  duke: {},
  ucsf: {},
}

// MARKETS_BY_CLIENT is re-exported from `$lib/markets` (top of file) so both
// browser code and server code share one source of truth.
