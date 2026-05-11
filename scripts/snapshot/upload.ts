import * as fs from "node:fs"
import * as path from "node:path"
import { parseArgs } from "node:util"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { Schema } from "effect"
import { loadEnv } from "./load-env.ts"
import {
  Client,
  MarketSnapshot,
  Month,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
  SnapshotFileSchema,
  SuccessStoriesSnapshot,
  type SnapshotFile,
} from "../../src/lib/schema/snapshot.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
loadEnv(path.join(ROOT, ".env"))

const die = (msg: string): never => {
  console.error(`error: ${msg}`)
  process.exit(1)
}

const { values } = parseArgs({
  options: {
    client: { type: "string" },
    month: { type: "string" },
    file: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
  strict: true,
})

if (!values.client) die("--client required (one of: bsmh, ssm, duke, ucsf)")
if (!values.month) die("--month required (YYYY-MM)")

const client = Schema.decodeUnknownSync(Client)(values.client)
const month = Schema.decodeUnknownSync(Month)(values.month)
const onlyFile: SnapshotFile | null = values.file
  ? Schema.decodeUnknownSync(SnapshotFileSchema)(values.file)
  : null
const dryRun = values["dry-run"] ?? false

// TODO(phase-05): swap SNAPSHOT_AWS_* env to dedicated IAM principal before WorkOS launch.
const BUCKET = process.env.SNAPSHOT_BUCKET ?? "internal-tool-snapshots"
const REGION = process.env.SNAPSHOT_AWS_REGION ?? "us-east-1"
const accessKeyId = process.env.SNAPSHOT_AWS_ACCESS_KEY_ID
const secretAccessKey = process.env.SNAPSHOT_AWS_SECRET_ACCESS_KEY

const TMP = path.join(ROOT, "tmp", "snapshot", client, month)

const schemaFor = (file: SnapshotFile): Schema.Schema<unknown, unknown> => {
  if (file === "metrics.json") return PlatformSnapshot as unknown as Schema.Schema<unknown, unknown>
  if (file === "market_metrics.json") return MarketSnapshot as unknown as Schema.Schema<unknown, unknown>
  if (file === "provisioned_users.json") return ProvisionedUsersSnapshot as unknown as Schema.Schema<unknown, unknown>
  return SuccessStoriesSnapshot as unknown as Schema.Schema<unknown, unknown>
}

const ALL_FILES: SnapshotFile[] = [
  "metrics.json",
  "market_metrics.json",
  "provisioned_users.json",
  "success_stories.json",
]
// When uploading all files, skip ones that don't exist locally — success_
// stories.json is opt-in (the Athena CSVs aren't always present, e.g. older
// months pre Athena-seam). When the user explicitly names a file via --file,
// keep it in the list so the existing existence check surfaces a clear error.
const targets = onlyFile
  ? [onlyFile]
  : ALL_FILES.filter((file) => fs.existsSync(path.join(TMP, file)))

const s3 = dryRun
  ? null
  : new S3Client({
      region: REGION,
      // If env creds are unset, the SDK's default chain (~/.aws/credentials) takes over —
      // matches Tanner's local prototype identity per PLAN.md.
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    })

for (const file of targets) {
  const localPath = path.join(TMP, file)
  if (!fs.existsSync(localPath)) {
    die(`missing ${path.relative(ROOT, localPath)} — run snapshot:build first`)
  }

  let body: string
  try {
    const raw = JSON.parse(fs.readFileSync(localPath, "utf8"))
    Schema.decodeUnknownSync(schemaFor(file))(raw)
    body = JSON.stringify(raw)
  } catch (err) {
    console.error(`schema mismatch for ${file}:`)
    console.error(err)
    process.exit(1)
  }

  const key = `${client}/${month}/${file}`
  const url = `s3://${BUCKET}/${key}`

  if (dryRun) {
    console.log(`[dry-run] would PUT ${url} (${body.length} bytes)`)
    continue
  }

  await s3!.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/json",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  )
  console.log(`  PUT ${url}`)
}
