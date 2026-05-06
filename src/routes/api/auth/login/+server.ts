import { redirect } from "@sveltejs/kit"
import { workos, workosClientId, workosRedirectUri } from "$lib/server/workos"
import type { RequestHandler } from "./$types"

// Reject anything that isn't a same-origin path. Blocks open-redirect via
// `?return_to=//evil.com/...` (browsers treat protocol-relative URLs as absolute).
function safeReturnTo(raw: string | null): string {
  if (!raw) return "/"
  if (!raw.startsWith("/")) return "/"
  if (raw.startsWith("//")) return "/"
  return raw
}

function encodeState(returnTo: string): string {
  return Buffer.from(JSON.stringify({ returnTo }), "utf8").toString("base64url")
}

export const GET: RequestHandler = async ({ url }) => {
  const returnTo = safeReturnTo(url.searchParams.get("return_to"))
  const state = encodeState(returnTo)

  const authorizationUrl = workos().userManagement.getAuthorizationUrl({
    provider: "authkit",
    clientId: workosClientId(),
    redirectUri: workosRedirectUri(),
    state,
  })

  redirect(302, authorizationUrl)
}
