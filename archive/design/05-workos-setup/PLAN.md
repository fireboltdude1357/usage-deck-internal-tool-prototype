# 05 — Plan

**Status: shipped 2026-05-06.** See § "What shipped" at the bottom for deltas
between this plan and the executed work.

Implementation plan for replacing the `AUTH_BYPASS` placeholder gate with real
WorkOS-managed sessions. The README states scope; this doc names the
load-bearing decisions, picks defaults where the README is silent, and lists
the work in execution order.

The two artifacts that outlive this phase and become contracts for later work:

1. **`requireSession()` in `src/lib/server/auth.ts`** — phase 01 designed the
   signature so only the body changes here. The signature stays. Future
   per-user role/permission gating (deferred per README "Out of scope")
   extends the returned `Session` type, not the call sites.
2. **The `/api/auth/*` route layout** — `login`, `callback`, `logout`. v1
   only adds these three. Future MFA, account-management, or
   token-refresh endpoints land under the same prefix.

Everything else this phase touches is local — env vars, the `requireSession`
body, the `hooks.server.ts` route-skip list, and one IAM swap that's been
queued since phase 03.

---

## Load-bearing constraints

| Constraint | Source | Implication |
|---|---|---|
| **WorkOS as a social-provider gateway, not full SSO yet.** | User direction (2026-05-06) | We use AuthKit with Google as a social provider. Domain restriction to `@atalantech.com` lives in our callback (not the WorkOS connection), because the connection is "Sign in with Google" social — not a Google Workspace SSO connection bound to the domain. When the proper Google Workspace SSO connection lands later, the domain check can move to WorkOS or stay belt-and-suspenders. |
| **`requireSession()` signature is fixed.** | `src/lib/server/auth.ts`, phase 01 | Body swap only. Callers (`hooks.server.ts`) don't change. |
| **`AUTH_BYPASS=1` must keep working in local dev.** | Phase 01–04 dev workflow; README "Dev workflow" | Without it, the dashboard can't render against fixtures locally. The phase 05 `requireSession` honors `AUTH_BYPASS=1` first, then falls through to WorkOS validation. |
| **Page routes vs. API routes need different 401 behavior.** | UX | Page request unauth'd → redirect to `/api/auth/login`. API request unauth'd → 401 JSON. Both still gated by the same hook. |
| **`/api/auth/*` itself must NOT be gated by `requireSession`.** | Bootstrapping problem | The login/callback/logout endpoints have to be reachable while the user is unauthenticated. `hooks.server.ts` adds a path prefix skip. |
| **No durable client-side session storage of session contents.** | DESIGN.md § Constraints, README "quasi-PHI" posture | The WorkOS sealed cookie is fine (HTTP-only, encrypted, server-validated). Browser code never sees the session payload. |
| **WorkOS is the only network-call boundary for auth.** | DESIGN.md § 5 | All auth state lives in either the WorkOS service or the sealed cookie. No local user DB, no JWKS service, no Redis. |
| **Vercel Production's `AUTH_BYPASS` must be confirmed absent before launch.** | README L11 | A stale `AUTH_BYPASS=1` from phase 04's smoke would silently bypass the new gate. Verify via `vercel env ls production`. |
| **Phase 03/04's `// TODO(phase-05)` IAM swap is part of this phase.** | README L12; phase 03 + 04 PLANs | Both call sites (`scripts/snapshot/upload.ts`, `src/lib/server/snapshot-source.ts`) reference `tanner.sharon` IAM. Phase 05 splits the reader to a dedicated read-only principal scoped to `s3:GetObject` on `internal-tool-snapshots/*`. |

---

## Decisions made here

