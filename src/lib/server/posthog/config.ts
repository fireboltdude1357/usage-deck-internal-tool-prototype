import type { Client } from "$lib/schema/snapshot"

// One PostHog project; clients are distinguished by `properties.\`client-username\`` and email
// domains. See ../../../design/data-sources.md § PostHog and design/02-posthog-linking/PLAN.md.
export const POSTHOG_PROJECT_ID = "71649"
export const POSTHOG_ENDPOINT = `https://us.posthog.com/api/projects/${POSTHOG_PROJECT_ID}/query/`

export interface ClientConfig {
  readonly clientUsername: string
  readonly emailDomains: readonly string[]
}

export const CLIENTS: Record<Client, ClientConfig> = {
  bsmh: { clientUsername: "bsmh", emailDomains: ["@mercy.com", "@bshsi.org"] },
  ssm: { clientUsername: "ssm", emailDomains: ["@ssmhealth.com", "@health.slu.edu"] },
  duke: { clientUsername: "duke", emailDomains: ["@duke.edu"] },
  ucsf: { clientUsername: "ucsf", emailDomains: ["@ucsf.edu"] },
}

// v1 BSMH window. Used as the default fetch window so date-range picker stays
// client-side filtering only and date changes don't trigger refetches.
export const V1_WINDOW = { start: "2025-08", end: "2026-02" } as const

// Fixed 5-month window for "Recurring leaders" / "Retention rate" KPIs. Locked
// per platform-engagement-metrics.md; not user-configurable.
export const RECURRING_WINDOW = ["2025-10", "2025-11", "2025-12", "2026-01", "2026-02"] as const
