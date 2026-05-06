import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as net from "node:net"

// SSH bastion tunnel manager. Vendored from
//   parent-db-investigations/.../mcp-servers/rds-server.mjs
// (the `ensureTunnel`/`canConnect`/`waitForTunnel`/lock helpers).
// Same env-var contract — `RDS_{INSTANCE}_BASTION_*` — so existing creds work.

export type BastionConfig = {
  host: string // RDS hostname (the tunnel destination)
  port: number // RDS port
  bastionHost: string
  bastionUser: string
  bastionKeyPath: string
  localPort: number
}

export const ensureTunnel = async (config: BastionConfig): Promise<void> => {
  if (!config.bastionUser || !config.bastionKeyPath) {
    throw new Error("Bastion tunneling requires bastionUser and bastionKeyPath")
  }
  if (!fs.existsSync(config.bastionKeyPath)) {
    throw new Error(`Bastion key not found: ${config.bastionKeyPath}`)
  }

  if (await canConnect("127.0.0.1", config.localPort, 500)) return

  const lockPath = `/tmp/internal-tool-rds-tunnel-${config.localPort}.lock`
  const lockFd = tryAcquireLock(lockPath)
  if (lockFd === null) {
    await waitForTunnel(config.localPort, 15000)
    return
  }

  try {
    if (await canConnect("127.0.0.1", config.localPort, 500)) return

    const args = [
      "-i", config.bastionKeyPath,
      "-o", "BatchMode=yes",
      "-o", "ExitOnForwardFailure=yes",
      "-o", "ServerAliveInterval=30",
      "-o", "StrictHostKeyChecking=no",
      "-f",
      "-N",
      "-L", `${config.localPort}:${config.host}:${config.port}`,
      `${config.bastionUser}@${config.bastionHost}`,
    ]

    const result = spawnSync("ssh", args, { encoding: "utf-8", timeout: 15000 })

    if (result.status !== 0) {
      const errorText = (result.stderr || result.stdout || "unknown error").trim()
      if (errorText.includes("Address already in use")) {
        await waitForTunnel(config.localPort, 5000)
        return
      }
      throw new Error(`Failed to open SSH tunnel: ${errorText}`)
    }

    await waitForTunnel(config.localPort, 5000)
  } finally {
    releaseLock(lockFd, lockPath)
  }
}

const canConnect = (host: string, port: number, timeoutMs: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once("connect", () => finish(true))
    socket.once("timeout", () => finish(false))
    socket.once("error", () => finish(false))
    socket.connect(port, host)
  })

const tryAcquireLock = (lockPath: string): number | null => {
  try {
    return fs.openSync(lockPath, "wx")
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return null
    throw err
  }
}

const releaseLock = (fd: number, lockPath: string): void => {
  try { fs.closeSync(fd) } catch {}
  try { fs.unlinkSync(lockPath) } catch {}
}

const waitForTunnel = async (port: number, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await canConnect("127.0.0.1", port, 500)) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`SSH tunnel did not become ready on localhost:${port}`)
}
