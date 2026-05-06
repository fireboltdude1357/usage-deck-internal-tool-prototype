// Refresh nonce. Bumped by the RefreshButton; +page.ts reads the current value
// and appends `&refresh=1` to the API URL when it's > 0 so the server cache is
// bypassed for that fetch.
let nonce = $state(0)

export const refresh = {
  get nonce() {
    return nonce
  },
  bump(): void {
    nonce++
  },
}
