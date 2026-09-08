# TikTok Gate 0 Local Baseline - 2026-09-02

> Evidence classification: sanitized, read-only local/staging baseline.
> This record contains no OAuth code, client secret, access token, refresh token,
> state value, account ID, user ID, or database credential.

## Git and build baseline

- Branch: `codex/tiktok-review-latest-main`
- Base HEAD: `30848db5462ac6345bc38c4b98f792ab373699f7`
- `origin/main`: `30848db5462ac6345bc38c4b98f792ab373699f7`
- Index: empty
- Unmerged paths: none
- Safety stash: present (`codex-before-latest-main-sync-20260902`); object ID is intentionally omitted
- TikTok migration work: uncommitted working-tree changes
- Node: 20.19.5
- Node tests: 380 total / 379 passed / 1 skipped / 0 failed
- TypeScript type-check: passed
- Full `src` ESLint `--quiet`: passed
- Production build: passed with existing non-blocking warnings
- `git diff --check`: passed

## Effective local environment

- `NEXT_PUBLIC_APP_URL`: configured as loopback HTTP
- Login Kit callback: configured as non-loopback HTTPS with the exact
  `/api/tiktok/auth/callback` path
- Login Kit callback and local app origin: not currently aligned
- Business callback: not configured
- Business App ID/Secret: not configured
- OAuth broker: not configured
- Video-list server/UI flags: absent and therefore fail closed
- Social-comments API/UI flags: absent and therefore fail closed
- TikTok reply server/UI flags: absent and therefore fail closed
- Production readiness: expected failure because the current local app origin is HTTP

No new OAuth may start from this configuration. Gate 1 requires a new single-session
HTTPS origin, a fresh build, and an exact Sandbox callback update before authorization.

## Dedicated test-user baseline

- Supabase test user: present and email-confirmed
- Owned TikTok publishing accounts: 1
- Account type/status: `normal` / `active`
- Secure token rows for the account: 1
- Business comment token rows: 0
- Stored publishing scopes include the four existing publishing/profile scopes and
  `video.list` from the previously accepted Sandbox authorization
- Ordinary OAuth states among the latest 25 rows:
  - completed: 1
  - expired: 1
  - pending/processing: 0
- Business OAuth states among the latest 25 rows:
  - expired: 1
  - pending/processing: 0

The latest-25 figures above describe only the dedicated test user and are not used as
proof that the shared Sandbox callback is globally drained.

The previous `video.list` grant is historical evidence only. Because both rollout
flags currently fail closed, it does not enable the video-list UI or API in this build.

## Global TikTok storage invariants

- TikTok accounts: 58
- Normal accounts: 56
- Shop/non-normal accounts: 2
- Secure normal-token rows: 56
- Secure rows associated with Shop/non-normal accounts: 0
- Global ordinary OAuth states:
  - pending total: 0
  - pending and unexpired: 0
  - processing total: 0
  - processing with a valid lease: 0
- Global Business OAuth states:
  - pending total: 0
  - pending and unexpired: 0
  - processing total: 0
  - processing with a valid lease: 0

These are full-table, non-sensitive aggregates collected immediately before the
callback-change planning checkpoint. They contain no state value, user ID, account ID,
token, code, or credential.

## Gate 0 conclusion

Gate 0 data and code baselines pass. The full-table aggregates show no active ordinary
or Business OAuth flow to drain, and there is no Shop token contamination. Because a
new flow could start after this snapshot, the same global drain query must run again
immediately before any shared Sandbox callback change. Gate 1 remains blocked on the
separately authorized HTTPS Sandbox test-session setup and exact callback synchronization.

No database row, environment variable, Portal setting, feature flag, Git commit,
remote branch, deployment, or migration was changed while collecting this evidence.
