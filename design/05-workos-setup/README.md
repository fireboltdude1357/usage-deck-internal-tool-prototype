# 05 — WorkOS setup

Replace the placeholder session gate with real corporate SSO.

## Scope

- WorkOS account + SSO connection. **Blocked on a 30-minute conversation with the corporate SSO admin** to learn which IdP (Okta? Azure AD? Google Workspace?) and get the metadata wired up.
- `/api/auth/*` routes: WorkOS callback, session creation, sign-out.
- HTTP-only session cookie, validated by every server route (`/api/snapshot/*`, `/api/posthog/*`, `+page.server.ts`).
- Replace the placeholder `+page.server.ts` gate from phase 01 with the real WorkOS validation.
- **Confirm `AUTH_BYPASS` is absent from Vercel Production env** before launch. Phase 04 set it temporarily for the deploy smoke and removed it; verify with `vercel env ls production` so a stale `AUTH_BYPASS=1` doesn't silently bypass the new SSO gate.
- **Swap `SNAPSHOT_AWS_*` to a dedicated read-only IAM principal** scoped to `s3:GetObject` on `internal-tool-snapshots/*`. Today both the writer (`scripts/snapshot/upload.ts`) and the reader (`src/lib/server/snapshot-source.ts`) share Tanner's `tanner.sharon` IAM. Phase 05 splits to a dedicated principal for the reader (or for both) before non-Atalan users hit the deployed app. `// TODO(phase-05)` markers exist at both call sites for the swap.
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
