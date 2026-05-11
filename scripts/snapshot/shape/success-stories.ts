import type {
  Client,
  Month,
  SuccessStoriesSnapshot,
  SuccessStoryProvider,
  SuccessStoryProviderMonth,
} from "$lib/schema/snapshot"
import { BU_CODE_MARKET } from "./bu-mapping.js"
import type { RosterRow } from "./roster.js"

// CSV row shapes — `csv-parse/sync` returns string values; the shaper coerces.
export type ProviderMetadataRow = {
  provider_id: string
  provider_name: string
  specialty: string
  category: string
  department: string
  quit_prob: string
  run_date: string
  model_ds: string
}

export type QuitProbRow = {
  provider_id: string
  run_date: string // YYYY-MM-DD (1st of month)
  quit_prob: string
}

export type ClaimsMonthlyRow = {
  provider_id: string
  batch_ds: string // YYYY-MM-DD (1st of month)
  procedures: string
  work_rvu: string
}

export type EncountersMonthlyRow = {
  provider_id: string
  batch_ds: string
  encounters: string
  enc_duration: string
}

export type EhrMonthlyRow = {
  provider_id: string
  batch_ds: string
  doc_time: string
  admin_time: string
}

export type SuccessStoriesEnvelopeOpts = {
  client: Client
  month: Month
  generated_at: string
}

// Display formatting — the dashboard renders specialty/category/department
// from raw RDS strings, but the iter-12 script normalizes common shorthands.
// Kept here so the JSON snapshot is renderable as-is.
const SPECIALTY_MAP: Record<string, string> = {
  family: "Family Medicine",
  cardio: "Cardiology",
  behavioral_health: "Behavioral Health",
  internal: "Internal Medicine",
  surgery: "Surgery",
  surgery_general: "General Surgery",
  palliative: "Palliative Care",
  neuro: "Neurology",
  hospitalist: "Hospitalist",
  physical: "Physical Medicine",
  psychiatry: "Psychiatry",
  ENT: "ENT",
  ob_gyn: "OB/GYN",
  geriatric: "Geriatrics",
  orthopedic: "Orthopedics",
  gastro: "Gastroenterology",
  oncology: "Oncology",
  urology: "Urology",
  rheuma: "Rheumatology",
  anesthesiology: "Anesthesiology",
  pulmonology: "Pulmonology",
  vascular_surgery: "Vascular Surgery",
  cardiac_surgery: "Cardiac Surgery",
}
const CATEGORY_MAP: Record<string, string> = {
  physician: "Physician",
  allied_health: "Allied Health",
  advanced_practice_registered_nurse: "APRN",
  physician_assistant: "PA",
  admin: "Admin",
}

const titleCase = (s: string): string =>
  s === s.toUpperCase()
    ? s.replace(/\b\w/g, (c) => c.toUpperCase()).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : s

