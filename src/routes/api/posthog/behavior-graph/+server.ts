import { json, error } from "@sveltejs/kit"
import { Effect, Either, Schema } from "effect"
import { Client, Month } from "$lib/schema/snapshot"
import { PostHogError } from "$lib/server/posthog/client"
import { runBehaviorGraphPipeline } from "$lib/server/posthog/behavior-graph-pipeline"
import type { RequestHandler } from "./$types"

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A | null => {
  const r = Schema.decodeUnknownEither(schema)(value)
  return Either.isRight(r) ? r.right : null
}

export const GET: RequestHandler = async ({ url }) => {
  const rawClient = url.searchParams.get("client")
  const rawFrom = url.searchParams.get("from")
  const rawTo = url.searchParams.get("to")
  const refresh = url.searchParams.get("refresh") === "1"

  console.log(
    `[bgraph] api request client=${rawClient} from=${rawFrom} to=${rawTo} refresh=${refresh}`,
  )

  const client = decode(Client, rawClient)
  if (!client) {
    console.warn(`[bgraph] api 400 unknown client: ${JSON.stringify(rawClient)}`)
    error(400, `unknown client: ${rawClient}`)
  }

  const from = decode(Month, rawFrom)
  const to = decode(Month, rawTo)
  if (!from || !to) {
    console.warn(
      `[bgraph] api 400 bad month params from=${JSON.stringify(rawFrom)} to=${JSON.stringify(rawTo)}`,
    )
    error(400, "from and to query params required (YYYY-MM)")
  }
  if (from > to) {
    console.warn(`[bgraph] api 400 inverted range from=${from} to=${to}`)
    error(400, "from must be <= to")
  }

  const started = Date.now()
  console.log(`[bgraph] api → pipeline ${client} ${from}..${to}${refresh ? " refresh" : ""}`)

  const result = await Effect.runPromise(
    Effect.either(runBehaviorGraphPipeline(client, from, to, { refresh })),
  )
  const ms = Date.now() - started

  if (Either.isLeft(result)) {
    const e = result.left as PostHogError
    console.warn(
      `[bgraph] api ← pipeline ${client} ${ms}ms FAIL kind=${e.kind} status=${e.status ?? "-"} message=${e.message}`,
    )
    if (e.kind === "Configuration" || e.kind === "Decode") error(500, e.message)
    error(502, `${e.kind}: ${e.message}`)
  }

  const out = result.right
  console.log(
    `[bgraph] api ← pipeline ${client} ${ms}ms ok states=${out.graph.meta.stateCount} edges=${out.graph.meta.edgeCount} transitions=${out.graph.meta.totalTransitions} sessions=${out.sessions.length}`,
  )
  return json(out)
}
