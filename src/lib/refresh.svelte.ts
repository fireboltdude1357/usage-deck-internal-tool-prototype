import { invalidate as svelteInvalidate } from "$app/navigation"

// Refresh nonce. Bumped by the RefreshButton; +page.ts reads the current value
// and appends `&refresh=1` to the API URL when it's > 0 so the server cache is
// bypassed for that fetch.
let nonce = $state(0)

// SvelteKit's `navigating` store doesn't fire for `invalidate()` — only for
// real route navigation. Without our own counter, refresh / picker changes
// give no UI signal that work is in flight. Increment around every
// invalidate() call we make so the top progress bar and refresh button can
// reflect the pending state.
let inFlight = $state(0)

export const refresh = {
  get nonce() {
    return nonce
  },
  get pending() {
    return inFlight > 0
  },
  bump(): void {
    nonce++
  },
  async invalidate(dep: string): Promise<void> {
    inFlight++
    try {
      await svelteInvalidate(dep)
    } finally {
      inFlight--
    }
  },
}
