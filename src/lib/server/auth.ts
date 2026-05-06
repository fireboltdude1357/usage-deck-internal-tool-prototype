import type { RequestEvent } from "@sveltejs/kit"
import { error, redirect } from "@sveltejs/kit"
import { env } from "$env/dynamic/private"
import {
  workos,
  workosCookiePassword,
  SESSION_COOKIE_NAME,
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

export async function requireSession(event: RequestEvent): Promise<Session> {
  if (env.AUTH_BYPASS === "1") {
    return { user: { email: "dev@local" } }
  }

  const sessionData = event.cookies.get(SESSION_COOKIE_NAME)
  if (!sessionData) {
    if (isPageRequest(event)) bounceToLogin(event)
    error(401, "Not signed in")
  }

  const result = await workos().userManagement.authenticateWithSessionCookie({
    sessionData,
    cookiePassword: workosCookiePassword(),
  })

  if (!result.authenticated) {
    if (isPageRequest(event)) bounceToLogin(event)
    error(401, "Not signed in")
  }

  return { user: { email: result.user.email } }
}
