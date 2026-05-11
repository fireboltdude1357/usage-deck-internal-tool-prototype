import * as path from "node:path"
import { Client } from "pg"
import { loadEnv } from "./load-env.ts"
import { ensureTunnel, type BastionConfig } from "./rds/bastion.ts"
import * as fs from "node:fs"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
loadEnv(path.join(ROOT, ".env"))

const envPrefix = "RDS_STAGING_"
const get = (k: string) =>
  process.env[`${envPrefix}${k}`] ?? process.env[`RDS_${k}`] ?? ""

const config = {
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
  host: config.host,
  port: config.port,
  bastionHost: config.bastionHost,
  bastionUser: config.bastionUser,
  bastionKeyPath: config.bastionKeyPath,
  localPort: config.localPort,
}
await ensureTunnel(tunnel)

const client = new Client({
  host: "127.0.0.1",
  port: config.localPort,
  database: "normform",
  user: config.user,
  password: config.password,
  ssl: {
    ca: fs.readFileSync(config.sslRootCert, "utf-8"),
    rejectUnauthorized: true,
    servername: config.sslServername,
  },
  application_name: "internal-tool-probe-earliest",
})

await client.connect()
try {
  const r = await client.query(`
    SELECT client_username,
           MIN(run_date)::text AS min_run_date,
           MAX(run_date)::text AS max_run_date,
           COUNT(DISTINCT run_date) AS distinct_runs,
           COUNT(*) AS total_rows
    FROM public.provider_quit_risk_v2
    GROUP BY client_username
    ORDER BY client_username
  `)
  console.log("client_username | min_run_date | max_run_date | distinct_runs | total_rows")
  console.log("----------------------------------------------------------------------------")
  for (const row of r.rows) {
    console.log(
      `${row.client_username} | ${row.min_run_date} | ${row.max_run_date} | ${row.distinct_runs} | ${row.total_rows}`,
    )
  }

  const r2 = await client.query(`
    SELECT client_username, run_date::text AS run_date, COUNT(*) AS rows
    FROM public.provider_quit_risk_v2
    GROUP BY client_username, run_date
    ORDER BY client_username, run_date
  `)
  console.log("\n--- all (client, run_date) combinations ---")
  for (const row of r2.rows) {
    console.log(`${row.client_username} | ${row.run_date} | ${row.rows}`)
  }
} finally {
  await client.end()
}
