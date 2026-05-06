import * as fs from "node:fs"
import * as path from "node:path"
import { parseArgs } from "node:util"
import { Schema } from "effect"
import { Client, Month } from "../../src/lib/schema/snapshot.ts"
import { loadEnv } from "./load-env.ts"
import { runQueryFile } from "./rds/run-query.ts"

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
    query: { type: "string" }, // optional: run a single .sql file by basename
  },
  strict: true,
})

if (!values.client) die("--client required (one of: bsmh, ssm, duke, ucsf)")
if (!values.month) die("--month required (YYYY-MM)")

const client = Schema.decodeUnknownSync(Client)(values.client)
const month = Schema.decodeUnknownSync(Month)(values.month)

const QUERIES_DIR = path.join(ROOT, "scripts", "snapshot", "rds", "queries")
const TMP = path.join(ROOT, "tmp", "snapshot", client, month)
fs.mkdirSync(TMP, { recursive: true })

const allFiles = fs
  .readdirSync(QUERIES_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
const targets = values.query
  ? allFiles.filter((f) => f === values.query || f === `${values.query}.sql`)
  : allFiles

if (targets.length === 0) die("no matching .sql files in scripts/snapshot/rds/queries/")

console.log(`running ${targets.length} RDS query/queries for ${client}/${month}`)

for (const file of targets) {
  const sqlPath = path.join(QUERIES_DIR, file)
  const csvPath = path.join(TMP, file.replace(/\.sql$/, ".csv"))
  console.log(`  ${file} → ${path.relative(ROOT, csvPath)}`)
  const { rows } = await runQueryFile(sqlPath, { client, month }, csvPath)
  console.log(`    ${rows} rows`)
}
