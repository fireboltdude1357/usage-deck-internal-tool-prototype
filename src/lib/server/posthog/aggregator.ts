import type {
  Client,
  Kpi,
  PlatformSnapshot,
  Series,
  CategoryBar,
} from "$lib/schema/snapshot"
import { RECURRING_WINDOW } from "./config"
import { monthBoundaries } from "./pagination"

export interface ProviderEvent {
  readonly month: string
  readonly user_email: string
  readonly provider_legacy_id: string
}
export interface UnitEvent {
  readonly month: string
  readonly user_email: string
  readonly group_uuid: string
}
export interface MonthlyActivity {
  readonly month: string
  readonly user_email: string
  readonly event_count: number
}

export interface AggregatorInput {
  readonly client: Client
  readonly startMonth: string
  readonly endMonth: string
  readonly providerEvents: readonly ProviderEvent[]
  readonly unitEvents: readonly UnitEvent[]
  readonly monthlyActivity: readonly MonthlyActivity[]
}

const monthList = (start: string, end: string): string[] =>
  monthBoundaries(start, end).map((b) => b.from.slice(0, 7))

const countByMonth = (
  rows: readonly { month: string }[],
  months: readonly string[],
): Series => {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.month, (counts.get(r.month) ?? 0) + 1)
  return months.map((m) => ({ month: m, value: counts.get(m) ?? 0 }))
}

const topUnits = (rows: readonly UnitEvent[], n: number): readonly CategoryBar[] => {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.group_uuid, (counts.get(r.group_uuid) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([uuid, value]) => ({ label: uuidLabel(uuid), value }))
}

// Match the existing fixture's label shape ("c034050b…") so phase 03's RDS
// join can swap in human names without changing the schema.
const uuidLabel = (uuid: string): string => `${uuid.slice(0, 8)}…`

const recurringStats = (
  monthly: readonly MonthlyActivity[],
): { recurring: number; totalInWindow: number } => {
  const winSet = new Set<string>(RECURRING_WINDOW)
  const monthsByUser = new Map<string, Set<string>>()
  for (const r of monthly) {
    if (!winSet.has(r.month)) continue
    const set = monthsByUser.get(r.user_email) ?? new Set<string>()
    set.add(r.month)
    monthsByUser.set(r.user_email, set)
  }
  let recurring = 0
  for (const months of monthsByUser.values()) if (months.size >= 3) recurring++
  return { recurring, totalInWindow: monthsByUser.size }
}

export const buildPlatformSnapshot = (input: AggregatorInput): PlatformSnapshot => {
  const months = monthList(input.startMonth, input.endMonth)

  const uniqueProviders = new Set(
    input.providerEvents.map((e) => e.provider_legacy_id),
  ).size
  const uniqueUnits = new Set(input.unitEvents.map((e) => e.group_uuid)).size
  const activeUsers = new Set(input.monthlyActivity.map((e) => e.user_email)).size

  const { recurring, totalInWindow } = recurringStats(input.monthlyActivity)
  const retentionPct =
    totalInWindow === 0 ? 0 : Math.round((recurring / totalInWindow) * 100)

  const kpis: readonly Kpi[] = [
    { label: "Unique providers viewed", value: uniqueProviders, unit: "count" },
    { label: "Unique units viewed", value: uniqueUnits, unit: "count" },
    { label: "Active platform users", value: activeUsers, unit: "count" },
    {
      label: "Recurring leaders (3+ mo)",
      value: recurring,
      denominator: totalInWindow,
      unit: "count",
    },
    { label: "Retention rate", value: retentionPct, unit: "percent" },
  ]

  return {
    client: input.client,
    month: input.endMonth,
    generated_at: new Date().toISOString(),
    source: "posthog",
    metrics: {
      kpis,
      provider_views_by_month: countByMonth(input.providerEvents, months),
      unit_views_by_month: countByMonth(input.unitEvents, months),
      top_units_viewed: topUnits(input.unitEvents, 10),
    },
  }
}
