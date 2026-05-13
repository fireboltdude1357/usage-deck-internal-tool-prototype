import { Effect, Schema } from "effect"
import type {
  AdoptionEngagementSnapshot,
  Client,
  MarketSnapshot,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
} from "$lib/schema/snapshot"
import {
  AdoptionEngagementSnapshot as AdoptionEngagementSnapshotSchema,
  MarketSnapshot as MarketSnapshotSchema,
  PlatformSnapshot as PlatformSnapshotSchema,
  ProvisionedUsersSnapshot as ProvisionedUsersSnapshotSchema,
} from "$lib/schema/snapshot"
import { fetchByMonth, rowsToObjects } from "./pagination"
import {
  providerViewEventsQuery,
  unitViewEventsQuery,
  monthlyUserActivityQuery,
  riskFactorViewEventsQuery,
  userActivityByMonthQuery,
  successStoriesCohortQuery,
} from "./queries"
import { runHogQL } from "./client"
import {
  buildAdoptionEngagementSnapshot,
  buildMarketSnapshot,
  buildPlatformSnapshot,
  buildProvisionedSnapshot,
} from "./aggregator"
import type {
  ProviderEvent,
  UnitEvent,
  MonthlyActivity,
  RiskFactorEvent,
  UserActivityMonth,
} from "./aggregator"
import type { Market } from "$lib/schema/snapshot"
import { MARKETS_BY_CLIENT } from "./config"
import { cached } from "./cache"
import { CLIENTS } from "./config"
import { PostHogError } from "./client"

const asString = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""))
const asNumber = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

// Cached fetchers — one cache key per (event-shape, client, range). The same
// cached events feed both runPlatformPipeline and runMarketPipeline, so a hit
// on one warms the other.
const fetchProviderEvents = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<readonly ProviderEvent[], PostHogError> =>
  cached(
    `provider-events:${client}:${startMonth}:${endMonth}`,
    fetchByMonth(
      startMonth,
      endMonth,
      (from, to) => providerViewEventsQuery(client, from, to),
      `provider-events ${client}`,
    ).pipe(
      Effect.map(({ rows, columns }) =>
        rowsToObjects<ProviderEvent>(rows, columns, (r) => ({
          month: asString(r.month),
          user_email: asString(r.user_email),
          bu_uuid: asString(r.bu_uuid),
          provider_legacy_id: asString(r.provider_legacy_id),
        })),
      ),
    ),
  )

const fetchUnitEvents = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<readonly UnitEvent[], PostHogError> =>
  cached(
    `unit-events:${client}:${startMonth}:${endMonth}`,
    fetchByMonth(
      startMonth,
      endMonth,
      (from, to) => unitViewEventsQuery(client, from, to),
      `unit-events ${client}`,
    ).pipe(
      Effect.map(({ rows, columns }) =>
        rowsToObjects<UnitEvent>(rows, columns, (r) => ({
          month: asString(r.month),
          user_email: asString(r.user_email),
          bu_uuid: asString(r.bu_uuid),
          group_uuid: asString(r.group_uuid),
        })),
      ),
    ),
  )

const fetchRiskFactorEvents = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<readonly RiskFactorEvent[], PostHogError> =>
  cached(
    `risk-factor-events:${client}:${startMonth}:${endMonth}`,
    fetchByMonth(
      startMonth,
      endMonth,
      (from, to) => riskFactorViewEventsQuery(client, from, to),
      `risk-factor-events ${client}`,
    ).pipe(
      Effect.map(({ rows, columns }) =>
        rowsToObjects<RiskFactorEvent>(rows, columns, (r) => {
          const t = asString(r.view_type)
          const view_type: RiskFactorEvent["view_type"] =
            t === "overview" || t === "drilldown" ? t : "other"
          return {
            month: asString(r.month),
            user_email: asString(r.user_email),
            url: asString(r.url),
            view_type,
          }
        }),
      ),
    ),
  )

const fetchMonthlyActivity = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<readonly MonthlyActivity[], PostHogError> =>
  cached(
    `monthly-activity:${client}:${startMonth}:${endMonth}`,
    fetchByMonth(
      startMonth,
      endMonth,
      (from, to) => monthlyUserActivityQuery(client, from, to),
      `monthly-activity ${client}`,
    ).pipe(
      Effect.map(({ rows, columns }) =>
        rowsToObjects<MonthlyActivity>(rows, columns, (r) => ({
          month: asString(r.month),
          user_email: asString(r.user_email),
          event_count: asNumber(r.event_count),
        })),
      ),
    ),
  )

