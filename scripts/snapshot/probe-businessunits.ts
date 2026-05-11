// Ad-hoc probe: dump `public.businessunits` per client so we can attach
// human-readable names (and BU codes) to the bu_uuids PostHog returns.
// Also tally distinct businessunitname values in `public.provider_info_v2`
// per client to sanity-check that the roster path will have rows to bucket.
//
// Run: npx tsx scripts/snapshot/probe-businessunits.ts

import * as fs from "node:fs"
import * as path from "node:path"
import { Client } from "pg"
import { loadEnv } from "./load-env.ts"
import { ensureTunnel, type BastionConfig } from "./rds/bastion.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
loadEnv(path.join(ROOT, ".env"))

const get = (k: string) =>
  process.env[`RDS_STAGING_${k}`] ?? process.env[`RDS_${k}`] ?? ""

const cfg = {
  host: get("HOST"),
  port: Number(get("PORT") || 5432),
  user: get("USER"),
  password: get("PASSWORD"),
  sslRootCert: get("SSL_ROOT_CERT"),
  sslServername: get("SSL_SERVERNAME") || get("HOST"),
  bastionHost: get("BASTION_HOST"),
  bastionUser: get("BASTION_USER") || "ec2-user",
  bastionKeyPath: get("BASTION_KEY_PATH"),
  localPort: Number(get("LOCAL_PORT") || 15432),
}

const tunnel: BastionConfig = {
  host: cfg.host,
  port: cfg.port,
  bastionHost: cfg.bastionHost,
  bastionUser: cfg.bastionUser,
  bastionKeyPath: cfg.bastionKeyPath,
  localPort: cfg.localPort,
}
await ensureTunnel(tunnel)

const client = new Client({
  host: "127.0.0.1",
  port: cfg.localPort,
  database: "normform",
  user: cfg.user,
  password: cfg.password,
  ssl: {
    ca: fs.readFileSync(cfg.sslRootCert, "utf-8"),
    rejectUnauthorized: true,
    servername: cfg.sslServername,
  },
  application_name: "internal-tool-probe-businessunits",
})

await client.connect()
try {
  // 1. What columns does `businessunits` actually have?
  const cols = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'businessunits'
    ORDER BY ordinal_position
  `)
  console.log("--- public.businessunits columns ---")
  for (const r of cols.rows) console.log(`  ${r.column_name} ${r.data_type}`)

  // 2. Per-client row counts.
  const counts = await client.query(`
    SELECT client_username, COUNT(*) AS n
    FROM public.businessunits
    GROUP BY client_username
    ORDER BY client_username
  `)
  console.log("\n--- businessunits row counts by client ---")
  for (const r of counts.rows) console.log(`  ${r.client_username}: ${r.n}`)

  // 3. Dump rows for non-BSMH clients (and bsmh for cross-check).
  const dump = await client.query(`
    SELECT *
    FROM public.businessunits
    WHERE client_username IN ('bsmh', 'ssm', 'duke', 'ucsf')
    ORDER BY client_username, businessunit_name
  `)
  console.log(`\n--- businessunits rows (${dump.rows.length}) ---`)
  // Print as JSON for readable structure since column names are unknown until inspection.
  for (const r of dump.rows) {
    console.log(`  ${JSON.stringify(r)}`)
  }

  // 4. Distinct businessunitname values in provider_info_v2 per client (so we
  // can see what BU codes the roster carries — these are what map to markets).
  const piv = await client.query(`
    SELECT client_username, businessunitname, COUNT(*) AS providers
    FROM public.provider_info_v2
    WHERE client_username IN ('bsmh', 'ssm', 'duke', 'ucsf')
    GROUP BY client_username, businessunitname
    ORDER BY client_username, providers DESC
  `)
  console.log(`\n--- provider_info_v2.businessunitname counts ---`)
  for (const r of piv.rows) {
    console.log(`  ${r.client_username} | ${r.businessunitname} | ${r.providers}`)
  }
} finally {
  await client.end()
}
