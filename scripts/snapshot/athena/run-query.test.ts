import { describe, expect, it } from "vitest"
import { __internals } from "./run-query.ts"

const { stripComments, checkPhi, substitute, PHI_BLOCK_LIST } = __internals

describe("substitute", () => {
  it("replaces every {{name}} placeholder", () => {
    const sql = "SELECT * FROM t WHERE client = '{{client}}' AND month = '{{month}}'"
    expect(substitute(sql, { client: "bsmh", month: "2026-04" })).toBe(
      "SELECT * FROM t WHERE client = 'bsmh' AND month = '2026-04'",
    )
  })

  it("substitutes repeated placeholders", () => {
    expect(substitute("{{c}} or {{c}}", { c: "bsmh" })).toBe("bsmh or bsmh")
  })

  it("throws on unbound placeholders", () => {
    expect(() => substitute("WHERE x = '{{nope}}'", { client: "bsmh" })).toThrow(
      /unbound placeholder/,
    )
  })
})

describe("stripComments", () => {
  it("removes -- line comments", () => {
    expect(stripComments("SELECT 1 -- comment\nFROM t")).toMatch(/SELECT 1\s+\s+FROM t/)
  })

  it("removes /* ... */ block comments", () => {
    expect(stripComments("SELECT /* hi */ 1 FROM t")).toMatch(/SELECT\s+1 FROM t/)
  })
})

describe("checkPhi", () => {
  it.each(PHI_BLOCK_LIST.map((t) => [t]))(
    "rejects SQL referencing %s",
    (term) => {
      expect(() => checkPhi(`SELECT ${term} FROM t`)).toThrow(/PHI-blocked/)
    },
  )

  it("ignores PHI identifiers that appear only inside comments", () => {
    // The runner uses comment stripping before scanning so the documentation
    // string `-- never select patient_id` doesn't trip the gate.
    expect(() =>
      checkPhi("-- never select patient_id\nSELECT provider_id FROM t"),
    ).not.toThrow()
  })

  it("accepts a clean provider-level query", () => {
    expect(() =>
      checkPhi(`SELECT provider_id, batch_ds FROM monthly_claims_features
        WHERE client = 'bsmh'`),
    ).not.toThrow()
  })

  it("matches case-insensitively", () => {
    expect(() => checkPhi("SELECT PATIENT_ID FROM t")).toThrow(/PHI-blocked/)
  })
})
