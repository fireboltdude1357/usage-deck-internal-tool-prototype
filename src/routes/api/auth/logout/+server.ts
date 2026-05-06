import { redirect } from "@sveltejs/kit"
import { SESSION_COOKIE_NAME } from "$lib/server/workos"
import type { RequestHandler } from "./$types"

export const GET: RequestHandler = async ({ cookies }) => {
  cookies.delete(SESSION_COOKIE_NAME, { path: "/" })
  redirect(302, "/")
}
