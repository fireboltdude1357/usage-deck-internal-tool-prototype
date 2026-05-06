import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import type { S3Client } from "@aws-sdk/client-s3"
import { makeS3SnapshotSource, SnapshotSourceError } from "./snapshot-source"

const fakeBody = (text: string) => ({
  transformToString: async () => text,
})

const mockS3 = (sendImpl: () => Promise<unknown>): S3Client =>
  ({
    send: () => sendImpl(),
  }) as unknown as S3Client

const run = <A>(
  e: Effect.Effect<A, SnapshotSourceError>,
): Promise<Either.Either<A, SnapshotSourceError>> =>
  Effect.runPromise(Effect.either(e))

describe("makeS3SnapshotSource", () => {
  it("returns parsed JSON on success", async () => {
    const s3 = mockS3(async () => ({ Body: fakeBody('{"hello":"world"}') }))
    const src = makeS3SnapshotSource(s3, "test-bucket")

    const result = await run(src.read("bsmh", "2026-04", "metrics.json"))

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right).toEqual({ hello: "world" })
    }
  })

  it("maps NoSuchKey to NotFound", async () => {
    const s3 = mockS3(async () => {
      const err = new Error("nope") as Error & { name: string }
      err.name = "NoSuchKey"
      throw err
    })
    const src = makeS3SnapshotSource(s3, "test-bucket")

    const result = await run(src.read("bsmh", "2099-01", "metrics.json"))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.kind).toBe("NotFound")
      expect(result.left.message).toContain("s3://test-bucket/bsmh/2099-01/metrics.json")
    }
  })

  it("maps a 404 $metadata response to NotFound even if name differs", async () => {
    const s3 = mockS3(async () => {
      const err = new Error("not found") as Error & {
        $metadata: { httpStatusCode: number }
      }
      err.$metadata = { httpStatusCode: 404 }
      throw err
    })
    const src = makeS3SnapshotSource(s3, "test-bucket")

    const result = await run(src.read("bsmh", "2099-01", "metrics.json"))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left.kind).toBe("NotFound")
  })

  it("maps generic AWS errors (e.g. AccessDenied) to Upstream", async () => {
    const s3 = mockS3(async () => {
      const err = new Error("denied") as Error & { name: string }
      err.name = "AccessDenied"
      throw err
    })
    const src = makeS3SnapshotSource(s3, "test-bucket")

    const result = await run(src.read("bsmh", "2026-04", "metrics.json"))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.kind).toBe("Upstream")
      expect(result.left.message).toContain("AccessDenied")
    }
  })

  it("maps malformed JSON to Decode", async () => {
    const s3 = mockS3(async () => ({ Body: fakeBody("not json {") }))
    const src = makeS3SnapshotSource(s3, "test-bucket")

    const result = await run(src.read("bsmh", "2026-04", "metrics.json"))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left.kind).toBe("Decode")
      expect(result.left.message).toContain("invalid JSON")
    }
  })

  it("addresses the object using {client}/{month}/{file} key shape", async () => {
    let observedKey: string | undefined
    const s3 = {
      send: (cmd: { input: { Bucket: string; Key: string } }) => {
        observedKey = cmd.input.Key
        return Promise.resolve({ Body: fakeBody("{}") })
      },
    } as unknown as S3Client
    const src = makeS3SnapshotSource(s3, "test-bucket")

    await run(src.read("ssm", "2026-04", "provisioned_users.json"))

    expect(observedKey).toBe("ssm/2026-04/provisioned_users.json")
  })
})
