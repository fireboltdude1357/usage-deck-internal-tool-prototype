<script lang="ts">
  import { ViewportPortal } from "@xyflow/svelte"
  import { createTimeline } from "animejs"
  import type { Session, PathStep } from "$lib/behavior-graph/types"

  type Props = {
    session: Session
    path: PathStep[]
    nodePositions: Record<string, { x: number; y: number }>
    onClose: () => void
  }

  const HOP_MS = 520
  const ARRIVE_PULSE_MS = 320

  let { session, path, nodePositions, onClose }: Props = $props()

  let dotEl: HTMLDivElement | null = $state(null)
  let ringEl: HTMLDivElement | null = $state(null)

  let currentStep: number = $state(0)
  let playing: boolean = $state(true)

  const total = $derived(Math.max(path.length - 1, 0))
  const atEnd = $derived(currentStep >= total)
  const currentState = $derived(path[currentStep]?.state ?? "—")
  const progress = $derived(total === 0 ? 1 : currentStep / total)

  const { initials, shortName, domain } = $derived.by(() => {
    const atIdx = session.user.indexOf("@")
    const name = atIdx > 0 ? session.user.slice(0, atIdx) : session.user
    const dom = atIdx > 0 ? session.user.slice(atIdx) : ""
    const parts = name.split(/[._-]+/).filter(Boolean)
    const ini =
      parts.length >= 2
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : name.slice(0, 2).toUpperCase()
    return { initials: ini, shortName: name, domain: dom }
  })

  // Place dot at first node when session or path changes
  $effect(() => {
    const sessionId = session.sessionId
    // reset on session switch
    void sessionId
    currentStep = 0
    playing = true
    console.log(
      `[bgraph] animator session=${sessionId} pathLen=${path.length} firstState=${path[0]?.state ?? "?"}`,
    )
  })

  $effect(() => {
    if (!dotEl || !ringEl) return
    const firstState = path[0]?.state
    const first = nodePositions[firstState]
    if (!first) {
      console.warn(
        `[bgraph] animator no position for first state="${firstState}" — animation will not start. Known positions: [${Object.keys(nodePositions).join(",")}]`,
      )
      return
    }
    dotEl.style.left = `${first.x}px`
    dotEl.style.top = `${first.y}px`
    ringEl.style.left = `${first.x}px`
    ringEl.style.top = `${first.y}px`
    ringEl.style.opacity = "0"
  })

  // Drive the animation timeline
  $effect(() => {
    if (!playing) return
    if (path.length < 2) return
    if (!dotEl || !ringEl) return

    // capture local refs so cleanup closure works
    const dot = dotEl
    const ring = ringEl
    const startStep = currentStep

    const tl = createTimeline({
      defaults: { ease: "inOutQuad" },
      onComplete: () => { playing = false },
    })

    let skippedHops = 0
    for (let i = startStep; i < path.length - 1; i++) {
      const from = nodePositions[path[i].state]
      const to = nodePositions[path[i + 1].state]
      if (!from || !to) {
        skippedHops++
        console.warn(
          `[bgraph] animator hop ${i}→${i + 1} skipped: missing position ${!from ? `from="${path[i].state}"` : ""} ${!to ? `to="${path[i + 1].state}"` : ""}`,
        )
        continue
      }

      const hopIdx = i
      tl.add(dot, {
        left: [`${from.x}px`, `${to.x}px`],
        top: [`${from.y}px`, `${to.y}px`],
        duration: HOP_MS,
      })

      tl.add(ring, {
        left: `${to.x}px`,
        top: `${to.y}px`,
        scale: [1, 2.3],
        opacity: [0.9, 0],
        duration: ARRIVE_PULSE_MS,
        ease: "outQuad",
      }, `-=${HOP_MS * 0.12}`)

      tl.call(() => { currentStep = hopIdx + 1 })
    }

    if (skippedHops > 0) {
      console.warn(
        `[bgraph] animator timeline built with ${skippedHops}/${path.length - 1} hops skipped`,
      )
    }

    return () => {
      tl.pause()
    }
  })

  function handlePlayPause() {
    if (atEnd) {
      currentStep = 0
      playing = true
    } else {
      playing = !playing
    }
  }

  function handleRestart() {
    currentStep = 0
    playing = true
  }
