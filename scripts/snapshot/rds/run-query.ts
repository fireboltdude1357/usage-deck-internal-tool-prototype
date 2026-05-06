import * as fs from "node:fs"
import { Client } from "pg"
import { ensureTunnel, type BastionConfig } from "./bastion.ts"

// RDS env config. Vendored shape from
//   parent-db-investigations/.../mcp-servers/rds-server.mjs (`getEnvConfig`).
// Reads `RDS_{INSTANCE}_*` env vars — `staging` is the default; legacy
// unprefixed `RDS_*` is also accepted for staging (matches the skill).

const SUPPORTED_INSTANCES = ["development", "staging"] as const
type Instance = (typeof SUPPORTED_INSTANCES)[number]
const DEFAULT_LOCAL_PORTS: Record<Instance, number> = {
  development: 15431,
  staging: 15432,
}

type RdsConfig = {
  instance: Instance
  envPrefix: string
  host: string
  port: number
  database: string
  user: string
  password: string
  sslMode: string
  sslRootCert: string
  sslServername: string
  bastionHost: string
  bastionUser: string
  bastionKeyPath: string
  localPort: number
}

const getInstance = (): Instance => {
  const v = (process.env.RDS_INSTANCE ?? "staging").trim().toLowerCase()
  if (!SUPPORTED_INSTANCES.includes(v as Instance)) {
    throw new Error(`Unsupported RDS_INSTANCE "${v}" (expected one of ${SUPPORTED_INSTANCES.join(", ")})`)
  }
  return v as Instance
}

const scoped = (
  key: string,
  envPrefix: string,
  allowLegacyFallback: boolean,
): string | undefined => {
  const prefixed = process.env[`${envPrefix}${key}`]
  if (prefixed !== undefined && prefixed !== "") return prefixed
  if (allowLegacyFallback) return process.env[`RDS_${key}`]
  return undefined
}

const loadConfig = (): RdsConfig => {
  const instance = getInstance()
  const envPrefix = `RDS_${instance.toUpperCase()}_`
  const allowLegacy = instance === "staging"

  const host = scoped("HOST", envPrefix, allowLegacy)?.trim()
  const user = scoped("USER", envPrefix, allowLegacy)?.trim()
  const password = scoped("PASSWORD", envPrefix, allowLegacy)
  if (!host || !user || !password) {
    const legacyHint = allowLegacy ? " (legacy RDS_* also accepted for staging)" : ""
    throw new Error(
      `Missing RDS config for ${instance}: set ${envPrefix}HOST, ${envPrefix}USER, ${envPrefix}PASSWORD${legacyHint}`,
    )
  }

  return {
    instance,
    envPrefix,
    host,
    port: Number(scoped("PORT", envPrefix, allowLegacy) ?? 5432),
    database: "normform",
    user,
    password,
    sslMode: (scoped("SSLMODE", envPrefix, allowLegacy) ?? "verify-full").trim().toLowerCase(),
    sslRootCert: scoped("SSL_ROOT_CERT", envPrefix, allowLegacy)?.trim() ?? "",
    sslServername: scoped("SSL_SERVERNAME", envPrefix, allowLegacy)?.trim() ?? host,
    bastionHost: scoped("BASTION_HOST", envPrefix, allowLegacy)?.trim() ?? "",
    bastionUser: scoped("BASTION_USER", envPrefix, allowLegacy)?.trim() ?? "ec2-user",
    bastionKeyPath: scoped("BASTION_KEY_PATH", envPrefix, allowLegacy)?.trim() ?? "",
    localPort: Number(
      scoped("LOCAL_PORT", envPrefix, allowLegacy) ?? DEFAULT_LOCAL_PORTS[instance],
    ),
  }
}

const buildSsl = (
  config: RdsConfig,
): false | { ca?: string; rejectUnauthorized: boolean; servername: string } => {
  if (config.sslMode === "disable") return false
  if (config.sslMode === "require") {
    return { rejectUnauthorized: false, servername: config.sslServername }
  }
  if (!config.sslRootCert) {
    throw new Error(
      `${config.envPrefix}SSL_ROOT_CERT is required when ${config.envPrefix}SSLMODE is verify-ca or verify-full`,
    )
  }
  if (!fs.existsSync(config.sslRootCert)) {
    throw new Error(`${config.envPrefix}SSL_ROOT_CERT not found: ${config.sslRootCert}`)
  }
  return {
    ca: fs.readFileSync(config.sslRootCert, "utf-8"),
    rejectUnauthorized: true,
    servername: config.sslServername,
  }
}

const escapeCsv = (value: unknown): string => {
  if (value === null || value === undefined) return ""
  const s = value instanceof Date ? value.toISOString() : String(value)
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// Convert `{{client}}` (and any other named placeholders) to numbered Postgres
// params. Reuses the same param index for repeated occurrences.
const compile = (
  sql: string,
  bindings: Record<string, string>,
): { text: string; params: string[] } => {
  const order: string[] = []
  const text = sql.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    if (!(name in bindings)) {
      throw new Error(`unbound placeholder {{${name}}} in SQL`)
    }
    let idx = order.indexOf(name)
    if (idx === -1) {
      idx = order.length
      order.push(name)
    }
    return `$${idx + 1}`
  })
  return { text, params: order.map((n) => bindings[n]) }
}

export const runQueryFile = async (
  sqlPath: string,
  bindings: Record<string, string>,
  csvOutPath: string,
): Promise<{ rows: number }> => {
  const sql = fs.readFileSync(sqlPath, "utf8")
  const { text, params } = compile(sql, bindings)

  const config = loadConfig()
  let host = config.host
  let port = config.port
  if (config.bastionHost) {
    const tunnel: BastionConfig = {
      host: config.host,
      port: config.port,
      bastionHost: config.bastionHost,
      bastionUser: config.bastionUser,
      bastionKeyPath: config.bastionKeyPath,
      localPort: config.localPort,
    }
    await ensureTunnel(tunnel)
    host = "127.0.0.1"
    port = config.localPort
  }

  const client = new Client({
    host,
    port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: buildSsl(config),
    statement_timeout: 120000,
    query_timeout: 120000,
    connectionTimeoutMillis: 15000,
    application_name: "internal-tool-snapshot",
  })

  try {
    await client.connect()
    const result = await client.query(text, params)
    const columns = result.fields.map((f) => f.name)
    const lines = [columns.join(",")]
    for (const row of result.rows) {
      lines.push(columns.map((c) => escapeCsv(row[c])).join(","))
    }
    fs.writeFileSync(csvOutPath, lines.join("\n") + "\n")
    return { rows: result.rows.length }
  } finally {
    try { await client.end() } catch {}
  }
}