| Decision | Default | Reason |
|---|---|---|
| **AuthKit (hosted login UI) vs. direct SSO API.** | **AuthKit.** Use `provider: 'authkit'` on `getAuthorizationUrl`. WorkOS hosts the login page on a `*.authkit.app` subdomain. | Quickest to wire; built-in Google social provider button; no login-page UI work; WorkOS handles all the OAuth dance. The only downside is the login page is on a WorkOS subdomain (fine for an internal tool). When the real Google Workspace SSO connection lands later, AuthKit picks it up automatically — no app code change. |
| **Cookie sealing library.** | **`@workos-inc/node`'s built-in `sealSession`/`authenticateWithSessionCookie`.** No `iron-session`, no `jose`, no homegrown HMAC. | The WorkOS SDK seals and unseals the session cookie natively. Adding another encryption library would just double-encode the same data. `authenticateWithSessionCookie` does no network call — it's a pure cryptographic unseal — so the per-request cost is negligible. |
| **Domain allowlist enforcement locus.** | **In our `/api/auth/callback` handler**, immediately after `authenticateWithCode` resolves. Reject anything not ending in `@atalantech.com`. | The "Sign in with Google" social provider in WorkOS doesn't enforce a domain restriction (that's a property of Google Workspace SSO, which we're deferring). The check has to live on our side for v1. Putting it in the callback (not in `requireSession` per request) means rejected users never get a session cookie at all — cleaner failure mode. |
| **Allowlist constant location.** | `ALLOWED_EMAIL_DOMAIN` env var in `.env.example`, default `@atalantech.com`. Read in `/api/auth/callback`. | Env var, not a hardcoded constant, so we can add a contractor domain later without a code deploy. Defaulting in `.env.example` documents the value. |
| **Cookie name.** | `wos-session` (matches WorkOS docs). | Convention. No reason to deviate. |
| **Cookie attributes.** | `httpOnly: true, secure: true, sameSite: 'lax', path: '/'`. `secure: false` only when `process.env.NODE_ENV !== 'production'` AND the dev server is HTTP. | `lax` is correct for the OAuth callback redirect (top-level GET). `httpOnly` keeps JS from reading. `secure` keeps it off cleartext. |
| **Redirect URI.** | `${ORIGIN}/api/auth/callback`. Local: `http://localhost:5173/api/auth/callback`. Vercel: `${VERCEL_URL}/api/auth/callback` (the deployed URL). | Standard. Both URIs added to AuthKit's redirect allowlist in the WorkOS dashboard. |
| **Post-login redirect.** | After successful callback, redirect to the page the user originally tried to access (passed through OAuth state) — fallback `/`. | Matches phase 01's UX. Avoids the "I asked for /provisioned-users and got dropped at /" papercut. |
| **Session lookup on every request.** | `authenticateWithSessionCookie` is called by `requireSession`. No caching layer. | Per WorkOS docs, the call is a local cryptographic unseal — no network. Caching adds complexity for no measurable win at 5–20 users. |
| **Page-route 401 vs. API-route 401.** | If the request is for a page (best detected by absence of `/api/` prefix or by `event.route?.id` not starting with `/api/`), redirect 302 to `/api/auth/login?return_to=<path>`. If the request is for an API, throw `error(401)`. | Matches the UX contract. Implemented inside `requireSession` via the `RequestEvent` it already receives. |
| **`AUTH_BYPASS=1` dev fallback.** | First check in `requireSession`. If `env.AUTH_BYPASS === "1"`, return `{ user: { email: "dev@local" } }` before doing any cookie work. | Preserves phases 01–04's local dev workflow exactly. Production must NOT set this var (verified via `vercel env ls production`). |
| **`/api/auth/*` skip-list in hooks.** | Hardcoded prefix check at the top of `hooks.server.ts`'s `handle`: if `pathname.startsWith('/api/auth/')`, skip `requireSession`. | Bootstrapping. Login routes can't require a session to function. Three routes is small; a hardcoded prefix is fine. |
| **Tests.** | One unit test for the `requireSession` body covering: bypass mode, valid sealed cookie → session returned, missing/invalid cookie + page route → redirect, missing/invalid cookie + API route → 401. WorkOS SDK call mocked. | Same posture as phase 04 — mock the network seam, no live calls in CI. End-to-end is a manual `npm run dev` smoke. |
| **No new SvelteKit-specific WorkOS adapter.** | Use `@workos-inc/node` directly from `+server.ts` files. No `@workos-inc/authkit-sveltekit` package — there isn't a first-party one, and a community wrapper would add a dependency for ~50 lines of code we can write inline. | Three route handlers + one cookie unseal in `auth.ts` is small enough to roll directly. |

