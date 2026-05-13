import * as fs from "node:fs"
import * as path from "node:path"
import { parseArgs } from "node:util"
import { parse as parseCsv } from "csv-parse/sync"
import { Schema } from "effect"
import { loadEnv } from "./load-env.ts"
import {
  AdoptionEngagementSnapshot,
  Client,
  MarketSnapshot,
  Month,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
  SnapshotFileSchema,
  SuccessStoriesSnapshot,
  type SnapshotFile,
} from "../../src/lib/schema/snapshot.ts"
import {
  buildAdoptionEngagementSnapshot,
  buildMarketSnapshot,
  buildPlatformSnapshot,
  buildProvisionedSnapshot,
  type EnvelopeOpts,
  type RosterRow,
} from "./shape/roster.ts"
import {
  buildSuccessStoriesSnapshot,
  type ClaimsMonthlyRow,
  type EhrMonthlyRow,
  type EncountersMonthlyRow,
  type ProviderMetadataRow,
  type QuitProbRow,
} from "./shape/success-stories.ts"
import { roundtrip } from "./schema-roundtrip.ts"

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

const TMP = path.join(ROOT, "tmp", "snapshot", client, month)
const ROSTER_CSV = path.join(TMP, "clinician-roster.csv")

if (!fs.existsSync(ROSTER_CSV)) {
  die(
    `missing ${path.relative(ROOT, ROSTER_CSV)} — drop the rds-query CSV here first`,
  )
}

const readCsv = <T>(file: string): T[] =>
  parseCsv(fs.readFileSync(file), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as T[]

const rosterRows = readCsv<RosterRow>(ROSTER_CSV)

console.log(`read ${rosterRows.length} roster rows`)

// Success-stories inputs are optional — when any are absent, the success-
// stories job skips itself. Earlier snapshots (pre Athena-seam) only had
// the roster CSV.
const SUCCESS_INPUTS = {
  metadata: path.join(TMP, "provider-metadata.csv"),
  quitProb: path.join(TMP, "quit-prob-trajectories.csv"),
  claims: path.join(TMP, "claims-monthly.csv"),
  encounters: path.join(TMP, "encounters-monthly.csv"),
  ehr: path.join(TMP, "ehr-monthly.csv"),
} as const

const haveAllSuccessInputs = Object.values(SUCCESS_INPUTS).every((p) =>
  fs.existsSync(p),
)

fs.mkdirSync(TMP, { recursive: true })

const env: EnvelopeOpts = {
  client,
  month,
  generated_at: new Date().toISOString(),
}

type Job = { file: SnapshotFile; build: () => unknown; schema: Schema.Schema<unknown, unknown> }

const jobs: Job[] = [
  {
    file: "metrics.json",
    build: () => buildPlatformSnapshot(rosterRows, env),
    schema: PlatformSnapshot as unknown as Schema.Schema<unknown, unknown>,
  },
  {
    file: "market_metrics.json",
    build: () => buildMarketSnapshot(rosterRows, env),
    schema: MarketSnapshot as unknown as Schema.Schema<unknown, unknown>,
  },
  {
    file: "provisioned_users.json",
    build: () => buildProvisionedSnapshot(rosterRows, env),
    schema: ProvisionedUsersSnapshot as unknown as Schema.Schema<unknown, unknown>,
  },
  {
    file: "adoption_engagement.json",
    build: () => buildAdoptionEngagementSnapshot(rosterRows, env),
    schema: AdoptionEngagementSnapshot as unknown as Schema.Schema<unknown, unknown>,
  },
]

if (haveAllSuccessInputs) {
  jobs.push({
    file: "success_stories.json",
    build: () =>
      buildSuccessStoriesSnapshot(
        {
          roster: rosterRows,
          metadata: readCsv<ProviderMetadataRow>(SUCCESS_INPUTS.metadata),
          quitProb: readCsv<QuitProbRow>(SUCCESS_INPUTS.quitProb),
          claims: readCsv<ClaimsMonthlyRow>(SUCCESS_INPUTS.claims),
          encounters: readCsv<EncountersMonthlyRow>(SUCCESS_INPUTS.encounters),
          ehr: readCsv<EhrMonthlyRow>(SUCCESS_INPUTS.ehr),
        },
        env,
      ),
    schema: SuccessStoriesSnapshot as unknown as Schema.Schema<unknown, unknown>,
  })
} else if (onlyFile === "success_stories.json") {
  const missing = Object.entries(SUCCESS_INPUTS)
    .filter(([, p]) => !fs.existsSync(p))
    .map(([, p]) => path.relative(ROOT, p))
  die(`success_stories.json requested but missing inputs: ${missing.join(", ")}`)
}

const selected = onlyFile ? jobs.filter((j) => j.file === onlyFile) : jobs

for (const job of selected) {
  try {
    const value = job.build()
    const encoded = roundtrip(job.schema, value)
    const out = path.join(TMP, job.file)
    fs.writeFileSync(out, JSON.stringify(encoded, null, 2) + "\n")
    console.log(`  wrote ${path.relative(ROOT, out)}`)
  } catch (err) {
    console.error(`schema mismatch for ${job.file}:`)
    console.error(err)
    process.exit(1)
  }
}
