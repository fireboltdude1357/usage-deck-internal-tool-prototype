import type { RequestEvent } from "@sveltejs/kit"
import { error, redirect } from "@sveltejs/kit"
import { env } from "$env/dynamic/private"
import {
  workos,
  workosCookiePassword,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "$lib/server/workos"

export type Session = { user: { email: string } }

// Page requests (HTML) get redirected to login on auth failure; API requests
// get a 401 JSON. Detect via the route id — every API route lives under /api/.
function isPageRequest(event: RequestEvent): boolean {
  const id = event.route?.id ?? event.url.pathname
  return !id.startsWith("/api/")
}

function bounceToLogin(event: RequestEvent): never {
  const returnTo = event.url.pathname + event.url.search
  const target = `/api/auth/login?return_to=${encodeURIComponent(returnTo)}`
  redirect(302, target)
}

function failAuth(event: RequestEvent): never {
  event.cookies.delete(SESSION_COOKIE_NAME, { path: "/" })
  if (isPageRequest(event)) bounceToLogin(event)
  error(401, "Not signed in")
}

export async function requireSession(event: RequestEvent): Promise<Session> {
  if (env.AUTH_BYPASS === "1") {
    return { user: { email: "dev@local" } }
  }

  const sessionData = event.cookies.get(SESSION_COOKIE_NAME)
  if (!sessionData) {
    const cookieHeader = event.request.headers.get("cookie") ?? ""
    console.error("[requireSession] no wos-session cookie", {
      pathname: event.url.pathname,
      cookieHeaderBytes: cookieHeader.length,
      cookieNamesPresent: cookieHeader
        .split(";")
        .map((c) => c.split("=")[0]?.trim())
        .filter(Boolean),
    })
    if (isPageRequest(event)) bounceToLogin(event)
    error(401, "Not signed in")
  }

  const cookiePassword = workosCookiePassword()
  const session = workos().userManagement.loadSealedSession({
    sessionData,
    cookiePassword,
  })

  let auth: Awaited<ReturnType<typeof session.authenticate>>
  try {
    auth = await session.authenticate()
  } catch (e) {
    console.error("[requireSession] authenticate threw", e)
    failAuth(event)
  }

  if (auth.authenticated) {
    return { user: { email: auth.user.email } }
  }

  // The JWT expires on a short cycle (~5–10 min) but the refresh token in the
  // sealed session lives much longer. Mint a fresh sealed session instead of
  // forcing a full re-auth round-trip through AuthKit on every page load.
  if (auth.reason === "invalid_jwt") {
    let refreshed: Awaited<ReturnType<typeof session.refresh>>
    try {
      refreshed = await session.refresh({ cookiePassword })
    } catch (e) {
      console.error("[requireSession] refresh threw", e)
      failAuth(event)
    }

    if (refreshed.authenticated && refreshed.sealedSession) {
      event.cookies.set(
        SESSION_COOKIE_NAME,
        refreshed.sealedSession,
        sessionCookieOptions(event.url.protocol === "https:"),
      )
      return { user: { email: refreshed.user.email } }
    }

    console.error("[requireSession] refresh failed", {
      reason: refreshed.authenticated ? "no-sealed-session" : refreshed.reason,
    })
    failAuth(event)
  }

  console.error("[requireSession] cookie unseal returned not-authenticated", {
    reason: auth.reason,
  })
  failAuth(event)
}