---

## Module / artifact layout after this phase

```
src/lib/server/
├── auth.ts                       # body swapped to WorkOS unseal + AUTH_BYPASS
└── workos.ts                     # NEW — module-scope WorkOS client + cookie helpers

src/routes/api/auth/
├── login/+server.ts              # NEW — GET → redirect to AuthKit
├── callback/+server.ts           # NEW — GET ?code=… → authenticate + domain-check + set cookie
└── logout/+server.ts             # NEW — GET → clear cookie + redirect

src/hooks.server.ts               # add /api/auth/* skip; otherwise unchanged
src/app.d.ts                      # unchanged (Session shape unchanged)

src/lib/server/__tests__/
└── auth.test.ts                  # NEW — requireSession body coverage

design/05-workos-setup/
├── README.md                     # unchanged here, updated at acceptance
└── PLAN.md                       # this doc

.env.example                      # ALLOWED_EMAIL_DOMAIN added; WORKOS_* unchanged
package.json                      # + @workos-inc/node
CLAUDE.md (or wherever)           # risk-acceptance paragraph rewrite
scripts/snapshot/upload.ts        # // TODO(phase-05) updated/cleared
src/lib/server/snapshot-source.ts # // TODO(phase-05) updated/cleared
```

---

## Execution order

1. **Confirm phase 04 acceptance is intact.**
   - `vercel env ls production` — confirm `AUTH_BYPASS` is absent. (README L11.)
   - `npm run dev` with `AUTH_BYPASS=1` and `SNAPSHOT_SOURCE=fixtures` — dashboard renders.
   - Skip if already verified today.

2. **WorkOS dashboard setup (Tanner does this).**
   - Sign up at workos.com (free tier).
   - Project name: `atalan-internal-tool` (or similar).
   - **AuthKit → enable.**
   - **AuthKit → Authentication methods → enable Google OAuth.** Use Google's standard OAuth credentials (the WorkOS dashboard walks through this). No Google Workspace admin needed — this is the social-login path, distinct from a Google Workspace SSO connection.
   - **AuthKit → Redirect URIs → add `http://localhost:5173/api/auth/callback`** for local dev. Add the Vercel production URL once we have it.
   - Copy four values to `.env`:
     - `WORKOS_API_KEY=sk_test_...`
     - `WORKOS_CLIENT_ID=client_...`
     - `WORKOS_REDIRECT_URI=http://localhost:5173/api/auth/callback`
     - `WORKOS_COOKIE_PASSWORD=` (32+ bytes; `openssl rand -base64 32`)
   - `ALLOWED_EMAIL_DOMAIN=@atalantech.com`.

3. **Install SDK + update env.**
   - `npm install @workos-inc/node`.
   - `.env.example`: add `ALLOWED_EMAIL_DOMAIN=@atalantech.com` under the phase 05 block. Keep the four `WORKOS_*` vars (already present from phase 04 plumbing).
   - `npm run check` should be clean before any further code.

4. **Create `src/lib/server/workos.ts`** — module-scope helpers.
   - Construct the `WorkOS` client once at module scope from `WORKOS_API_KEY` (with `clientId` from `WORKOS_CLIENT_ID`, required for `authenticateWithSessionCookie`).
   - Export `workos` (the client), `WORKOS_COOKIE_NAME = 'wos-session'`, `WORKOS_COOKIE_OPTIONS` (the attribute set above).
   - Export `getCookiePassword()`, `getRedirectUri()`, `getAllowedEmailDomain()` — read env at call time so `Layer.effect`-style "fail loudly if missing" semantics work for the routes.
   - No Effect wrapper here. Auth is not an integration boundary in the Effect sense — it's plain Node code with one async call.