const fetchUserActivityByMonth = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<readonly UserActivityMonth[], PostHogError> =>
  cached(
    `user-activity:${client}:${startMonth}:${endMonth}`,
    fetchByMonth(
      startMonth,
      endMonth,
      (from, to) => userActivityByMonthQuery(client, from, to),
      `user-activity ${client}`,
    ).pipe(
      Effect.map(({ rows, columns }) =>
        rowsToObjects<UserActivityMonth>(rows, columns, (r) => ({
          month: asString(r.month),
          user_email: asString(r.user_email),
          page_loads: asNumber(r.page_loads),
          active_days: asNumber(r.active_days),
          first_seen: asString(r.first_seen),
          last_seen: asString(r.last_seen),
        })),
      ),
    ),
  )

// Schema-validate the aggregator output. Treat shape mismatches as Decode
// errors so the route handler maps them to a 502 with a useful message.
const decodeOrFail = <A>(
  schema: Schema.Schema<A, unknown>,
  value: unknown,
  what: string,
): Effect.Effect<A, PostHogError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(value),
    catch: (e) =>
      new PostHogError({
        kind: "Decode",
        message: `${what} failed schema validation: ${
          e instanceof Error ? e.message : String(e)
        }`,
      }),
  })

export interface PipelineOptions {
  readonly refresh?: boolean
}

const platformImpl = (
  client: Client,
  startMonth: string,
  endMonth: string,
  opts: PipelineOptions,
): Effect.Effect<PlatformSnapshot, PostHogError> =>
  Effect.all(
    {
      providerEvents: fetchProviderEvents(client, startMonth, endMonth),
      unitEvents: fetchUnitEvents(client, startMonth, endMonth),
      monthlyActivity: fetchMonthlyActivity(client, startMonth, endMonth),
      riskFactorEvents: fetchRiskFactorEvents(client, startMonth, endMonth),
    },
    { concurrency: 4 },
  ).pipe(
    Effect.flatMap(({ providerEvents, unitEvents, monthlyActivity, riskFactorEvents }) =>
      decodeOrFail(
        PlatformSnapshotSchema as unknown as Schema.Schema<PlatformSnapshot, unknown>,
        buildPlatformSnapshot({
          client,
          startMonth,
          endMonth,
          providerEvents,
          unitEvents,
          monthlyActivity,
          riskFactorEvents,
          // Filled by the loader from the RDS-derived market snapshot (sum of
          // clinicians_by_market). 0 here means "PostHog pipeline doesn't know."
          cliniciansMonitored: 0,
        }),
        "platform aggregator output",
      ),
    ),
    Effect.tap(() => Effect.sync(() => void opts)),
  )

export const runPlatformPipeline = (
  client: Client,
  startMonth: string,
  endMonth: string,
  opts: PipelineOptions = {},
): Effect.Effect<PlatformSnapshot, PostHogError> =>
  cached(
    `platform:${client}:${startMonth}:${endMonth}`,
    platformImpl(client, startMonth, endMonth, opts),
    { bypass: opts.refresh },
  )

// Zero-filled clinician roster — PostHog doesn't know roster counts. The page
// loader fills these from the sibling market_metrics.json snapshot, then
// patches the resulting card values.
const emptyCliniciansByMarket = (client: Client): Record<Market, number> => {
  const out: Partial<Record<Market, number>> = {}
  for (const m of MARKETS_BY_CLIENT[client]) out[m] = 0
  return out as Record<Market, number>
}

const marketImpl = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<MarketSnapshot, PostHogError> =>
  Effect.all(
    {
      providerEvents: fetchProviderEvents(client, startMonth, endMonth),
      unitEvents: fetchUnitEvents(client, startMonth, endMonth),
    },
    { concurrency: 2 },
  ).pipe(
    Effect.flatMap(({ providerEvents, unitEvents }) =>
      decodeOrFail(
        MarketSnapshotSchema as unknown as Schema.Schema<MarketSnapshot, unknown>,
        buildMarketSnapshot({
          client,
          startMonth,
          endMonth,
          providerEvents,
          unitEvents,
          cliniciansByMarket: emptyCliniciansByMarket(client),
        }),
        "market aggregator output",
      ),
    ),
  )

