<script lang="ts">
  import type { Session, PathStep } from "$lib/behavior-graph/types"
  import { sessionPath } from "$lib/behavior-graph/session-path"
  import { clusterFor, CLUSTER_META } from "$lib/behavior-graph/clusters"

  type Props = {
    sessions: Session[] | null
    loading: boolean
    error: string | null
    selectedSessionId: string | null
    onSelect: (session: Session | null) => void
    filterUser?: string | null
  }

  let { sessions, loading, error, selectedSessionId, onSelect, filterUser }: Props = $props()

  // filterUser kept as optional for Phase 5 wiring; not used for display-routing now
  const displayedSessions = $derived(
    sessions
      ? filterUser
        ? sessions.filter((s) => s.user.toLowerCase() === filterUser!.toLowerCase())
        : sessions
      : null
  )

  function userParts(user: string): { initials: string; shortName: string } {
    const at = user.indexOf("@")
    const name = at > 0 ? user.slice(0, at) : user
    const parts = name.split(/[._-]+/).filter(Boolean)
    const initials =
      parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase()
    return { initials, shortName: name }
  }

  function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    if (m < 60) return `${m}m ${rem}s`
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }

  function formatRelativeTime(iso: string): string {
    try {
      const d = new Date(iso)
      const diffMs = Date.now() - d.getTime()
      const diffDays = Math.floor(diffMs / (24 * 3600 * 1000))
      if (diffDays < 1) return "today"
      if (diffDays < 2) return "yesterday"
      if (diffDays < 7) return `${diffDays}d ago`
      if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    } catch {
      return iso.slice(0, 10)
    }
  }

  function shortState(name: string): string {
    const abbrev: Record<string, string> = {
      "Home": "Home",
      "Providers List": "Providers",
      "Provider Detail": "Provider",
      "Risk Factors": "Risks",
      "Interventions": "Intrvn",
      "Exec Dashboard": "Exec",
      "Glossary": "Gloss",
      "Units List": "Units",
      "Unit Detail": "Unit",
      "Provider in Unit": "P·Unit",
      "Region Detail": "Region",
      "Provider in Region": "P·Reg",
      "Region Task": "Task",
      "Filters": "Filt",
      "New Filter": "NewF",
      "Settings": "Set",
      "Admin": "Adm",
    }
    return abbrev[name] ?? name.slice(0, 5)
  }
</script>

<div class="flex flex-col h-full overflow-hidden bg-white border-l border-slate-200">
  <!-- Header -->
  <div class="px-5 pt-5 pb-4 border-b border-slate-200 shrink-0">
    <div class="flex items-baseline justify-between gap-2">
      <h2 class="text-base font-bold tracking-tight text-slate-900">Sessions</h2>
      {#if sessions}
        <span class="text-[11px] text-slate-400 tabular-nums">
          {#if filterUser && displayedSessions}
            {displayedSessions.length} / {sessions.length}
          {:else}
            {sessions.length}
          {/if}
        </span>
      {/if}
    </div>
    <p class="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
      Click a session to animate its path through the graph.
    </p>
  </div>

  {#if loading}
    <div class="p-5 text-sm text-slate-400">Loading sessions…</div>
  {/if}

  {#if error}
    <div class="p-5">
      <div class="text-sm font-semibold text-slate-900">No sessions</div>
      <div class="text-[11px] text-slate-400 mt-1 leading-relaxed">{error}</div>
    </div>
  {/if}

  {#if displayedSessions && !error && displayedSessions.length === 0}
    <div class="p-5 text-sm text-slate-400">
      {filterUser ? `No sessions for ${filterUser} in this era.` : "No sessions in this view."}
    </div>
  {/if}

  {#if displayedSessions && !error && displayedSessions.length > 0}
    <div class="flex-1 overflow-y-auto">
      <ul class="p-3 flex flex-col gap-2">
        {#each displayedSessions as session (session.sessionId)}
          {@const selected = session.sessionId === selectedSessionId}
          {@const steps = sessionPath(session)}
          {@const { initials, shortName } = userParts(session.user)}
          <li>
            <button
              type="button"
              onclick={() => onSelect(session.sessionId === selectedSessionId ? null : session)}
              class="w-full text-left px-3 py-3 rounded-xl border transition-all {selected
                ? 'bg-blue-50 border-blue-400 shadow-sm'
                : 'bg-white border-slate-200 hover:border-blue-300 hover:bg-blue-50/30'}"
            >
              <div class="flex items-center gap-2.5">
                <div
                  class="flex items-center justify-center w-8 h-8 rounded-full text-white text-[10px] font-bold shrink-0"
                  style="background: {selected
                    ? 'linear-gradient(135deg, #4a9e8e 0%, #2563eb 100%)'
                    : 'linear-gradient(135deg, #94a3b8 0%, #64748b 100%)'};"
                >
                  {initials}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-[12px] font-bold text-slate-900 truncate">{shortName}</div>
                  <div class="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                    <span>{formatRelativeTime(session.startTime)}</span>
                    <span class="text-slate-300">·</span>
                    <span>{formatDuration(session.durationMs)}</span>
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-[12px] font-bold text-slate-900 tabular-nums">{session.pageCount}</div>
                  <div class="text-[9px] text-slate-400 uppercase tracking-wide">pages</div>
                </div>
              </div>

              {#if steps.length > 0}
                <div class="flex flex-wrap gap-1 mt-2.5">
                  {#each steps.slice(0, 9) as step, i (step.state + i)}
                    {@const cid = clusterFor(step.state)}
                    {@const meta = cid ? CLUSTER_META[cid] : null}
                    <span
                      class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/80 border rounded-md text-[9px] font-mono text-slate-900"
                      style="border-color: {meta?.color ? `${meta.color}55` : '#e5e7eb'};"
                      title="{step.state} ({step.eventCount}×)"
                    >
                      <span
                        class="w-1.5 h-1.5 rounded-full shrink-0"
                        style="background: {meta?.color ?? '#94a3b8'};"
                      ></span>
                      {shortState(step.state)}
                    </span>
                  {/each}
                  {#if steps.length > 9}
                    <span class="text-[9px] text-slate-400 self-center font-mono">
                      +{steps.length - 9}
                    </span>
                  {/if}
                </div>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>
