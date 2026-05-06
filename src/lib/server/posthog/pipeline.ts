import { Effect, Schema } from "effect"
import type { Client, PlatformSnapshot } from "$lib/schema/snapshot"
import { PlatformSnapshot as PlatformSnapshotSchema } from "$lib/schema/snapshot"
import { fetchByMonth, rowsToObjects } from "./pagination"
import {
  providerViewEventsQuery,
  unitViewEventsQuery,
  monthlyUserActivityQuery,
} from "./queries"
import { buildPlatformSnapshot } from "./aggregator"
import type {
  ProviderEvent,
  UnitEvent,
  MonthlyActivity,
} from "./aggregator"
import { cached } from "./cache"
import { PostHogError } from "./client"

const asString = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""))
const asNumber = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

const fetchPlatform = (
  client: Client,
  startMonth: string,
  endMonth: string,
): Effect.Effect<PlatformSnapshot, PostHogError> =>
  Effect.all(
    {
      providers: fetchByMonth(
        startMonth,
        endMonth,
        (from, to) => providerViewEventsQuery(client, from, to),
        `provider-events ${client}`,
      ),
      units: fetchByMonth(
        startMonth,
        endMonth,
        (from, to) => unitViewEventsQuery(client, from, to),
        `unit-events ${client}`,
      ),
      activity: fetchByMonth(
        startMonth,
        endMonth,
        (from, to) => monthlyUserActivityQuery(client, from, to),
        `monthly-activity ${client}`,
      ),
    },
    { concurrency: 3 },
  ).pipe(
    Effect.flatMap(({ providers, units, activity }) => {
      const providerEvents = rowsToObjects<ProviderEvent>(
        providers.rows,
        providers.columns,
        (r) => ({
          month: asString(r.month),
          user_email: asString(r.user_email),
          provider_legacy_id: asString(r.provider_legacy_id),
        }),
      )
      const unitEvents = rowsToObjects<UnitEvent>(
        units.rows,
        units.columns,
        (r) => ({
          month: asString(r.month),
          user_email: asString(r.user_email),
          group_uuid: asString(r.group_uuid),
        }),
      )
      const monthlyActivity = rowsToObjects<MonthlyActivity>(
        activity.rows,
        activity.columns,
        (r) => ({
          month: asString(r.month),
          user_email: asString(r.user_email),
          event_count: asNumber(r.event_count),
        }),
      )
      const snapshot = buildPlatformSnapshot({
        client,
        startMonth,
        endMonth,
        providerEvents,
        unitEvents,
        monthlyActivity,
      })
      return Effect.try({
        try: () => Schema.decodeUnknownSync(PlatformSnapshotSchema)(snapshot),
        catch: (e) =>
          new PostHogError({
            kind: "Decode",
            message: `aggregator output failed schema validation: ${
              e instanceof Error ? e.message : String(e)
            }`,
          }),
      })
    }),
  )

export interface PipelineOptions {
  readonly refresh?: boolean
}

export const runPlatformPipeline = (
  client: Client,
  startMonth: string,
  endMonth: string,
  opts: PipelineOptions = {},
): Effect.Effect<PlatformSnapshot, PostHogError> =>
  cached(
    `platform:${client}:${startMonth}:${endMonth}`,
    fetchPlatform(client, startMonth, endMonth),
    { bypass: opts.refresh },
  )
