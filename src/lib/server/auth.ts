import type { RequestEvent } from "@sveltejs/kit"
import { error } from "@sveltejs/kit"
import { env } from "$env/dynamic/private"

export type Session = { user: { email: string } }

// Phase 07 replaces the body of this function with a real WorkOS check.
// The signature is the contract — keep it.
export async function requireSession(_event: RequestEvent): Promise<Session> {
  if (env.AUTH_BYPASS === "1") {
    return { user: { email: "dev@local" } }
  }
  throw error(401, "Not signed in")
}
