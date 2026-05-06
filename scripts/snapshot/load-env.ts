import * as fs from "node:fs"

// Minimal .env loader — populates process.env without overwriting existing values.
// Vendored shape from
//   parent-db-investigations/.../mcp-servers/rds-server.mjs (`loadEnv`).
export const loadEnv = (envPath: string): void => {
  if (!fs.existsSync(envPath)) return
  const text = fs.readFileSync(envPath, "utf-8")
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key || process.env[key] !== undefined) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
