# Facebook video / Page post identity recovery

## Incident and evidence

- Production accepted signed Page comment events (HTTP 200) but saved zero comments.
- The test video's publish item is owned and published, but `facebook_post_id` is NULL.
- Facebook's visible comment links identify a backing post distinct from the video's ID. The receipt deliberately does not retain the original event payload; the exact payload ID was not directly observed.
- The old publisher retried `Video.post_id` briefly and saved NULL if unavailable, with no later compensation. Webhook matching requires exact published content plus account/task ownership; it correctly refuses guesses.

## Changes

1. Read the video's identity, including a minimal-fields fallback. During publishing, preserve the bounded identity retries and only scan Page posts on the final attempt. Never repeat the upload.
2. If unresolved, scan up to three pages of 50 published Page posts. Match the exact video `object_id` or attachment `target.id`, then independently GET the candidate post. Accept only the exact post ID, exact video object, same Page author, `status_type=added_video` and `is_published=true`. This rejects re-shares and permits an authoritative match on the first page even when the Page has more than three pages. Never infer an association from text, titles, dates or a comment's encoded ID.
3. Reconstruct pagination URLs on the fixed Graph host using only cursors. Bound the whole direct lookup (including verification) to 12 seconds; broker transport retains its existing timeout. Missing or unverifiable results remain unresolved; a candidate outside the three-page bound is not automatically recoverable.
4. The original comment sync saves comments and completes **without any identity lookup**. It returns an owned sync-log ID only for Facebook. After the client refreshes displayed comments, it issues separate sequential POST requests to `/api/facebook/post-identity/recover` (not awaited by the sync UI). Each request awaits its own work; there is no untracked server background promise. The recovery route requires authentication and enabled Facebook/comments flags. It accepts only a UUID identifying the caller's completed Facebook sync, atomically claims its `pending` metadata once, and obtains the account/video from that server-written log, not client-supplied ownership or token data.
5. Recovery verifies the active account owner and task owner, then compare-and-sets only the missing `facebook_post_id`; no overwrite of existing or concurrently recovered mappings. The independent request records `running` and the terminal recovery status under `facebook_post_identity_status`, preserving the sync's other metadata. Lookup errors cannot hold up comment persistence, its response or UI. Existing sync throttling bounds creation of new eligible logs; repeated claims do not repeat provider work. If the browser closes or a recovery request fails, a later successful normal sync provides another attempt; this is not a durable background queue and no automatic-success claim is made.
6. Facebook feed matching accepts both bare Post IDs and Page_Post IDs while retaining all signature, account, uniqueness and task-owner checks.

Only Facebook behavior changes. The shared broker route gains one Facebook-only read operation; the shared comments service invokes compensation only in its Facebook branch. No schema change, new credential, new permission, YouTube/Instagram behavior change or frontend polling change.

## Deployment gate — three runtime locations

Do not deploy or backfill without approval. Commit/push/merge alone does not update production.

1. Deploy the approved commit to the overseas broker **first**, including its new `facebook:resolveFacebookVideoPostIdentity` allowlisted operation. The broker must keep `OAUTH_BROKER_URL` unset; existing authenticated transport is unchanged. A missing operation leaves recovery failed, not successful.
2. Deploy that same approved commit to the website / publishing worker. The identity read follows the configured broker in production; no direct CN Graph fallback. Existing publishing worker transport is unchanged.
3. Deploy `facebook-comments-webhook` to production Supabase. In dashboard form, keep the established `npm:@supabase/supabase-js@2.86.0`, `./core.ts`, `./instagram-core.ts` imports and dashboard entrypoint. Include the current main `index.ts` with **no `.limit(2)` on active accounts**. Leave the existing limits for ambiguity detection on content/tasks intact. Compare all deployed file contents, not only core.ts. Preserve the current JWT setting and signature verification; do not change secrets.

Record old deployment versions before release. If rollback is required, roll back only these Facebook changes in their respective deployments. Do not delete comments or overwrite unrelated platform configuration.

## Existing-video recovery and acceptance

1. After release, use the owner's normal Facebook comments sync once on the affected video. Comments should display before the independent recovery request completes. Keep the page open for that request, and verify the mapping and the action-log terminal status (`recovered` or `present`, not merely `pending`/`running`). It does not publish or rebind anything. Do not count this sync as webhook proof. Non-browser callers must explicitly call the authenticated recovery endpoint using the returned Facebook sync-log ID.
2. Stop manual/automatic API sync for the acceptance observation. Add a **new uniquely named** comment on that same Facebook video.
3. Verify a new signed receipt with HTTP 200 and `saved_count: 1`; confirm the matching comment row has `metadata.source = webhook` and the correct owned task item/video. Other legacy bindings may legitimately increment `ignored_count`.
4. Re-delivery must not insert a duplicate; an unrelated Page/video or foreign task must not write a row. Verify ordinary video comment reads/replies still work.
5. Existing comments ignored before release are not automatically replayed by Meta after an HTTP 200. A normal sync recovers their content; only a subsequently received event demonstrates webhook delivery.

Unresolved/unverifiable mappings must remain visible in diagnostics. Very old videos outside the bounded scan or posts without the required original-video evidence may require a separate, explicitly approved targeted repair based on a verified API response. Do not manually paste guessed IDs into production.

An already-open website comment list still has its existing refresh behavior. This repair addresses webhook persistence, not frontend live updating; do not claim automatic on-screen updates solely from database success.

## Primary references

- [Meta SDK video fields, including post_id](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/advideo.py)
- [Meta SDK published_posts edge](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/page.py)
- [Meta SDK Post fields / attachments edge](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/post.py)

These references inform the lookup implementation; mocked tests do not replace a production v25 acceptance run.

## Local verification (2026-09-17)

- Dedicated worktree `fb-post-identity/social-engagement`, branch `codex/facebook-post-identity-20260917`, based on `048b3dec` (fetched origin/main).
- Node 20.20.2: Facebook/social-comments tests **107 passed**; includes 21 publisher/identity/recovery/broker/independent-request tests. Added coverage for a page-one candidate with more than three pages, rejection of re-shares/foreign/unpublished posts, immediate client return during a pending recovery request, one-time claims and endpoint authentication.
- Facebook Edge tests **11 passed**, including three bindings, bare/compound post IDs, missing mapping, foreign task and ambiguous content cases; Deno entrypoint check passed.
- Unchanged shared/Instagram Edge regression tests **25 passed**.
- Whole-project type-check and production build passed. Build used placeholder Supabase credentials (no production database access), not a live integration environment. Build retains dependency/Edge-runtime and static-render diagnostics outside the modified Facebook code; no changes were made to those modules.
- Initial reuse of an older dependency directory failed type-check due to missing main dependencies; replaced with a dedicated lockfile install (lockfile unchanged). An initial regression test exposed an eager Facebook import in the shared service; Facebook-only lazy loading resolved it without changing other platforms or their tests.
- The follow-up review found blocking recovery and full-history scan dependence. Recovery now runs in a separately authenticated request after comments display, and candidate posts are independently verified. Running build/type-check concurrently once caused missing generated `.next/types` errors; final verification must run type-check after build, sequentially.
- No commit, push, deployment or production-data backfill performed in this task. Live v25 acceptance remains required after the three runtime deployments.
