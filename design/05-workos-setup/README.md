# 07 — WorkOS setup

Replace the placeholder session gate with real corporate SSO.

## Scope

- WorkOS account + SSO connection. **Blocked on a 30-minute conversation with the corporate SSO admin** to learn which IdP (Okta? Azure AD? Google Workspace?) and get the metadata wired up.
- `/api/auth/*` routes: WorkOS callback, session creation, sign-out.
- HTTP-only session cookie, validated by every server route (`/api/snapshot/*`, `/api/posthog/*`, `+page.server.ts`).
- Replace the placeholder `+page.server.ts` gate from phase 01 with the real WorkOS validation.
- Audit trail: WorkOS logs which user accessed which page. Useful for the quasi-PHI posture.

## References

- `../DESIGN.md` § 5 (Auth — WorkOS)
- `../DESIGN.md` § Open questions → "Which IdP does WorkOS connect to?"
- `../DESIGN.md` § Open questions → CLAUDE.md risk-acceptance language rewrite

## Dependencies

- Phase 01 (the placeholder gate is the thing being replaced).
- Conversation with the SSO admin — schedule this early; it's the longest pole.

## Follow-up after this phase

- Rewrite the risk-acceptance paragraph in `../../CLAUDE.md` (or wherever it ends up): replace "URL obscurity + bearer + throttle" with "WorkOS-gated + private S3 + edge cache."

## Out of scope

- Per-user role/permission gating beyond "is signed in" — v1 treats all signed-in users as full-access.