5. **Implement `/api/auth/login/+server.ts`.**
   - GET handler. Read `?return_to=...` (defaults to `/`). Pass it through `state` (a base64url-encoded JSON `{ returnTo }`) on the authorization URL.
   - `authorizationUrl = workos.userManagement.getAuthorizationUrl({ provider: 'authkit', redirectUri, clientId, state })`.
   - `redirect(302, authorizationUrl)`.

6. **Implement `/api/auth/callback/+server.ts`.**
   - GET handler. Read `?code=...` and `?state=...`.
   - `const { user, sealedSession } = await workos.userManagement.authenticateWithCode({ clientId, code, session: { sealSession: true, cookiePassword } })`.
   - **Domain check**: `if (!user.email.toLowerCase().endsWith(allowedDomain.toLowerCase())) { redirect(302, '/api/auth/login?error=domain'); }`.
   - `cookies.set(WORKOS_COOKIE_NAME, sealedSession, WORKOS_COOKIE_OPTIONS)`.
   - Decode `state.returnTo`, validate it's a relative path (starts with `/`, doesn't contain `://`), default `/`.
   - `redirect(302, returnTo)`.
   - Wrap in try/catch; on any auth error, redirect to `/api/auth/login?error=auth`.

7. **Implement `/api/auth/logout/+server.ts`.**
   - GET handler. `cookies.delete(WORKOS_COOKIE_NAME, { path: '/' })`. `redirect(302, '/')`.
   - (Future: optionally hit WorkOS's logout URL for full SSO single-logout. Not needed for v1.)

8. **Update `src/hooks.server.ts`** to skip `requireSession` for `/api/auth/*`.
   - Add at the top of `handle`: `if (event.url.pathname.startsWith('/api/auth/')) { return resolve(event); }`.

9. **Replace `requireSession()` body** in `src/lib/server/auth.ts`.
   - First branch: `if (env.AUTH_BYPASS === "1") return { user: { email: "dev@local" } };` — unchanged.
   - Second branch: read `wos-session` cookie. If absent → 401-or-redirect (see decision above). If present → call `workos.userManagement.authenticateWithSessionCookie({ sessionData, cookiePassword })`. If `authenticated`, return `{ user: { email: <from response> } }`. If not, 401-or-redirect.
   - Helper `isPageRequest(event)`: return `true` if `event.route?.id` does NOT start with `/api/`. Use it to choose `redirect()` vs. `error(401)`.
   - On redirect, encode the original `pathname + search` as `return_to`.

10. **Tests** — `src/lib/server/__tests__/auth.test.ts`.
    - Mock the `workos` module's `authenticateWithSessionCookie`.
    - `AUTH_BYPASS=1` → returns dev session, no cookie read.
    - Valid cookie → returns user.
    - Missing cookie + page route → throws redirect to `/api/auth/login`.
    - Missing cookie + API route → throws 401.
    - Invalid cookie + page route → redirect.
    - Invalid cookie + API route → 401.
    - `npm test` clean.

11. **Local smoke** — full flow end-to-end.
    - Unset `AUTH_BYPASS` in `.env`.
    - `npm run dev`.
    - Hit `/platform-engagement` → redirected to AuthKit hosted login.
    - Sign in with a `@gmail.com` account → callback rejects → redirected back to login with `?error=domain`.
    - Sign in with an `@atalantech.com` account → callback accepts → land on `/platform-engagement` with the dashboard rendered.
    - Hit `/api/snapshot/bsmh/2026-04/metrics.json` directly with no cookie cleared → 401 JSON.
    - Hit `/api/auth/logout` → cookie cleared, next page request bounces to login.
    - Re-set `AUTH_BYPASS=1` → dashboard renders again immediately (regression check on the dev fallback).

12. **IAM split** (the carried-forward `// TODO(phase-05)` from phase 03 + 04).
    - In AWS IAM, create a new IAM user `internal-tool-reader` with a policy granting only `s3:GetObject` on `arn:aws:s3:::internal-tool-snapshots/*`. (Optional `s3:HeadObject` if needed for content-length checks; we don't currently use it.)
    - Generate access keys for that user.
    - **Vercel Production env**: replace `SNAPSHOT_AWS_ACCESS_KEY_ID` and `SNAPSHOT_AWS_SECRET_ACCESS_KEY` with the new reader's credentials. `SNAPSHOT_AWS_REGION` and `SNAPSHOT_BUCKET` unchanged.
    - **Local dev**: leave Tanner's credentials in `.env` for now — `scripts/snapshot/upload.ts` (the writer) still needs `s3:PutObject`, which the dedicated reader principal doesn't have. The writer + reader split is asymmetric: writer keeps Tanner's IAM (local-only), reader gets the new dedicated principal (Vercel prod).
    - Update both `// TODO(phase-05)` markers:
      - `src/lib/server/snapshot-source.ts` → comment notes "swapped to dedicated reader IAM in Vercel Production env".
      - `scripts/snapshot/upload.ts` → comment notes "writer still uses Tanner's IAM by design; reader is split".
    - Smoke: `vercel env ls production` confirms the new keys; redeploy; `/api/snapshot/...` still works.

13. **CLAUDE.md risk-acceptance rewrite.**
    - Find the existing "URL obscurity + bearer + throttle" paragraph (likely in `CLAUDE.md` or one of the design docs).
    - Replace with: "WorkOS-gated session (corporate SSO via Google OAuth, domain-restricted to `@atalantech.com`) + private S3 (read by a dedicated read-only IAM principal) + Vercel server-side validation on every request. v2 adds CloudFront edge caching."
    - This is the README's L13–L14 follow-up. One paragraph; commit it.

14. **Vercel Production deploy.**
    - `vercel env add WORKOS_API_KEY production` (production key, not test — get from WorkOS dashboard once the production environment is created).
    - `vercel env add WORKOS_CLIENT_ID production`.
    - `vercel env add WORKOS_COOKIE_PASSWORD production` (different value from local; fresh `openssl rand`).
    - `vercel env add WORKOS_REDIRECT_URI production` → `https://<vercel-prod-url>/api/auth/callback`.
    - `vercel env add ALLOWED_EMAIL_DOMAIN production` → `@atalantech.com`.
    - Add the production redirect URI to AuthKit's allowlist in the WorkOS dashboard.
    - **Confirm `AUTH_BYPASS` is absent**: `vercel env ls production` — README L11.
    - `git push` → deploy.
    - End-to-end on the deployed URL: `@atalantech.com` sign-in works; `@gmail.com` rejected.

15. **Documentation pass.**
    - Update `README.md` "Routing" table to add `/api/auth/{login,callback,logout}`.
    - Update `README.md` "Environment variables" section: WorkOS section is now wired (no longer "waits for phase 05").
    - Mark `design/05-workos-setup/README.md` § Acceptance items checked.
    - Add a "What shipped" section at the bottom of this PLAN.

---

## What this phase deliberately does NOT do

- **Per-user role/permission gating.** README "Out of scope". v1 treats all signed-in `@atalantech.com` users as full-access.
- **Real Google Workspace SSO connection.** That requires the corporate SSO admin conversation. We use AuthKit's Google social provider for now; the connection swap later is dashboard-only.
- **Multi-domain allowlist.** v1 is `@atalantech.com` only. Adding contractor domains is a one-line env-var change later.
- **Single-logout (SLO) across all SSO sessions.** WorkOS supports it; we don't wire it. Logging out of our app clears our cookie only.
- **Session refresh / sliding expiration.** v1: cookie's `Max-Age` is whatever WorkOS's seal default is (~24h). Re-login when it expires. Refresh tokens are a v2 concern.
- **Audit trail UI.** WorkOS captures the audit log on their side (per README L13). We don't surface it in our dashboard.
- **Login-page customization.** AuthKit hosted UI is fine for v1. Custom branding is a WorkOS dashboard tweak later.
- **CSRF protection on `/api/auth/*`.** AuthKit handles the OAuth state; our `state` param carries `return_to` only. The callback endpoint validates the WorkOS-issued code; an attacker crafting a fake callback URL can't produce a valid `code` without a corresponding WorkOS session creation.

---

## Open questions to resolve before / during execution

- **Vercel preview deploys.** Each preview gets a unique URL; AuthKit's redirect allowlist is finite. Three options: (a) add `https://*.vercel.app` as a wildcard if AuthKit supports it, (b) leave preview broken-by-default and rely on local dev for visual review, (c) set up a single stable preview URL via Vercel's "preview alias" feature. Default: (b) — we don't review on previews today; phase 04 used production smoke directly. Revisit if preview becomes load-bearing.
- **`secure: true` cookie on `localhost:5173`.** Browsers reject `Secure` cookies on plain `http://`. Conditional: `secure: process.env.NODE_ENV === 'production'`. Or always-true and rely on Vite's HTTPS dev server. Default: conditional, since flipping Vite to HTTPS adds setup friction.
- **`return_to` validation strictness.** Must reject absolute URLs (open-redirect). The check should be `returnTo.startsWith('/') && !returnTo.startsWith('//')`. The `//` exclusion catches protocol-relative URLs (`//evil.com/path`) which browsers otherwise treat as absolute.
- **Cookie eviction on domain rejection.** When the callback rejects `@gmail.com`, we redirect to `/api/auth/login?error=domain`. Should we also call WorkOS's "delete user" API to remove the user from the WorkOS user pool? Default: no — let the WorkOS pool grow with rejected sign-in attempts; they can't get past our gate anyway. Revisit if the user pool becomes noisy.
- **Production `WORKOS_COOKIE_PASSWORD` rotation.** No rotation plan in v1. If we ever rotate, every existing session is invalidated (acceptable for 5–20 users). Document this in the env-var section so future-Tanner doesn't get surprised.

---

## Acceptance

- [ ] `npm test` passes (existing tests + new `requireSession` tests).
- [ ] `npm run check` clean.
- [ ] `npm run build` clean; `@workos-inc/node` doesn't appear in the client bundle.
- [ ] `npm run dev` with `AUTH_BYPASS` unset and the four `WORKOS_*` + `ALLOWED_EMAIL_DOMAIN` vars set:
  - Hitting `/platform-engagement` redirects to AuthKit hosted login.
  - `@atalantech.com` Google sign-in lands on the requested page with cookie set.
  - `@gmail.com` sign-in is rejected at the callback; user is redirected back to login with `?error=domain` and no cookie set.
  - `/api/snapshot/...` and `/api/posthog/...` return 401 JSON when no cookie is present.
  - `/api/auth/logout` clears the cookie; subsequent page request bounces back to login.
  - `AUTH_BYPASS=1` re-set: dashboard renders without going through WorkOS at all (dev fallback intact).
- [ ] Vercel Production env: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`, `ALLOWED_EMAIL_DOMAIN` set; `AUTH_BYPASS` absent.
- [ ] Production redirect URI added to AuthKit allowlist.
- [ ] End-to-end on the deployed Vercel URL: `@atalantech.com` sign-in works; `@gmail.com` rejected.
- [ ] Dedicated read-only IAM principal swapped into Vercel Production for `SNAPSHOT_AWS_*`. Both `// TODO(phase-05)` markers updated/cleared.
- [ ] CLAUDE.md (or wherever the risk-acceptance paragraph lives) rewritten to "WorkOS-gated + private S3 + dedicated reader IAM."
- [ ] `README.md` Routing table includes `/api/auth/*`. Environment-variable section reflects WorkOS-wired status.

---

## What shipped

Recorded after the build so future phases can see deltas between plan and reality.

### Built per plan

- **`@workos-inc/node@^9.2.0`** added as a runtime dependency; not surfaced in the client bundle (verified via `grep -r "@workos-inc" .svelte-kit/output/client/`).
- **`src/lib/server/workos.ts`** — module-scope WorkOS client (lazy, env-validated), cookie name + options, env readers (`workosClientId`, `workosCookiePassword`, `workosRedirectUri`, `allowedEmailDomains`), `isEmailAllowed`. The `secure` flag on the cookie is conditional on `url.protocol === "https:"` so localhost dev still works.
- **`/api/auth/login/+server.ts`** — `provider: "authkit"` authorization URL with a base64url-encoded `state` carrying `return_to` round-tripped through WorkOS.
- **`/api/auth/callback/+server.ts`** — exchanges code via `authenticateWithCode({ session: { sealSession: true, cookiePassword } })`, enforces `ALLOWED_EMAIL_DOMAINS` (default `@atalantech.com`), sets `wos-session` cookie, redirects to validated `return_to`.
- **`/api/auth/logout/+server.ts`** — `loadSealedSession({...}).getLogoutUrl()` so AuthKit's own session is also destroyed; without that, AuthKit silently re-authenticates on the next `/api/auth/login` and the user appears never to log out.
- **`src/hooks.server.ts`** — `/api/auth/*` skip-list at the top so the login/callback/logout routes can run without a session.
- **`src/lib/server/auth.ts`** — `requireSession()` body swapped: `AUTH_BYPASS=1` short-circuit, then sealed-cookie unseal via `authenticateWithSessionCookie`. Page routes redirect to `/api/auth/login?return_to=...` on miss; API routes throw 401.
- **`src/lib/ui/TopBar.svelte`** — added a "{email} • Sign out" cluster on the right side of the top bar, visible whenever `page.data.session.user.email` is present.
- **Tests** — `src/lib/server/auth.test.ts` (6 tests covering bypass, missing/invalid cookie on page + API routes, valid cookie) and `src/lib/server/workos.test.ts` (4 tests covering domain allowlist defaults, case-insensitivity, comma-list parsing, look-alike rejection). Both colocated next to source per the repo's pattern. 64/64 tests pass.
- **`README.md`** updated: routing table now lists `/api/auth/{login,callback,logout}`; environment-variable section reflects WorkOS-wired status; auth-seam phase boundary describes the new cookie + redirect behavior.

### Diverged from plan

- **AuthKit-with-Google-social, not Google Workspace SSO.** PLAN.md had two paths: AuthKit social (faster, no SSO admin call) vs. real Google Workspace SSO (proper, requires admin). Took the social-login path — the in-callback domain allowlist on `@atalantech.com` is sufficient for v1's risk bar. Real Google Workspace SSO is the deferred follow-up; switching to it later is a WorkOS dashboard change, not an app-code change.
- **WorkOS staging vs. production environments.** PLAN.md treated WorkOS as a single project. In practice, WorkOS has fully separate Staging and Production environments; each has its own API keys, client IDs, redirect allowlists, and Google OAuth configuration. We had to redo the entire AuthKit setup (Google OAuth, redirect URIs, sign-out redirect, Google Cloud Console OAuth client) in the production environment. **Carry-forward**: any future WorkOS work needs to specify which environment it targets.
- **Production needs bring-your-own Google OAuth credentials.** Staging in WorkOS lets you use shared dev credentials; Production requires you to register your own OAuth client in Google Cloud Console (Atalan workspace) and paste in Client ID + Client Secret. Captured in the README + `.env.example` for next time.
- **`CLAUDE.md` risk-acceptance rewrite is moot.** No `CLAUDE.md` exists in this repo; the prior-design language doesn't appear anywhere here. The follow-up was folded into `README.md`'s environment-variables and auth-seam sections instead. The corresponding `DESIGN.md` open question was removed.
- **Sign-out logout-URL gotcha.** PLAN.md had logout as one line. In practice we needed `loadSealedSession({...}).getLogoutUrl()` — without it, "Sign out" appeared to do nothing because AuthKit silently re-authenticated. The WorkOS dashboard also requires a "Sign-out redirect" / "App homepage URL" to be configured, otherwise the post-logout lands on a `*.authkit.app` confirmation page.
- **Production redirect-loop debugging cycle.** PLAN.md acceptance criteria included a single end-to-end smoke. Reality: we hit a multi-hour debugging cycle on Vercel Production stemming from (a) initially not switching the WorkOS dashboard to its Production environment, (b) bring-your-own Google OAuth credentials being required there, (c) the original callback bouncing back to `/api/auth/login` on failure, which caused `ERR_TOO_MANY_REDIRECTS` instead of a useful error. Resolved by (i) doing the WorkOS production environment setup, (ii) patching the callback to throw a 500 with the actual WorkOS error message instead of redirecting on failure, (iii) `requireSession` clearing a known-bad cookie before bouncing so a stale unsealable cookie can't trigger an infinite loop. Both diagnostic logging and the loop-breaker are still in place — they're cheap and made the difference between "opaque redirect loop" and "exact error in Vercel logs."

### Carried forward

- **Dedicated read-only IAM principal** for the snapshot reader (`SNAPSHOT_AWS_*` swap). Phase 03 + 04 carried it forward as a `// TODO(phase-05)` in `scripts/snapshot/upload.ts:45` and `src/lib/server/snapshot-source.ts:83`. Both markers still in place; the swap is a 10-minute AWS IAM + Vercel env update separate from the auth flow itself, deferred so phase 05 could close on the auth deliverable. Treated as a security-hardening follow-up.
- **Real Google Workspace SSO connection.** When Atalan IT decides to bind the dashboard to the Workspace org explicitly, swap the AuthKit social-login config for a Google Workspace OIDC connection in the WorkOS dashboard. The `/api/auth/callback` domain check can then be removed (or kept as belt-and-suspenders).
- **Audit trail UI.** WorkOS captures the audit log on their side; we don't surface it in our dashboard. If/when we need it visible to the CS team, surface the WorkOS Events API.
- **Per-user role/permission gating.** v1 treats all signed-in `@atalantech.com` users as full-access. Future tier scoping (CS vs. Product, read-only vs. admin) extends the `Session` type and adds gates per route. The signature of `requireSession()` is the seam.

### Verified vs. live (production)

- `https://usage-deck-internal-tool-prototype.vercel.app/platform-engagement` unauthenticated → 302 to `/api/auth/login` → 302 to AuthKit hosted login on `api.workos.com` → "Sign in with Google" → `@atalantech.com` Google account → 302 back to `/api/auth/callback?code=...` → 302 to original page → dashboard renders, top-bar shows the email + Sign out link.
- Sign-out: top-bar Sign out link → `/api/auth/logout` → server unseals cookie + calls `getLogoutUrl()` → 302 to WorkOS logout endpoint → WorkOS destroys its session and 302s back to `/` → no cookie, requireSession bounces to login. Full SSO sign-out loop verified.
- All five Vercel Production env vars set: `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`, `ALLOWED_EMAIL_DOMAINS`. `AUTH_BYPASS` confirmed absent.
- WorkOS Production environment configured: AuthKit enabled, Google OAuth enabled with bring-your-own credentials from Google Cloud Console (Atalan project, Internal user-type OAuth consent screen), redirect URI `https://usage-deck-internal-tool-prototype.vercel.app/api/auth/callback` on the allowlist, sign-out redirect `https://usage-deck-internal-tool-prototype.vercel.app/`.
- `npm test` 64/64 pass; `npm run check` clean; `npm run build` clean; `@workos-inc/node` not in client bundle.