</script>

<!-- Moving cursor + arrival ring inside the SvelteFlow viewport (pans/zooms with graph) -->
<ViewportPortal target="front">
  <div class="pointer-events-none" style="position: absolute; inset: 0;">
    <div
      bind:this={ringEl}
      style="
        position: absolute;
        width: 40px;
        height: 40px;
        margin-left: -20px;
        margin-top: -20px;
        border-radius: 50%;
        border: 3px solid #f59e0b;
        box-shadow: 0 0 24px rgba(245,158,11,0.55);
        opacity: 0;
        will-change: transform, opacity;
      "
    ></div>
    <div
      bind:this={dotEl}
      style="
        position: absolute;
        width: 20px;
        height: 20px;
        margin-left: -10px;
        margin-top: -10px;
        border-radius: 50%;
        background: radial-gradient(circle at 30% 30%, #fde047 0%, #f59e0b 60%, #b45309 100%);
        border: 3px solid white;
        box-shadow: 0 0 18px rgba(245,158,11,0.95), 0 3px 10px rgba(0,0,0,0.32);
        will-change: transform;
      "
    ></div>
  </div>
</ViewportPortal>

<!-- HUD pinned to the bottom of the canvas (screen-fixed, not in viewport) -->
<div class="absolute bottom-6 left-1/2 -translate-x-1/2 z-20">
  <div
    class="flex items-center gap-4 bg-white/95 backdrop-blur-md px-4 py-3 rounded-xl border border-slate-200"
    style="box-shadow: 0 1px 3px rgba(15,23,42,0.08), 0 12px 40px rgba(15,23,42,0.12);"
  >
    <!-- Avatar + user -->
    <div class="flex items-center gap-3 pr-4 border-r border-slate-200">
      <div
        class="flex items-center justify-center w-9 h-9 rounded-full text-white text-[11px] font-bold"
        style="background: linear-gradient(135deg, #4a9e8e 0%, #2563eb 100%);"
      >
        {initials}
      </div>
      <div class="leading-tight">
        <div class="text-[12px] font-bold text-slate-900">{shortName}</div>
        <div class="text-[10px] text-slate-400">{domain} · {Math.round(session.durationMs / 1000)}s</div>
      </div>
    </div>

    <!-- Play/pause/replay -->
    <button
      type="button"
      onclick={handlePlayPause}
      class="flex items-center justify-center w-9 h-9 rounded-full bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-sm"
      aria-label={atEnd ? "Replay" : playing ? "Pause" : "Play"}
    >
      <span class="text-sm leading-none">
        {atEnd ? "↻" : playing ? "⏸" : "▶"}
      </span>
    </button>

    <!-- Progress bar + step counter -->
    <div class="flex flex-col gap-1 min-w-[180px]">
      <div class="flex items-baseline justify-between gap-3">
        <div class="text-[11px] font-bold text-slate-900">
          Step {Math.min(currentStep + 1, total + 1)}
          <span class="text-slate-400 font-normal">of {total + 1}</span>
        </div>
        <div class="text-[10px] text-slate-400 truncate max-w-[160px]">{currentState}</div>
      </div>
      <div style="width: 100%; height: 4px; background: #e2e8f0; border-radius: 999px; overflow: hidden;">
        <div
          style="
            width: {progress * 100}%;
            height: 100%;
            background: linear-gradient(90deg, #4a9e8e 0%, #10b981 100%);
            transition: width 500ms ease-out;
          "
        ></div>
      </div>
    </div>

    <!-- Restart -->
    <button
      type="button"
      onclick={handleRestart}
      class="text-slate-400 hover:text-slate-900 text-base leading-none px-1 transition-colors"
      title="Restart from beginning"
    >
      ↺
    </button>

    <!-- Close -->
    <button
      type="button"
      onclick={onClose}
      class="flex items-center justify-center w-6 h-6 rounded-full text-slate-400 hover:text-slate-900 hover:bg-slate-200/60 transition-colors text-sm leading-none"
      aria-label="Close session"
    >
      ×
    </button>
  </div>
</div>