const fmtSpec = (s: string): string =>
  SPECIALTY_MAP[s] ?? (s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown")

const fmtCat = (s: string): string =>
  CATEGORY_MAP[s] ?? (s ? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown")

const trimDeptCode = (s: string): string => {
  if (!s) return ""
  const idx = s.indexOf(" : ")
  return idx === -1 ? s : s.slice(idx + 3)
}

const safeFloat = (v: string | undefined | null): number | null => {
  if (v === undefined || v === null) return null
  const s = v.trim().replace(/^"/, "").replace(/"$/, "")
  if (s === "" || s.toLowerCase() === "null") return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const cleanId = (s: string): string => s.trim().replace(/^"/, "").replace(/"$/, "")

const toMonth = (ds: string): Month => ds.trim().slice(0, 7) as Month

// Group CSV rows by provider_id with an arbitrary aggregator. Skips rows with
// empty provider_id (the iter-12 trajectory CSV sometimes carries blanks).
const groupBy = <T extends { provider_id: string }>(
  rows: readonly T[],
): Map<string, T[]> => {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const id = cleanId(r.provider_id)
    if (!id) continue
    const list = out.get(id) ?? []
    list.push(r)
    out.set(id, list)
  }
  return out
}

const indexById = <T extends { provider_id: string }>(rows: readonly T[]): Map<string, T> => {
  const out = new Map<string, T>()
  for (const r of rows) {
    const id = cleanId(r.provider_id)
    if (!id) continue
    out.set(id, r)
  }
  return out
}

export interface SuccessStoriesInputs {
  roster: readonly RosterRow[]
  metadata: readonly ProviderMetadataRow[]
  quitProb: readonly QuitProbRow[]
  claims: readonly ClaimsMonthlyRow[]
  encounters: readonly EncountersMonthlyRow[]
  ehr: readonly EhrMonthlyRow[]
}

// Build the raw per-provider per-month series. The pre/post split + improvement
// derivation happens live in the page loader against the user-selected range
// (see src/lib/success-stories.ts).
export const buildSuccessStoriesSnapshot = (
  inputs: SuccessStoriesInputs,
  opts: SuccessStoriesEnvelopeOpts,
): SuccessStoriesSnapshot => {
  const metaById = indexById(inputs.metadata)
  const rosterById = indexById(inputs.roster)
  const trajById = groupBy(inputs.quitProb)
  const claimsById = groupBy(inputs.claims)
  const encsById = groupBy(inputs.encounters)
  const ehrById = groupBy(inputs.ehr)

  const marketMap = BU_CODE_MARKET[opts.client]
  const availableSet = new Set<Month>()
  const providers: SuccessStoryProvider[] = []

  // Iterate the metadata roster — it's the canonical "providers in the model"
  // list. A provider missing any of the other inputs ends up with sparse
  // monthly rows; the page loader's null-handling decides what to do.
  for (const [pid, meta] of metaById) {
    const traj = trajById.get(pid) ?? []
    const claims = claimsById.get(pid) ?? []
    const encs = encsById.get(pid) ?? []
    const ehr = ehrById.get(pid) ?? []

    const byMonth = new Map<Month, SuccessStoryProviderMonth>()
    const upsert = (month: Month, patch: Partial<SuccessStoryProviderMonth>): void => {
      const cur = byMonth.get(month) ?? {
        month,
        procedures: null,
        work_rvu: null,
        encounters: null,
        enc_duration: null,
        doc_time: null,
        admin_time: null,
        quit_prob: null,
      }
      byMonth.set(month, { ...cur, ...patch })
    }

    for (const r of traj) upsert(toMonth(r.run_date), { quit_prob: safeFloat(r.quit_prob) })
    for (const r of claims) {
      upsert(toMonth(r.batch_ds), {
        procedures: safeFloat(r.procedures),
        work_rvu: safeFloat(r.work_rvu),
      })
    }
    for (const r of encs) {
      upsert(toMonth(r.batch_ds), {
        encounters: safeFloat(r.encounters),
        enc_duration: safeFloat(r.enc_duration),
      })
    }
    for (const r of ehr) {
      upsert(toMonth(r.batch_ds), {
        doc_time: safeFloat(r.doc_time),
        admin_time: safeFloat(r.admin_time),
      })
    }

    if (byMonth.size === 0) continue

    const monthly = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1))
    for (const m of monthly) availableSet.add(m.month)

    // Market lookup: roster carries businessunitname; BU_CODE_MARKET maps it
    // to the dashboard market label. Clients without a mapping (Duke, UCSF)
    // yield null.
    const bu = rosterById.get(pid)?.businessunitname?.trim() ?? ""
    const market = bu ? (marketMap[bu] ?? null) : null

    providers.push({
      provider_id: pid,
      name: titleCase(meta.provider_name?.trim() ?? ""),
      specialty: fmtSpec(meta.specialty?.trim() ?? ""),
      category: fmtCat(meta.category?.trim() ?? ""),
      department: trimDeptCode(meta.department?.trim() ?? ""),
      market,
      monthly,
    })
  }

  const available_months = [...availableSet].sort()

  return {
    client: opts.client,
    month: opts.month,
    generated_at: opts.generated_at,
    source: "athena",
    metrics: {
      min_pre_procedures: 10,
      available_months,
      providers,
    },
  }
}
