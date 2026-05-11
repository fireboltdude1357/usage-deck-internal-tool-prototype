import * as fs from "node:fs"
import * as path from "node:path"
import { parseArgs } from "node:util"
import { Schema } from "effect"
import { Client, Month } from "../../src/lib/schema/snapshot.ts"
import { loadEnv } from "./load-env.ts"
import { runQueryFile as runRdsQueryFile } from "./rds/run-query.ts"
import { runAthenaQueryFile } from "./athena/run-query.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")

loadEnv(path.join(ROOT, ".env"))

const die = (msg: string): never => {
  console.error(`error: ${msg}`)
  process.exit(1)
}

const SOURCES = ["all", "rds", "athena"] as const
type Source = (typeof SOURCES)[number]

const { values } = parseArgs({
  options: {
    client: { type: "string" },
    month: { type: "string" },
    query: { type: "string" }, // optional: run a single .sql file by basename
    source: { type: "string", default: "all" }, // rds | athena | all
  },
  strict: true,
})

if (!values.client) die("--client required (one of: bsmh, ssm, duke, ucsf)")
if (!values.month) die("--month required (YYYY-MM)")
if (!SOURCES.includes(values.source as Source)) {
  die(`--source must be one of: ${SOURCES.join(", ")}`)
}

const client = Schema.decodeUnknownSync(Client)(values.client)
const month = Schema.decodeUnknownSync(Month)(values.month)
const source = values.source as Source

const RDS_DIR = path.join(ROOT, "scripts", "snapshot", "rds", "queries")
const ATHENA_DIR = path.join(ROOT, "scripts", "snapshot", "athena", "queries")
const TMP = path.join(ROOT, "tmp", "snapshot", client, month)
fs.mkdirSync(TMP, { recursive: true })

const listSql = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
    : []

const matchesQuery = (file: string): boolean => {
  if (!values.query) return true
  return file === values.query || file === `${values.query}.sql`
}

interface Job {
  source: "rds" | "athena"
  file: string
  dir: string
}

const jobs: Job[] = []
if (source === "all" || source === "rds") {
  for (const f of listSql(RDS_DIR).filter(matchesQuery)) {
    jobs.push({ source: "rds", file: f, dir: RDS_DIR })
  }
}
if (source === "all" || source === "athena") {
  for (const f of listSql(ATHENA_DIR).filter(matchesQuery)) {
    jobs.push({ source: "athena", file: f, dir: ATHENA_DIR })
  }
}

if (jobs.length === 0) {
  const where =
    source === "all"
      ? "scripts/snapshot/{rds,athena}/queries/"
      : `scripts/snapshot/${source}/queries/`
  die(`no matching .sql files in ${where}`)
}

const rdsCount = jobs.filter((j) => j.source === "rds").length
const athenaCount = jobs.filter((j) => j.source === "athena").length
console.log(
  `running ${jobs.length} query/queries for ${client}/${month}` +
    ` (${rdsCount} RDS, ${athenaCount} Athena)`,
)

for (const job of jobs) {
  const sqlPath = path.join(job.dir, job.file)
  const csvPath = path.join(TMP, job.file.replace(/\.sql$/, ".csv"))
  console.log(`  [${job.source}] ${job.file} → ${path.relative(ROOT, csvPath)}`)
  const run = job.source === "rds" ? runRdsQueryFile : runAthenaQueryFile
  const { rows } = await run(sqlPath, { client, month }, csvPath)
  console.log(`    ${rows} rows`)
}
