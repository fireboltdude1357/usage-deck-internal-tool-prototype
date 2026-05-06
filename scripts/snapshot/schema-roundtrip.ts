import { Schema } from "effect"

// Encode → decode round-trip. Loud failure on Schema mismatch — the throw
// surfaces the offending field path. Shared by `src/lib/mock/build.ts` and
// `scripts/snapshot/build.ts` so both validate identically.
export const roundtrip = <A, I>(schema: Schema.Schema<A, I>, value: A): I => {
  const encoded = Schema.encodeSync(schema)(value)
  Schema.decodeUnknownSync(schema)(encoded)
  return encoded
}
