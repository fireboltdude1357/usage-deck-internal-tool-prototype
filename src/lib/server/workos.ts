import { WorkOS } from "@workos-inc/node"
import { env } from "$env/dynamic/private"

// Module-scope client — re-used across requests. The SDK is stateless except
// for connection pools, so a single instance per Vercel function instance is
// correct. clientId is required at construction time so authenticateWithSessionCookie
// works (per WorkOS docs).
let cached: WorkOS | undefined

export function workos(): WorkOS {
  if (cached) return cached
  if (!env.WORKOS_API_KEY) {
    throw new Error("WORKOS_API_KEY is not configured")
  }
  if (!env.WORKOS_CLIENT_ID) {
    throw new Error("WORKOS_CLIENT_ID is not configured")
  }
  cached = new WorkOS(env.WORKOS_API_KEY, { clientId: env.WORKOS_CLIENT_ID })
  return cached
}

export function workosClientId(): string {
  if (!env.WORKOS_CLIENT_ID) throw new Error("WORKOS_CLIENT_ID is not configured")
  return env.WORKOS_CLIENT_ID
}

export function workosCookiePassword(): string {
  if (!env.WORKOS_COOKIE_PASSWORD) {
    throw new Error("WORKOS_COOKIE_PASSWORD is not configured")
  }
  return env.WORKOS_COOKIE_PASSWORD
}

export function workosRedirectUri(): string {
  if (!env.WORKOS_REDIRECT_URI) {
    throw new Error("WORKOS_REDIRECT_URI is not configured")
  }
  return env.WORKOS_REDIRECT_URI
}

export function allowedEmailDomains(): readonly string[] {
  const raw = env.ALLOWED_EMAIL_DOMAINS ?? "@atalantech.com"
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0)
}

export function isEmailAllowed(email: string): boolean {
  const lower = email.toLowerCase()
  return allowedEmailDomains().some((d) => lower.endsWith(d))
}

export const SESSION_COOKIE_NAME = "wos-session"

// `secure` is conditional so localhost (http://) cookies survive. Vercel and
// any HTTPS origin gets `secure: true`.
export function sessionCookieOptions(secure: boolean) {
  return {
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
  }
}
