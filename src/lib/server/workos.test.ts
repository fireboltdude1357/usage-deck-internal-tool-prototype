import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv: { ALLOWED_EMAIL_DOMAINS?: string } = {}

vi.mock("$env/dynamic/private", () => ({
  env: mockEnv,
}))

const { isEmailAllowed, allowedEmailDomains } = await import("./workos")

describe("isEmailAllowed", () => {
  beforeEach(() => {
    mockEnv.ALLOWED_EMAIL_DOMAINS = undefined
  })

  it("defaults to @atalantech.com when env var is unset", () => {
    expect(allowedEmailDomains()).toEqual(["@atalantech.com"])
    expect(isEmailAllowed("alice@atalantech.com")).toBe(true)
    expect(isEmailAllowed("alice@gmail.com")).toBe(false)
  })

  it("is case-insensitive", () => {
    expect(isEmailAllowed("ALICE@AtalanTech.COM")).toBe(true)
  })

  it("supports a comma-separated allowlist", () => {
    mockEnv.ALLOWED_EMAIL_DOMAINS = "@atalantech.com, @contractors.io"
    expect(isEmailAllowed("bob@contractors.io")).toBe(true)
    expect(isEmailAllowed("alice@atalantech.com")).toBe(true)
    expect(isEmailAllowed("eve@elsewhere.com")).toBe(false)
  })

  it("rejects look-alike subdomains", () => {
    // Suffix match plus the leading "@" guards against e.g. "atalantech.com.evil.net".
    expect(isEmailAllowed("alice@evil-atalantech.com")).toBe(false)
    expect(isEmailAllowed("alice@atalantech.com.evil.net")).toBe(false)
  })
})
