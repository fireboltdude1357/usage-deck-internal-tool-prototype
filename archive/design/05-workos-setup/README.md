# 05 — WorkOS setup

**Status: shipped 2026-05-06.** AuthKit + Google OAuth as the social provider,
with `@atalantech.com` domain enforced in our `/api/auth/callback`. The
"corporate SSO admin call" (a real Google Workspace SSO connection) is
deferred to a future hardening pass — for v1 the social-login + domain check
is the production gate.

See `PLAN.md` § "What shipped" for the executed details.

## Scope

- [x] WorkOS account + connection. AuthKit hosted login with Google as the social provider; production environment in WorkOS uses the bring-your-own Google OAuth credentials. The "30-minute conversation with the SSO admin" for a Google Workspace SSO connection is **deferred** — the social-login path with our own domain allowlist meets v1's risk bar.
- [x] `/api/auth/*` routes: WorkOS authorize redirect, callback, sign-out (sign-out hits `loadSealedSession().getLogoutUrl()` so AuthKit's session is also destroyed).
- [x] HTTP-only sealed session cookie validated by every server route (`/api/snapshot/*`, `/api/posthog/*`, page routes via `hooks.server.ts`).
- [x] Replaced `requireSession()` body in `src/lib/server/auth.ts` with the real WorkOS validation.
- [x] Confirmed `AUTH_BYPASS` is absent from Vercel Production env (verified via `vercel env ls production`).
- [ ] **Deferred:** swap `SNAPSHOT_AWS_*` to a dedicated read-only IAM principal scoped to `s3:GetObject` on `internal-tool-snapshots/*`. Both `// TODO(phase-05)` markers stay in place; tracked as a follow-up. The current reader still uses Tanner's IAM.
- [x] Audit trail: WorkOS captures every login + logout event in their dashboard.

## References

- `../DESIGN.md` § 5 (Auth — WorkOS)

## Dependencies

- Phase 01 (the placeholder gate is the thing that got replaced).

## Follow-up after this phase

- Dedicated read-only IAM principal for the snapshot reader (see deferred bullet above; phase 03 + 04 carry-forward).
- Real Google Workspace SSO connection — moves the domain check from our callback into the WorkOS connection itself, plus adds the audit-trail richness of a real SSO bind. Currently social-login is sufficient; revisit when Atalan IT scales beyond the convenience of "Sign in with your Google account."

## Out of scope

- Per-user role/permission gating beyond "is signed in" — v1 treats all signed-in `@atalantech.com` users as full-access.
