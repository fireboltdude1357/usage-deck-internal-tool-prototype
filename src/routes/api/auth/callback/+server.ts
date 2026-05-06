import { error, redirect } from "@sveltejs/kit"
import {
  workos,
  workosClientId,
  workosCookiePassword,
  isEmailAllowed,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "$lib/server/workos"
import type { RequestHandler } from "./$types"

function decodeState(raw: string | null): { returnTo: string } {
  if (!raw) return { returnTo: "/" }
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    const returnTo =
      typeof parsed?.returnTo === "string" &&
      parsed.returnTo.startsWith("/") &&
      !parsed.returnTo.startsWith("//")
        ? parsed.returnTo
        : "/"
    return { returnTo }
  } catch {
    return { returnTo: "/" }
  }
}

export const GET: RequestHandler = async ({ url, cookies }) => {
  const code = url.searchParams.get("code")
  if (!code) error(400, "callback: missing code")

  const { returnTo } = decodeState(url.searchParams.get("state"))

  // Auth failures here MUST NOT redirect back to /api/auth/login. AuthKit
  // would silently re-authenticate via its own session, hit this callback
  // again, fail again — ERR_TOO_MANY_REDIRECTS. Surface the error so it's
  // diagnosable in Vercel function logs.
  let user: { email: string }
  let sealedSession: string | undefined
  try {
    const result = await workos().userManagement.authenticateWithCode({
      clientId: workosClientId(),
      code,
      session: {
        sealSession: true,
        cookiePassword: workosCookiePassword(),
      },
    })
    user = result.user
    sealedSession = result.sealedSession
  } catch (e) {
    console.error("[/api/auth/callback] authenticateWithCode failed", e)
    error(500, `auth callback: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!sealedSession) {
    console.error("[/api/auth/callback] no sealedSession on response", { user })
    error(500, "auth callback: WorkOS returned no sealed session")
  }

  if (!isEmailAllowed(user.email)) {
    redirect(302, `/?error=domain&email=${encodeURIComponent(user.email)}`)
  }

  const secure = url.protocol === "https:"
  console.log("[/api/auth/callback] setting wos-session cookie", {
    sealedSessionBytes: sealedSession.length,
    secure,
    returnTo,
    email: user.email,
  })
  cookies.set(SESSION_COOKIE_NAME, sealedSession, sessionCookieOptions(secure))

  redirect(302, returnTo)
}
