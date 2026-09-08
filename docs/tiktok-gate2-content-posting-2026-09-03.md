# TikTok Gate 2 Content Posting evidence — 2026-09-03

Status: **BLOCKED after an expected provider policy rejection; no remote post was created.**

This record contains no access token, refresh token, client key, signed upload URL,
OSS bucket name, object key, user ID, account ID, task ID, publish ID, video ID,
provider response body, or test-account identifier.

## Scope and authorization

The user authorized one real Content Posting attempt with one designated Sandbox target
account and one approved MP4 test asset. The user confirmed that:

- they own the right to publish the asset;
- the content promotes the user's own Star Gaze brand;
- the content is AI-generated.

The action-time settings were therefore:

- one video and one account;
- public visibility;
- comments enabled;
- Duet and Stitch disabled;
- commercial-content disclosure enabled;
- own-brand disclosure enabled;
- paid-partnership disclosure disabled;
- AI-generated label enabled;
- immediate publishing.

Only one Create Task action was performed. No retry was made.

## Media preflight

The selected file was an MP4 with H.264 video and AAC audio. Its dimensions, frame rate,
duration, and file size were within the documented TikTok Content Posting limits.

The application uses `PULL_FROM_URL`. Before the provider call, the uploaded object was
confirmed to be anonymously available over HTTPS without a redirect, with the expected
content type and byte length. The public media URL prefix was also confirmed as a verified
URL property in the correct Developers Sandbox application.

## Temporary OSS CORS change

An initial empty CORS result was invalid evidence because the read omitted the explicit
bucket parameter. A later explicit-bucket read found four pre-existing shared rules.

After separate user authorization, the four rules were preserved in their original order
and a fifth temporary rule was appended with only:

- the exact one-time HTTPS review origin;
- `PUT`;
- the `content-type` request header;
- a 300-second maximum age;
- no exposed response headers.

The browser upload succeeded. After the provider rejection, the approved conditional
rollback re-read the full configuration, confirmed no drift, restored the original four
rules in one write, and verified the four-rule result. The pre-existing rules were not
tightened or otherwise changed.

## Provider result

The Content Posting initialization endpoint was called exactly once. TikTok returned an
HTTP 403 with the stable provider code:

`unaudited_client_can_only_post_to_private_accounts`

This is an expected unaudited-client policy rejection. It is not a transport failure and
not a provider-preflight failure. No publish ID, video ID, remote receipt, or remote post
was created.

The local task and item reached a failed terminal state, with no in-flight item remaining.
They are retained as audit evidence and must not be deleted or rewritten.

## Defect discovered by the attempt

The pre-fix implementation discarded the provider code, allowed raw provider text and
media-path data into diagnostic paths, and guessed the error category from message text.
Because the provider text included an HTTPS documentation link, the item was incorrectly
stored as `VIDEO_URL_UNAVAILABLE`.

The corrective implementation:

- carries a typed operation, provider code, HTTP status, and write outcome;
- maps this policy rejection to `TIKTOK_UNAUDITED_PRIVATE_ONLY` and fixed user text;
- never classifies an error from arbitrary provider message words or URLs;
- requires every successful creator-info, init, and status response to contain a valid
  top-level `error` object whose code is exactly `ok`, together with a valid `data` object;
- accepts an init publish ID only after trimming it and verifying that it is non-empty and
  no longer than 64 characters;
- accepts only the documented finite set of publish statuses, so an unknown or malformed
  status fails closed instead of entering a tight polling loop;
- treats transport, HTTP 408/425/429/5xx, and malformed success after init as unknown;
- never automatically retries a Content Posting initialization request;
- blocks generic retry for ambiguous initialization outcomes;
- carries the durable `publish_attempt_count` returned by the item lock through every
  provider-adjacent state transition;
- atomically claims the init dispatch marker with the expected item status, attempt, empty
  marker, and empty publish ID, and requires one returned row before calling TikTok;
- persists the normalized publish ID with that same attempt and marker fence, safely retries
  only that database write, and never starts status polling until persistence is confirmed;
- leaves a marker-bearing processing row for safe recovery/manual review if TikTok accepted
  init but the publish ID cannot be durably persisted, instead of repeating init or claiming
  that status confirmation is active;
- distinguishes an ambiguous init write from a retryable read-only status check: after a
  valid publish ID has been persisted, a transport, 5xx, or malformed status response
  leaves the item in `uploading` with that same ID so the recovery poller can resume it;
- checks every status-deferral and recovery CAS result; a zero-row result is reconciled
  against a concurrent durable winner, while a database error is never counted as a safely
  persisted `confirming` outcome;
- removes provider bodies, media URLs, object keys, tokens, and user paths from logs and
  stored error messages;
- keeps upload failures visible with sanitized details until the user dismisses or
  reselects the file.

## Verification

- targeted Content Posting safety tests: 13/13 passed;
- related TikTok regression tests: 48/48 passed;
- full Node suite: 393 total, 392 passed, 1 skipped, 0 failed;
- TypeScript type-check: passed;
- changed-file ESLint: passed;
- production build: passed with the pre-existing `formidable` dynamic-import warning;
- `git diff --check`: passed.

The build also printed existing Next.js dynamic-route diagnostics during static-page
collection. The build completed successfully; those diagnostics are not caused by this
Content Posting correction.

## Hard stop before a second attempt

Gate 2 is not complete. A second real attempt is prohibited until all of these conditions
are satisfied:

1. this corrective code and evidence receive strict read-only approval;
2. the user separately authorizes and personally changes the designated Sandbox target
   TikTok account to private;
3. creator-info is queried again and confirms that `SELF_ONLY` is available and public
   visibility is no longer offered;
4. a new temporary OSS CORS change receives separate authorization and the media upload,
   anonymous HTTPS access, URL-property ownership, database baseline, and unique runtime
   are revalidated;
5. the user reviews the final parameters and gives a new action-time confirmation;
6. Create Task is clicked once only; any ambiguous result is investigated without retry.

The next intended parameters are private account plus `SELF_ONLY`, comments subject to the
account's actual settings, Duet and Stitch off, own-brand disclosure on, paid partnership
off, and AI-generated label on. A private post is not promised to support cross-account
comment testing; comment read/reply remains a separate later gate.

This record does not authorize another upload, CORS change, account privacy change,
provider call, task creation, Portal change, feature flag, migration, Git operation, or
deployment.
