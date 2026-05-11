import { json, error } from "@sveltejs/kit"
import { Effect, Schema, Either } from "effect"
import {
  Client,
  MarketSnapshot,
  Month,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
  SnapshotFileSchema,
  SuccessStoriesSnapshot,
  type SnapshotFile,
} from "$lib/schema/snapshot"
import {
  SnapshotSource,
  SnapshotSourceError,
  SnapshotSourceLive,
} from "$lib/server/snapshot-source"
import type { RequestHandler } from "./$types"

const decodeForFile = (
  file: SnapshotFile,
  raw: unknown,
): Effect.Effect<unknown, SnapshotSourceError> => {
  const schema =
    file === "metrics.json"
      ? PlatformSnapshot
      : file === "market_metrics.json"
        ? MarketSnapshot
        : file === "provisioned_users.json"
          ? ProvisionedUsersSnapshot
          : SuccessStoriesSnapshot
  return Schema.decodeUnknown(schema as Schema.Schema<unknown>)(raw).pipe(
    Effect.mapError(
      (e) => new SnapshotSourceError({ kind: "Decode", message: String(e) }),
    ),
  )
}

export const GET: RequestHandler = async ({ params }) => {
  const clientResult = Schema.decodeUnknownEither(Client)(params.client)
  if (Either.isLeft(clientResult)) error(404, "Unknown client")

  const monthResult = Schema.decodeUnknownEither(Month)(params.month)
  if (Either.isLeft(monthResult)) error(404, "Bad month format (expected YYYY-MM)")

  const fileResult = Schema.decodeUnknownEither(SnapshotFileSchema)(params.file)
  if (Either.isLeft(fileResult)) error(404, "Unknown snapshot file")

  const client = clientResult.right
  const month = monthResult.right
  const file: SnapshotFile = fileResult.right

  const program: Effect.Effect<unknown, SnapshotSourceError, SnapshotSource> =
    Effect.gen(function* () {
      const source = yield* SnapshotSource
      const raw = yield* source.read(client, month, file)
      return yield* decodeForFile(file, raw)
    })

  const result = await Effect.runPromise(
    program.pipe(Effect.provide(SnapshotSourceLive), Effect.either),
  )

  if (Either.isRight(result)) return json(result.right)

  const err = result.left
  const status =
    err.kind === "NotFound" ? 404 : err.kind === "Upstream" ? 502 : 500
  return json({ kind: err.kind, message: err.message }, { status })
}
