import { redirect } from "@sveltejs/kit"
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
  if (!code) redirect(302, "/api/auth/login?error=missing_code")

  const { returnTo } = decodeState(url.searchParams.get("state"))

  let user: { email: string } | undefined
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
  } catch {
    // network/auth failure from WorkOS — bounce back to login. (We don't
    // catch SvelteKit's `redirect` here because no `redirect()` runs inside
    // this try block.)
    redirect(302, "/api/auth/login?error=auth")
  }

  if (!user || !sealedSession) {
    redirect(302, "/api/auth/login?error=no_sealed_session")
  }

  if (!isEmailAllowed(user.email)) {
    redirect(302, "/api/auth/login?error=domain")
  }

  const secure = url.protocol === "https:"
  cookies.set(SESSION_COOKIE_NAME, sealedSession, sessionCookieOptions(secure))

  redirect(302, returnTo)
}
