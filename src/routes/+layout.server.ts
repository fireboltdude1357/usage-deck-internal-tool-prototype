import type { LayoutServerLoad } from "./$types"

// Auth is enforced in src/hooks.server.ts (covers +server.ts too). This load
// just surfaces the session from locals to pages that want to read it.
export const load: LayoutServerLoad = async ({ locals }) => {
  return { session: locals.session }
}
