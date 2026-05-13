import { json, error } from "@sveltejs/kit"
import { Effect, Either, Schema } from "effect"
import type { Client as ClientT } from "$lib/schema/snapshot"
import { Client, Month } from "$lib/schema/snapshot"
import { PostHogError } from "$lib/server/posthog/client"
import {
  runAdoptionEngagementPipeline,
  runMarketPipeline,
  runPlatformPipeline,
  runProvisionedPipeline,
  runSuccessStoriesCohortPipeline,
} from "$lib/server/posthog/pipeline"
import type { RequestHandler } from "./$types"

const Metric = Schema.Literal(
  "metrics",
  "market",
  "provisioned",
  "success-stories-cohort",
  "adoption-engagement",
)
type Metric = Schema.Schema.Type<typeof Metric>

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A | null => {
  const r = Schema.decodeUnknownEither(schema)(value)
  return Either.isRight(r) ? r.right : null
}

const dispatch = (
  metric: Metric,
  client: ClientT,
  start: string,
  end: string,
  opts: { refresh: boolean },
): Effect.Effect<unknown, PostHogError> => {
  switch (metric) {
    case "metrics":
      return runPlatformPipeline(client, start, end, opts)
    case "market":
      return runMarketPipeline(client, start, end, opts)
    case "provisioned":
      return runProvisionedPipeline(client, start, end, opts)
    case "success-stories-cohort":
      return runSuccessStoriesCohortPipeline(client, start, end, opts)
    case "adoption-engagement":
      return runAdoptionEngagementPipeline(client, start, end, opts)
  }
}

export const GET: RequestHandler = async ({ params, url }) => {
  const client = decode(Client, params.client)
  if (!client) error(400, `unknown client: ${params.client}`)

  const metric = decode(Metric, params.metric)
  if (!metric) error(400, `unknown metric: ${params.metric}`)

  const start = decode(Month, url.searchParams.get("start"))
  const end = decode(Month, url.searchParams.get("end"))
  if (!start || !end) error(400, "start and end query params required (YYYY-MM)")
  if (start > end) error(400, "start must be <= end")

  const refresh = url.searchParams.get("refresh") === "1"
  const started = Date.now()
  console.log(
    `[posthog] → ${client}/${metric} ${start}..${end}${refresh ? " refresh" : ""}`,
  )

  const result = await Effect.runPromise(
    Effect.either(dispatch(metric, client, start, end, { refresh })),
  )
  const ms = Date.now() - started

  if (Either.isLeft(result)) {
    const e = result.left
    console.warn(`[posthog] ← ${client}/${metric} ${ms}ms ${e.kind}: ${e.message}`)
    if (e.kind === "Configuration") error(503, e.message)
    error(502, `${e.kind}: ${e.message}`)
  }
  console.log(`[posthog] ← ${client}/${metric} ${ms}ms ok`)
  return json(result.right)
}
