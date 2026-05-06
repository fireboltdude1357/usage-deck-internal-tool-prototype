import { Effect } from "effect"

const TTL_MS = 15 * 60 * 1000 // 15 minutes; PostHog data updates ≈ monthly.

interface Entry<T> {
  value: T
  expiresAt: number
}

const store = new Map<string, Entry<unknown>>()

export interface CacheOptions {
  // When true, skip cache read but still write the fresh value back. Used by
  // the refresh button so subsequent same-input requests still hit cache.
  readonly bypass?: boolean
}

// In-process cache. Single Vercel serverless instance per request, so the
// benefit is per-warm-instance only — still meaningful for back-to-back
// dashboard loads from the same user.
export const cached = <A, E>(
  key: string,
  effect: Effect.Effect<A, E>,
  opts: CacheOptions = {},
): Effect.Effect<A, E> =>
  Effect.suspend(() => {
    const now = Date.now()
    const entry = store.get(key)
    if (!opts.bypass && entry && entry.expiresAt > now) {
      const remainingS = Math.round((entry.expiresAt - now) / 1000)
      console.log(`[posthog] cache HIT ${key} (ttl ${remainingS}s)`)
      return Effect.succeed(entry.value as A)
    }
    console.log(
      `[posthog] cache ${opts.bypass ? "BYPASS" : "MISS"} ${key} — fetching`,
    )
    return effect.pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          store.set(key, { value, expiresAt: now + TTL_MS })
        }),
      ),
    )
  })

// Test/maintenance helper.
export const clearCache = (): void => {
  store.clear()
}