export const runMarketPipeline = (
  client: Client,
  startMonth: string,
  endMonth: string,
  opts: PipelineOptions = {},
): Effect.Effect<MarketSnapshot, PostHogError> =>
  cached(
    `market:${client}:${startMonth}:${endMonth}`,
    marketImpl(client, startMonth, endMonth),
    { bypass: opts.refresh },
  )

const provisionedImpl = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<ProvisionedUsersSnapshot, PostHogError> => {
  const cfg = CLIENTS[client]
  return Effect.all(
    {
      providerEvents: fetchProviderEvents(client, startMonth, endMonth),
      unitEvents: fetchUnitEvents(client, startMonth, endMonth),
      userActivity: fetchUserActivityByMonth(client, startMonth, endMonth),
    },
    { concurrency: 3 },
  ).pipe(
    Effect.flatMap(({ providerEvents, unitEvents, userActivity }) =>
      decodeOrFail(
        ProvisionedUsersSnapshotSchema as unknown as Schema.Schema<
          ProvisionedUsersSnapshot,
          unknown
        >,
        buildProvisionedSnapshot({
          client,
          startMonth,
          endMonth,
          providerEvents,
          unitEvents,
          userActivity,
          provisionedTotal: cfg.provisionedTotal,
          provisionedLima: cfg.provisionedLima,
        }),
        "provisioned aggregator output",
      ),
    ),
  )
}

export const runProvisionedPipeline = (
  client: Client,
  startMonth: string,
  endMonth: string,
  opts: PipelineOptions = {},
): Effect.Effect<ProvisionedUsersSnapshot, PostHogError> =>
  cached(
    `provisioned:${client}:${startMonth}:${endMonth}`,
    provisionedImpl(client, startMonth, endMonth),
    { bypass: opts.refresh },
  )

// Provider legacy_ids viewed externally in the success-stories window. The
// window is iter-12-fixed today (Aug 2025 – Feb 2026) but parameterized so a
// future UI can vary it. Returns `{ provider_ids }` so the route handler
// doesn't have to know about the underlying row shape.
const cohortFromMonths = (
  startMonth: string,
  endMonth: string,
): { from: string; to: string } => {
  const [ey, em] = endMonth.split("-").map(Number)
  const nextMonth = em === 12 ? `${ey + 1}-01` : `${ey}-${String(em + 1).padStart(2, "0")}`
  return { from: `${startMonth}-01`, to: `${nextMonth}-01` }
}

export interface SuccessStoriesCohort {
  readonly provider_ids: readonly string[]
}

const cohortImpl = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<SuccessStoriesCohort, PostHogError> => {
  const { from, to } = cohortFromMonths(startMonth, endMonth)
  return runHogQL(successStoriesCohortQuery(client, from, to), {
    label: `success-stories-cohort ${client}`,
  }).pipe(
    Effect.map((res) => {
      const idIdx = res.columns.indexOf("legacy_id")
      const ids = idIdx === -1
        ? []
        : res.results
            .map((r) => (typeof r[idIdx] === "string" ? (r[idIdx] as string) : ""))
            .filter((s) => s.length > 0)
      return { provider_ids: ids }
    }),
  )
}

export const runSuccessStoriesCohortPipeline = (
  client: Client,
  startMonth: string,
  endMonth: string,
  opts: PipelineOptions = {},
): Effect.Effect<SuccessStoriesCohort, PostHogError> =>
  cached(
    `success-stories-cohort:${client}:${startMonth}:${endMonth}`,
    cohortImpl(client, startMonth, endMonth),
    { bypass: opts.refresh },
  )

const adoptionEngagementImpl = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<AdoptionEngagementSnapshot, PostHogError> =>
  fetchUserActivityByMonth(client, startMonth, endMonth).pipe(
    Effect.flatMap((userActivity) =>
      decodeOrFail(
        AdoptionEngagementSnapshotSchema as unknown as Schema.Schema<
          AdoptionEngagementSnapshot,
          unknown
        >,
        buildAdoptionEngagementSnapshot({
          client,
          startMonth,
          endMonth,
          userActivity,
        }),
        "adoption-engagement aggregator output",
      ),
    ),
  )

export const runAdoptionEngagementPipeline = (
  client: Client,
  startMonth: string,
  endMonth: string,
  opts: PipelineOptions = {},
): Effect.Effect<AdoptionEngagementSnapshot, PostHogError> =>
  cached(
    `adoption-engagement:${client}:${startMonth}:${endMonth}`,
    adoptionEngagementImpl(client, startMonth, endMonth),
    { bypass: opts.refresh },
  )
