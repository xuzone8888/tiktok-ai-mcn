# TikTok private task previews — deployment gate

Status: TEST migration applied and ACL/RLS/schema-cache verified on 2026-09-17;
storage infrastructure NOT configured. See tiktok-preview-test-migration-20260917.md.
The currently running local test server is not switched by this change.
Do not roll this app forward before storage and migration are ready: FILE_UPLOAD
init deliberately refuses tasks without a ready preview, including old clients.
Finish/resolve existing uploads on the old release before switching releases.

## Required before enabling this build

1. TEST database: `20260916_tiktok_private_previews.sql` is already applied; do NOT
   replay its non-idempotent CREATE statements. It adds
   two RLS-protected, service-role-only tables, one reservation RPC and a deletion
   trigger. It does not modify provider publish state or existing task rows.
2. Configure a dedicated PRIVATE OSS bucket (not the public media/CDN bucket),
   without a bucket policy, versioning, CDN domain, or anonymous access. Configure
   `TIKTOK_PREVIEW_OSS_BUCKET`, `TIKTOK_PREVIEW_OSS_REGION` and OSS RAM credentials
   through `TIKTOK_PREVIEW_OSS_ACCESS_KEY_ID` / `TIKTOK_PREVIEW_OSS_ACCESS_KEY_SECRET` on the server.
   The RAM policy needs bucket ACL/policy/versioning reads and object POST, HEAD,
   GET, ACL reads and DELETE for this bucket. Never place credentials in client env.
   The implementation accepts US East/West only to match the current privacy-policy
   storage description. Other regions require a separate review. Do not reuse the
   legacy public media bucket or its CDN. Budget for an additional retained video
   copy, upload bandwidth and authenticated playback egress.
3. Allow browser POST in bucket CORS only from the exact active local/review origin
   (and later the exact production origin). The signed policy restricts exact key,
   MIME, size, private ACL, expiration and no-overwrite. No public object URL is used.
4. Before installing an hourly job, confirm its host, TEST database, exact TEST
   bucket and alert recipient. These deployment details are not yet complete;
   do not install a production cron. After approved manual cleanup validation,
   the intended Node 20 command is:
   `node --env-file=/absolute/private/env scripts/sweep-tiktok-previews.mjs`.
   Alert on nonzero exit. Test retries and cascade deletion. The first successful
   sweep may physically remove queued files, while tombstones repeat deletion for seven days
   to catch late completion. Unfinalized uploads expire after one day.
   `--dry-run` only parses configuration; it does not verify remote permissions
   or enumerate deletions. See the Chinese handoff for unresolved ownership.
5. Verify both new route paths are built in a separate local candidate instance;
   keep the existing local UI runtime running. GET `/api/publish/previews` must return
   ready for a logged-in user and 401 anonymously before allowing task creation.
6. Test: cross-user access, anonymous access, exact upload policy, refresh playback,
   Range seek (206/416), interrupted upload, zero-row finalize, task/item/account
   data deletion and expired orphan cleanup. Anonymous OSS GET must be denied.

New local-file posts save a source video and JPEG cover before provider init. This
is still FILE_UPLOAD to TikTok; no PULL_FROM_URL fallback and no second remote post.
Saved previews are source copies, not evidence of TikTok public visibility. A browser
must support the source codec (MP4/H.264 recommended); this implementation does not
transcode MOV/WebM. Reservations cap each user at 100 items / 20 GiB and each video
at 4 GiB. A video sent to multiple accounts currently has one private copy per item.

Existing published items have no retained source. Backfill with the original file
through the same reserve/upload/finalize endpoint; never call provider init again.
Missing saved previews offer a “Save preview / 补存预览” file selector. It captures
a bounded JPEG and uses reserve/upload/finalize only: it never invokes provider
init or creates another task. The selected video must match the original size and
MIME; these checks cannot prove identical content for historical files without a
stored digest, so users must select the original source. A saved preview is not
verification of the published TikTok video.

For localhost testing, set NEXT_PUBLIC_APP_URL to the exact active localhost origin
and include that origin in the private bucket CORS policy. Do not weaken the origin
check to accommodate an obsolete tunnel address. TikTok OAuth testing separately
requires a valid registered HTTPS callback; this preview-only test does not.

2026-09-17: local UI-only runtime remains separate and does not enable this feature.
Storage variables/credentials are missing from that runtime. TEST migration is now
applied. No real storage write, production deployment or cleanup job has been executed.

## Rollback

Roll back the app first; existing publish tables and provider state are unchanged.
Do not drop these tables while files remain: doing so loses the cleanup queue.
Drain previews and cleanup with an explicitly approved maintenance operation, then
remove the two functions, trigger and tables. Keep worker/config until the queue is
empty. Refresh PostgREST schema cache after schema changes. No production migration,
OSS bucket creation, credential changes or real upload is authorized by this document.
