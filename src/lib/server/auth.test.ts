import { beforeEach, describe, expect, it, vi } from "vitest"
import type { RequestEvent } from "@sveltejs/kit"

const mockEnv: { AUTH_BYPASS?: string } = {}
const mockAuthenticate = vi.fn()

vi.mock("$env/dynamic/private", () => ({
  env: mockEnv,
}))

vi.mock("$lib/server/workos", () => ({
  workos: () => ({
    userManagement: {
      authenticateWithSessionCookie: mockAuthenticate,
    },
  }),
  workosCookiePassword: () => "test-cookie-password",
  SESSION_COOKIE_NAME: "wos-session",
}))

// Imported after the mocks so the module body picks them up.
const { requireSession } = await import("./auth")

const makeEvent = (opts: {
  routeId: string
  pathname: string
  cookie?: string
}): RequestEvent =>
  ({
    route: { id: opts.routeId },
    url: new URL(`http://localhost:5173${opts.pathname}`),
    cookies: {
      get: (name: string) =>
        name === "wos-session" ? opts.cookie : undefined,
      delete: () => undefined,
    },
  }) as unknown as RequestEvent

describe("requireSession", () => {
  beforeEach(() => {
    mockEnv.AUTH_BYPASS = undefined
    mockAuthenticate.mockReset()
  })

  it("returns dev session when AUTH_BYPASS=1", async () => {
    mockEnv.AUTH_BYPASS = "1"
    const event = makeEvent({ routeId: "/(app)", pathname: "/" })
    expect(await requireSession(event)).toEqual({
      user: { email: "dev@local" },
    })
    expect(mockAuthenticate).not.toHaveBeenCalled()
  })

  it("redirects page request to login when no cookie", async () => {
    const event = makeEvent({
      routeId: "/platform-engagement",
      pathname: "/platform-engagement",
    })
    await expect(requireSession(event)).rejects.toMatchObject({
      status: 302,
      location:
        "/api/auth/login?return_to=" + encodeURIComponent("/platform-engagement"),
    })
  })

  it("throws 401 for API request when no cookie", async () => {
    const event = makeEvent({
      routeId: "/api/snapshot/[client]/[month]/[file]",
      pathname: "/api/snapshot/bsmh/2026-04/metrics.json",
    })
    await expect(requireSession(event)).rejects.toMatchObject({ status: 401 })
  })

  it("redirects page request when cookie unseal fails", async () => {
    mockAuthenticate.mockResolvedValueOnce({
      authenticated: false,
      reason: "invalid",
    })
    const event = makeEvent({
      routeId: "/provisioned-users",
      pathname: "/provisioned-users",
      cookie: "garbage",
    })
    await expect(requireSession(event)).rejects.toMatchObject({ status: 302 })
  })

  it("throws 401 for API request when cookie unseal fails", async () => {
    mockAuthenticate.mockResolvedValueOnce({
      authenticated: false,
      reason: "invalid",
    })
    const event = makeEvent({
      routeId: "/api/posthog/[client]/[metric]",
      pathname: "/api/posthog/bsmh/platform",
      cookie: "garbage",
    })
    await expect(requireSession(event)).rejects.toMatchObject({ status: 401 })
  })

  it("returns session with email when cookie unseals", async () => {
    mockAuthenticate.mockResolvedValueOnce({
      authenticated: true,
      user: { email: "alice@atalantech.com" },
      sessionId: "sess_123",
    })
    const event = makeEvent({
      routeId: "/platform-engagement",
      pathname: "/platform-engagement",
      cookie: "valid",
    })
    expect(await requireSession(event)).toEqual({
      user: { email: "alice@atalantech.com" },
    })
  })
})
