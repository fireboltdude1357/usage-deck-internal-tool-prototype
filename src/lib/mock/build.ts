import * as fs from "node:fs"
import * as path from "node:path"
import { Schema } from "effect"
import {
  AdoptionEngagementSnapshot,
  MarketSnapshot,
  PlatformSnapshot,
  ProvisionedUsersSnapshot,
  SuccessStoriesSnapshot,
  TurnoverSnapshot,
} from "../schema/snapshot.js"
import { roundtrip } from "../../../scripts/snapshot/schema-roundtrip.js"
import {
  adoptionEngagement,
  market,
  platform,
  provisionedUsers,
  successStories,
  turnover,
} from "./bsmh-2026-04.js"

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..")
const OUT_DIR = path.join(ROOT, "fixtures", "snapshots", "bsmh", "2026-04")

const writeOne = <A, I>(
  schema: Schema.Schema<A, I>,
  filename: string,
  value: A,
): void => {
  const encoded = roundtrip(schema, value)
  fs.writeFileSync(path.join(OUT_DIR, filename), JSON.stringify(encoded, null, 2) + "\n")
  console.log(`  wrote ${filename}`)
}

fs.mkdirSync(OUT_DIR, { recursive: true })
console.log(`Writing fixtures to ${path.relative(ROOT, OUT_DIR)}`)
writeOne(PlatformSnapshot, "metrics.json", platform)
writeOne(MarketSnapshot, "market_metrics.json", market)
writeOne(ProvisionedUsersSnapshot, "provisioned_users.json", provisionedUsers)
writeOne(SuccessStoriesSnapshot, "success_stories.json", successStories)
writeOne(AdoptionEngagementSnapshot, "adoption_engagement.json", adoptionEngagement)
writeOne(TurnoverSnapshot, "turnover.json", turnover)
console.log("Done.")
