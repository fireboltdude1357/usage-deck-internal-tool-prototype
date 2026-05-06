import type { Handle } from "@sveltejs/kit"
import { requireSession } from "$lib/server/auth"

// One gate, every route — pages and +server.ts. (+layout.server.ts does not
// cover +server.ts, per SvelteKit docs, so the gate has to live here.)
export const handle: Handle = async ({ event, resolve }) => {
  event.locals.session = await requireSession(event)
  return resolve(event)
}
