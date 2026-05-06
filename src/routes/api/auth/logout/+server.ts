import { redirect } from "@sveltejs/kit"
import {
  workos,
  workosCookiePassword,
  SESSION_COOKIE_NAME,
} from "$lib/server/workos"
import type { RequestHandler } from "./$types"

// Tearing down auth requires two steps: clearing our `wos-session` cookie AND
// destroying the WorkOS-side session. If we only clear our cookie, AuthKit's
// own SSO session silently re-authenticates the user on the next /api/auth/login
// — they'd appear to never sign out. `getLogoutUrl()` returns a WorkOS URL that
// destroys the WorkOS session, after which WorkOS redirects back to the
// "App homepage URL" / "Sign-out redirect" configured in the dashboard.
export const GET: RequestHandler = async ({ cookies }) => {
  const sessionData = cookies.get(SESSION_COOKIE_NAME)

  // Always clear our cookie, even if the unseal fails or we have no session
  // — better to over-clear than leave a stale sealed cookie around.
  cookies.delete(SESSION_COOKIE_NAME, { path: "/" })

  if (!sessionData) {
    redirect(302, "/")
  }

  let logoutUrl: string
  try {
    const session = await workos().userManagement.loadSealedSession({
      sessionData,
      cookiePassword: workosCookiePassword(),
    })
    logoutUrl = await session.getLogoutUrl()
  } catch {
    // Sealed session may already be invalid (rotated cookie password, expired,
    // tampered). Fall back to the local-only redirect — next request will
    // bounce to login normally, and AuthKit will re-prompt because the cookie
    // we just cleared was the only thing carrying their identity to us.
    redirect(302, "/")
  }

  redirect(302, logoutUrl)
}
