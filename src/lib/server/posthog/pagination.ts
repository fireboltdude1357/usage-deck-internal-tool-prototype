import { Effect } from "effect"
import { runHogQL, type PostHogError } from "./client"

// HogQL returns ≤ 100 rows by default. Strategy: query month-by-month.
// If a month returns ≥ this threshold, recursively bisect the date window.
const PAGE_LIMIT = 100
const MAX_BISECT_DEPTH = 4 // 1 month → up to 16 sub-windows ≈ ~2-day chunks

// Returns inclusive month list as ISO date pairs, e.g. ("2025-08","2025-09")
// → [("2025-08-01","2025-09-01"), ("2025-09-01","2025-10-01")]. The `to` is
// exclusive — match HogQL's `timestamp < '...'` convention.
export const monthBoundaries = (
  startMonth: string,
  endMonth: string,
): Array<{ from: string; to: string }> => {
  const [sy, sm] = startMonth.split("-").map(Number)
  const [ey, em] = endMonth.split("-").map(Number)
  const out: Array<{ from: string; to: string }> = []
  let y = sy
  let m = sm
  while (y < ey || (y === ey && m <= em)) {
    const from = `${pad4(y)}-${pad2(m)}-01`
    const ny = m === 12 ? y + 1 : y
    const nm = m === 12 ? 1 : m + 1
    const to = `${pad4(ny)}-${pad2(nm)}-01`
    out.push({ from, to })
    y = ny
    m = nm
  }
  return out
}

const pad2 = (n: number): string => n.toString().padStart(2, "0")
const pad4 = (n: number): string => n.toString().padStart(4, "0")

// Midpoint of [from, to) in ISO date form. Used for bisection when a window
// hits the page limit.
const midpoint = (from: string, to: string): string => {
  const f = Date.parse(from)
  const t = Date.parse(to)
  return new Date(Math.round((f + t) / 2)).toISOString().slice(0, 10)
}

const fetchWindow = (
  from: string,
  to: string,
  buildQuery: (from: string, to: string) => string,
  depth: number,
  label: string,
): Effect.Effect<readonly ReadonlyArray<unknown>[], PostHogError> =>
  runHogQL(buildQuery(from, to), { label: `${label} ${from}→${to}` }).pipe(
    Effect.flatMap((res) => {
      if (res.results.length < PAGE_LIMIT || depth >= MAX_BISECT_DEPTH) {
        return Effect.succeed(res.results)
      }
      const mid = midpoint(from, to)
      // Mid can collapse to `from` if the window is < 1 day; bail out cleanly.
      if (mid <= from || mid >= to) return Effect.succeed(res.results)
      return Effect.all(
        [
          fetchWindow(from, mid, buildQuery, depth + 1, label),
          fetchWindow(mid, to, buildQuery, depth + 1, label),
        ],
        { concurrency: 2 },
      ).pipe(Effect.map(([a, b]) => [...a, ...b]))
    }),
  )

// Run the same query template across a [startMonth, endMonth] inclusive range,
// one query per calendar month, bisecting any month that hits the page limit.
// Returns the flattened, ordered result rows + the column names from the first
// non-empty response.
export const fetchByMonth = (
  startMonth: string,
  endMonth: string,
  buildQuery: (from: string, to: string) => string,
  label: string,
): Effect.Effect<
  { rows: readonly ReadonlyArray<unknown>[]; columns: readonly string[] },
  PostHogError
> => {
  const months = monthBoundaries(startMonth, endMonth)
  return Effect.forEach(
    months,
    ({ from, to }) =>
      runHogQL(buildQuery(from, to), { label: `${label} ${from.slice(0, 7)}` }).pipe(
        Effect.flatMap((res) =>
          res.results.length < PAGE_LIMIT
            ? Effect.succeed({ rows: res.results, columns: res.columns })
            : (() => {
                const mid = midpoint(from, to)
                if (mid <= from || mid >= to) {
                  return Effect.succeed({ rows: res.results, columns: res.columns })
                }
                console.log(
                  `[posthog] ${label} ${from.slice(0, 7)} hit page limit; bisecting`,
                )
                return Effect.all(
                  [
                    fetchWindow(from, mid, buildQuery, 1, label),
                    fetchWindow(mid, to, buildQuery, 1, label),
                  ],
                  { concurrency: 2 },
                ).pipe(
                  Effect.map(([a, b]) => ({
                    rows: [...a, ...b],
                    columns: res.columns,
                  })),
                )
              })(),
        ),
      ),
    { concurrency: 4 },
  ).pipe(
    Effect.map((parts) => ({
      rows: parts.flatMap((p) => p.rows as ReadonlyArray<unknown>[]),
      columns: parts.find((p) => p.columns.length > 0)?.columns ?? [],
    })),
  )
}

// Helper: turn a row + column-names tuple into a typed object using a row mapper.
// Pure; used by aggregator tests too.
export const rowsToObjects = <T>(
  rows: readonly ReadonlyArray<unknown>[],
  columns: readonly string[],
  map: (row: Record<string, unknown>) => T,
): T[] =>
  rows.map((row) => {
    const obj: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) obj[columns[i]] = row[i]
    return map(obj)
  })
