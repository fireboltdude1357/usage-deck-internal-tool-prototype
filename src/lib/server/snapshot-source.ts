import { Context, Effect, Layer, Schema } from "effect"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { GetObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3"
import { env } from "$env/dynamic/private"
import type { SnapshotFile } from "$lib/schema/snapshot"

export class SnapshotSourceError extends Schema.TaggedError<SnapshotSourceError>()(
  "SnapshotSourceError",
  {
    kind: Schema.Literal("NotFound", "Upstream", "Decode"),
    message: Schema.String,
  },
) {}

export interface SnapshotSource {
  readonly read: (
    client: string,
    month: string,
    file: SnapshotFile,
  ) => Effect.Effect<unknown, SnapshotSourceError>
}
export const SnapshotSource = Context.GenericTag<SnapshotSource>("SnapshotSource")

// Fixtures: read from disk relative to repo root.
export const SnapshotSourceFixtures = Layer.succeed(SnapshotSource, {
  read: (client, month, file) =>
    Effect.tryPromise({
      try: () =>
        fs
          .readFile(
            path.join(process.cwd(), "fixtures", "snapshots", client, month, file),
            "utf8",
          )
          .then((s) => JSON.parse(s) as unknown),
      catch: (e) =>
        new SnapshotSourceError({ kind: "NotFound", message: String(e) }),
    }),
})

// S3: real implementation. Factory accepts an injected client + bucket so the
// unit tests can drive error-mapping with a mock without touching AWS.
//
// Error mapping (matches the route handler's kind→HTTP table at +server.ts:64):
//   - NoSuchKey (or 404)         → NotFound (404)
//   - JSON.parse failure         → Decode   (500)
//   - any other AWS SDK error    → Upstream (502)
export const makeS3SnapshotSource = (
  s3: S3Client,
  bucket: string,
): SnapshotSource => ({
  read: (client, month, file) =>
    Effect.gen(function* () {
      const key = `${client}/${month}/${file}`
      const body = yield* Effect.tryPromise({
        try: async () => {
          const out = await s3.send(
            new GetObjectCommand({ Bucket: bucket, Key: key }),
          )
          return await out.Body!.transformToString()
        },
        catch: (e) => {
          const err = e as { name?: string; $metadata?: { httpStatusCode?: number } }
          const isNotFound =
            err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404
          return new SnapshotSourceError({
            kind: isNotFound ? "NotFound" : "Upstream",
            message: `s3://${bucket}/${key}: ${String(e)}`,
          })
        },
      })
      return yield* Effect.try({
        try: () => JSON.parse(body) as unknown,
        catch: (e) =>
          new SnapshotSourceError({
            kind: "Decode",
            message: `s3://${bucket}/${key}: invalid JSON: ${String(e)}`,
          }),
      })
    }),
})

// TODO(phase-05): swap SNAPSHOT_AWS_* to dedicated read-only IAM principal
// scoped to internal-tool-snapshots/* before WorkOS launch. Same env vars also
// drive scripts/snapshot/upload.ts.
const s3Config = (): S3ClientConfig => {
  const region = env.SNAPSHOT_AWS_REGION ?? "us-east-1"
  const accessKeyId = env.SNAPSHOT_AWS_ACCESS_KEY_ID
  const secretAccessKey = env.SNAPSHOT_AWS_SECRET_ACCESS_KEY
  return {
    region,
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  }
}

let cachedClient: S3Client | null = null
const sharedClient = (): S3Client => {
  if (!cachedClient) cachedClient = new S3Client(s3Config())
  return cachedClient
}

export const SnapshotSourceS3 = Layer.effect(
  SnapshotSource,
  Effect.sync(() => {
    const bucket = env.SNAPSHOT_BUCKET
    if (!bucket) {
      // Fail every request loudly with a 502 + clear message — broken config
      // is more useful as a per-request error than a silent fallback.
      return {
        read: () =>
          Effect.fail(
            new SnapshotSourceError({
              kind: "Upstream",
              message: "SNAPSHOT_BUCKET not configured",
            }),
          ),
      }
    }
    return makeS3SnapshotSource(sharedClient(), bucket)
  }),
)

export const SnapshotSourceLive =
  env.SNAPSHOT_SOURCE === "s3" ? SnapshotSourceS3 : SnapshotSourceFixtures
