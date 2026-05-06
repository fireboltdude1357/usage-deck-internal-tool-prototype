import { Effect, Schedule, Duration, Schema } from "effect"
import { env } from "$env/dynamic/private"
import { POSTHOG_ENDPOINT } from "./config"

export class PostHogError extends Schema.TaggedError<PostHogError>()(
  "PostHogError",
  {
    kind: Schema.Literal("Configuration", "Network", "Timeout", "BadStatus", "Decode"),
    message: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

// PostHog wraps every HogQL response in `{ results: row[], columns: name[] }`.
// We accept arbitrary cell types (Schema.Unknown) and let callers narrow.
export const PostHogResponse = Schema.Struct({
  results: Schema.Array(Schema.Array(Schema.Unknown)),
  columns: Schema.Array(Schema.String),
})
export type PostHogResponse = Schema.Schema.Type<typeof PostHogResponse>

// PostHog enforces its own 10s server-side execution limit per HogQL query.
// 30s on our side is queue + network slack; never extends the server limit.
const FETCH_TIMEOUT = Duration.seconds(30)

const apiKey = (): Effect.Effect<string, PostHogError> => {
  const key = env.POSTHOG_API_KEY
  return key
    ? Effect.succeed(key)
    : Effect.fail(
        new PostHogError({ kind: "Configuration", message: "POSTHOG_API_KEY not set" }),
      )
}

const fetchOnce = (
  query: string,
  key: string,
): Effect.Effect<unknown, PostHogError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const res = await fetch(POSTHOG_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
        signal,
      })
      if (!res.ok) {
        const body = await res.text().catch(() => "")
        const err = Object.assign(
          new Error(`PostHog ${res.status} ${res.statusText}: ${body.slice(0, 500)}`),
          { __status: res.status },
        )
        throw err
      }
      return res.json()
    },
    catch: (e) => {
      if (e instanceof Error && typeof (e as unknown as { __status?: number }).__status === "number") {
        return new PostHogError({
          kind: "BadStatus",
          status: (e as unknown as { __status: number }).__status,
          message: e.message,
        })
      }
      if (e instanceof Error && e.name === "AbortError") {
        return new PostHogError({ kind: "Timeout", message: "Fetch aborted" })
      }
      return new PostHogError({
        kind: "Network",
        message: e instanceof Error ? e.message : String(e),
      })
    },
  })

const decode = (raw: unknown): Effect.Effect<PostHogResponse, PostHogError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(PostHogResponse)(raw),
    catch: (e) =>
      new PostHogError({
        kind: "Decode",
        message: e instanceof Error ? e.message : String(e),
      }),
  })

const isTransient = (e: PostHogError): boolean =>
  e.kind === "Network" ||
  e.kind === "Timeout" ||
  (e.kind === "BadStatus" && (e.status ?? 0) >= 500)

// Up to two retries on transient failures with 500ms / 1s / 2s exponential backoff.
const retrySchedule = Schedule.exponential(Duration.millis(500)).pipe(
  Schedule.intersect(Schedule.recurs(2)),
  Schedule.whileInput(isTransient),
)

export interface RunOptions {
  readonly label?: string // surfaced in logs to identify the query
}

export const runHogQL = (
  query: string,
  opts: RunOptions = {},
): Effect.Effect<PostHogResponse, PostHogError> =>
  Effect.suspend(() => {
    const label = opts.label ?? "hogql"
    const started = Date.now()
    return apiKey().pipe(
      Effect.flatMap((key) => fetchOnce(query, key)),
      Effect.timeoutFail({
        duration: FETCH_TIMEOUT,
        onTimeout: () =>
          new PostHogError({ kind: "Timeout", message: "fetch exceeded 30s" }),
      }),
      Effect.flatMap(decode),
      Effect.retry(retrySchedule),
      Effect.tap((res) =>
        Effect.sync(() => {
          const ms = Date.now() - started
          console.log(`[posthog] ${label} ok ${ms}ms rows=${res.results.length}`)
        }),
      ),
      Effect.tapError((err) =>
        Effect.sync(() => {
          const ms = Date.now() - started
          console.warn(`[posthog] ${label} fail ${ms}ms ${err.kind}: ${err.message}`)
        }),
      ),
    )
  })
