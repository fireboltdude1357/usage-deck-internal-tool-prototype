import type { Client, Market } from "$lib/schema/snapshot"

// One PostHog project; clients are distinguished by `properties.\`client-username\`` and email
// domains. See ../../../design/data-sources.md § PostHog and design/02-posthog-linking/PLAN.md.
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

// BSMH BU UUID → Market. The first UUID segment of a `/regions|units/.../...` URL
// is the bu_uuid; PostHog events carry these but no human label. Vendored verbatim
// from design/market-engagement-metrics.md § "BU UUID to Market Mapping" (which
// is in turn from the parent investigation's scripts/generate-html.py).
//
// TODO: extend with non-BSMH client mappings when those clients launch. Today
// only BSMH has /regions|units/ URLs in PostHog with a meaningful market split.
export const BU_UUID_MARKET: Record<string, Market> = {
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
}

// All markets the BSMH dashboard renders, including those with zero events
// in a given window (e.g., Toledo). Aggregators zero-fill against this list.
export const ALL_MARKETS: readonly Market[] = [
  "Hampton Roads",
  "Lorain",
  "Lima",
  "Youngstown",
  "Kentucky",
  "Toledo",
]
