import * as fs from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"
import {
  AthenaClient,
  GetQueryExecutionCommand,
  StartQueryExecutionCommand,
  type QueryExecutionState,
} from "@aws-sdk/client-athena"
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3"

// CLAUDE.md PHI block-list. Identical to the rule applied at query-build time
// in the runtime PostHog client; copied here so the Athena pipeline can't
// accidentally write a query that pulls one of these columns. Substring match
// (case-insensitive) is intentionally aggressive — if a column name legitimately
// contains one of these substrings, the snapshot pipeline is the wrong place
// to handle it.
const PHI_BLOCK_LIST: readonly string[] = [
  "patient_id",
  "encounter_id",
  "claim_id",
  "procedure_id",
  "message_id",
  "thread_id",
  "source_msg_id",
  "hospital_account_id",
  "primary_encounter_id",
]

const TERMINAL_STATES: ReadonlySet<QueryExecutionState> = new Set<QueryExecutionState>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
])

// Optional header comment `-- @database: <name>` overrides the runner's
// default database for one query file. Useful when a query joins across
// databases or pulls from a non-default catalog.
const DATABASE_HEADER = /^--\s*@database:\s*(\S+)\s*$/m

const stripComments = (sql: string): string =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*\n/g, "\n")

const checkPhi = (sql: string): void => {
  const haystack = stripComments(sql).toLowerCase()
  for (const term of PHI_BLOCK_LIST) {
    if (haystack.includes(term)) {
      throw new Error(`query references PHI-blocked identifier "${term}"`)
    }
  }
}

const substitute = (sql: string, bindings: Record<string, string>): string =>
  sql.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in bindings)) {
      throw new Error(`unbound placeholder {{${name}}} in SQL`)
    }
    return bindings[name]
  })

export interface AthenaConfig {
  readonly database: string
  readonly workgroup: string
  readonly bucket: string
  readonly prefix: string // includes trailing slash, e.g. "athena-results/"
  readonly region: string
}

const loadConfig = (): AthenaConfig => {
  const region = process.env.SNAPSHOT_AWS_REGION ?? "us-east-1"
  const bucket = process.env.SNAPSHOT_BUCKET ?? "internal-tool-snapshots"
  const database = process.env.ATHENA_DATABASE ?? "sql_outputs"
  const workgroup = process.env.ATHENA_WORKGROUP ?? "primary"
  const rawPrefix = process.env.ATHENA_OUTPUT_PREFIX ?? "athena-results/"
  const prefix = rawPrefix.endsWith("/") ? rawPrefix : `${rawPrefix}/`
  return { database, workgroup, bucket, prefix, region }
}

const credentials = (): { accessKeyId: string; secretAccessKey: string } | undefined => {
  const accessKeyId = process.env.SNAPSHOT_AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.SNAPSHOT_AWS_SECRET_ACCESS_KEY
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined
}

let cachedAthena: AthenaClient | null = null
let cachedS3: S3Client | null = null
const getAthena = (region: string): AthenaClient =>
  (cachedAthena ??= new AthenaClient({ region, credentials: credentials() }))
const getS3 = (region: string): S3Client =>
  (cachedS3 ??= new S3Client({ region, credentials: credentials() }))

const POLL_INTERVAL_MS = 2_000
const MAX_POLL_MS = 180_000

const pollUntilDone = async (
  athena: AthenaClient,
  qid: string,
): Promise<{ state: QueryExecutionState; reason?: string }> => {
  const start = Date.now()
  while (Date.now() - start < MAX_POLL_MS) {
    const res = await athena.send(new GetQueryExecutionCommand({ QueryExecutionId: qid }))
    const state = res.QueryExecution?.Status?.State
    if (state && TERMINAL_STATES.has(state)) {
      return { state, reason: res.QueryExecution?.Status?.StateChangeReason }
    }
    await sleep(POLL_INTERVAL_MS)
  }
  throw new Error(`Athena query ${qid} did not finish within ${MAX_POLL_MS}ms`)
}

const streamToString = async (body: unknown): Promise<string> => {
  // The S3 SDK returns a Node Readable, a Web ReadableStream, or a Blob
  // depending on runtime. transformToString is on all of them.
  if (
    body &&
    typeof (body as { transformToString?: () => Promise<string> }).transformToString ===
      "function"
  ) {
    return (body as { transformToString: () => Promise<string> }).transformToString()
  }
  throw new Error("Athena result body is not a streamable object")
}

export const runAthenaQueryFile = async (
  sqlPath: string,
  bindings: Record<string, string>,
  csvOutPath: string,
): Promise<{ rows: number }> => {
  const raw = fs.readFileSync(sqlPath, "utf8")
  const sql = substitute(raw, bindings)
  checkPhi(sql)

  const config = loadConfig()
  const headerMatch = DATABASE_HEADER.exec(raw)
  const database = headerMatch?.[1] ?? config.database

  const athena = getAthena(config.region)
  const s3 = getS3(config.region)

  const start = await athena.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: { Database: database },
      ResultConfiguration: {
        OutputLocation: `s3://${config.bucket}/${config.prefix}`,
      },
      WorkGroup: config.workgroup,
    }),
  )
  const qid = start.QueryExecutionId
  if (!qid) throw new Error("Athena StartQueryExecution returned no QueryExecutionId")

  const { state, reason } = await pollUntilDone(athena, qid)
  if (state !== "SUCCEEDED") {
    throw new Error(`Athena query ${qid} ended ${state}: ${reason ?? "(no reason)"}`)
  }

  const result = await s3.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: `${config.prefix}${qid}.csv`,
    }),
  )
  const csv = await streamToString(result.Body)
  fs.writeFileSync(csvOutPath, csv)

  // Athena CSV always has a header row. Subtract it; handle empty file.
  const lines = csv.split("\n").filter((l) => l.length > 0)
  return { rows: Math.max(0, lines.length - 1) }
}

// Exported for tests.
export const __internals = { stripComments, checkPhi, substitute, PHI_BLOCK_LIST }
