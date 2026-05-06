import { json, error } from "@sveltejs/kit"
import { Effect, Either, Schema } from "effect"
import { Client, Month } from "$lib/schema/snapshot"
import { runPlatformPipeline } from "$lib/server/posthog/pipeline"
import type { RequestHandler } from "./$types"

const Metric = Schema.Literal("metrics")

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A | null => {
  const r = Schema.decodeUnknownEither(schema)(value)
  return Either.isRight(r) ? r.right : null
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
    Effect.either(runPlatformPipeline(client, start, end, { refresh })),
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
