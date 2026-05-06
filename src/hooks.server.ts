import type { Handle } from "@sveltejs/kit"
import { requireSession } from "$lib/server/auth"

// One gate, every route — pages and +server.ts. (+layout.server.ts does not
// cover +server.ts, per SvelteKit docs, so the gate has to live here.)
//
// /api/auth/* must be reachable while unauthenticated — the login/callback/
// logout endpoints can't require a session to function.
export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith("/api/auth/")) {
    return resolve(event)
  }
  event.locals.session = await requireSession(event)
  return resolve(event)
}
