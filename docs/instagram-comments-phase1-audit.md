# Instagram Comments Phase 1 Audit

## 1. Scope and rollout status

This audit is a static preflight for Instagram comment reads and manual replies. It does not enable Instagram in the social-comments platform allowlist, add Instagram comment UI, call a live Meta API, implement pagination, or persist webhook comment events.

The current local `INSTAGRAM_AUTH_MODE` is `instagram`. The current social-comments allowlist remains YouTube-only, and the unified `/social-comments` center remains disabled.

## 2. OAuth mode and token types

The code supports two mutually exclusive global authorization modes:

| Auth mode | API host | Account access token stored in `instagram_account_tokens.access_token` | Refresh credential stored in `refresh_token` |
| --- | --- | --- | --- |
| `facebook` | `graph.facebook.com` | Page access token associated with the Instagram professional account | Long-lived Facebook user access token |
| `instagram` | `graph.instagram.com` | Instagram long-lived user access token | Instagram long-lived user access token |

The native Instagram discovery path copies the long-lived Instagram token into the discovered account token. The Facebook Login discovery path obtains the Page access token from `/me/accounts` and stores that Page token for publishing and comment calls.

`instagram_accounts` and `instagram_account_tokens` do not store the auth mode used when the account was bound. API host selection depends entirely on the environment-wide `INSTAGRAM_AUTH_MODE`. Therefore, one environment cannot safely mix accounts bound through both modes. Changing the global auth mode can make previously bound accounts use the wrong token/host combination; those accounts should be reconnected under the new mode. This phase intentionally does not add an auth-mode column or migration.

## 3. Comment permissions and scope truth

Required comment scope set by login mode:

| Auth mode | Required scopes for both read and reply | Matching rule |
| --- | --- | --- |
| Facebook Login | `instagram_basic`, `instagram_manage_comments`, `pages_read_engagement` | All scopes required |
| Instagram Login | `instagram_business_basic`, `instagram_business_manage_comments` | All scopes required |

Meta's official Instagram Login collection lists `instagram_business_manage_comments` among the current `instagram_business_*` scopes. Meta's comment moderation examples use `GET /{ig_media_id}/comments` and `POST /{ig_comment_id}/replies`. References: [Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login) and [Get Comments](https://www.postman.com/meta/instagram/request/23987686-c91bedd7-ac95-43c9-af29-8570fe293ace).

Requested scopes are not proof of granted scopes. The binding flow now follows these rules:

- `scopesToArray` parses, trims, and deduplicates only a supplied scope value. A missing value produces `[]`.
- Native Instagram Login does not synthesize granted permissions or token-debug scopes from `getInstagramOAuthConfig().scopes`.
- The callback combines only verifiable response data: `scope` or `permissions` returned by the short-lived or long-lived token response, Facebook Login `/me/permissions` entries whose status is `granted`, and scopes actually returned by Facebook token debug.
- An invalid token-debug response is not used as scope evidence.
- If no verifiable source reports a permission, the account is saved with `scopes: []`.
- Rebinding overwrites the account's scopes with the evidence from that binding. A binding that does not verify the relevant comment permission cannot leave the account marked comment-ready.
- A normal token refresh is not new user consent. The refresh route preserves the account's existing verified scopes and does not add configured/requested scopes.

Capability reporting and server-side API enforcement now use the same auth-mode-specific requirement and matching function. Instagram uses all-of matching: every scope in the selected mode's requirement must be present. A lone comment-management scope is insufficient, and scopes from the other auth mode never make the account ready. YouTube and Facebook retain their existing per-operation behavior.

Existing accounts whose scopes may have been populated from requested configuration before this fix must be treated as unverified and reconnected before Instagram comment testing.

## 4. Published media ID mapping

`instagram_publish_task_items.instagram_video_id` has state-dependent meaning:

- During `processing`, the processor can persist the creation/container ID so a later worker can resume polling and publishing.
- For `container_created`, `instagram_video_id` is the container ID, `instagram_watch_url` is null, and `published_at` is null.
- `publishInstagramMediaContainer` calls `/{ig_user_id}/media_publish`; its returned `id` is treated as the final media ID.
- The processor sets `status = 'published'`, replaces `instagram_video_id` with that final media ID, stores the resolved permalink in `instagram_watch_url`, and sets `published_at` only after media publication succeeds.

The comment module must never use a processing/container ID. The existing ownership lookup already enforces the required boundary:

- The selected Instagram account must belong to the current user.
- The task item must match that account.
- The parent publish task must belong to the current user.
- The task item must have `status = 'published'`.
- `instagram_video_id` must be non-null and non-empty.

As a result, the current comment-content lookup accepts only the final published media ID. No service or publishing change is needed in this phase.

## 5. Current comment API implementation

The provider currently uses:

- `GET /{media_id}/comments` to read comments.
- `POST /{comment_id}/replies` to create a manual public reply.

Host selection follows the global auth mode: `graph.facebook.com` for Facebook Login and `graph.instagram.com` for native Instagram Login.

Current limitations:

- Comment reads request only the first page (`limit=50`) and do not follow the top-level paging cursor.
- Embedded replies are read only from the first response; nested reply paging can be truncated.
- The implementation records truncation metadata but does not fetch subsequent pages.
- No live Meta API read or reply has been performed for this audit.

## 6. Webhook status

The existing Instagram webhook route:

- Handles the verification challenge.
- Validates `X-Hub-Signature-256` against the configured app secret.
- Parses the payload and logs only the object type and entry count.
- Returns an acknowledgement.

It does not parse comment events into domain records and does not persist them to `social_comments`. Webhook-driven comment synchronization is out of scope for this phase.

## 7. App Review and authorization risks

- Comment permissions may require Meta App Review and Advanced Access when the app serves professional accounts it does not own or manage.
- Adding a permission to the configured authorization URL does not grant it to existing tokens.
- Existing accounts must explicitly reconnect and consent before the new comment permission can appear in verifiable granted-scope evidence.
- Native Instagram Login and Facebook Login use different permission names, token shapes, and API hosts.
- Because auth mode is not stored per account, changing `INSTAGRAM_AUTH_MODE` requires an account inventory and likely reconnection of old accounts.
- The deployment must use one global auth mode. The API host must not be inferred from an account's stored scopes.

## 8. Real API test prerequisites

Before any 3B live verification:

- Use a non-production test environment and Meta app.
- Keep the production/test social-comments allowlist unchanged until the explicit Instagram rollout step.
- Use an Instagram professional account (Business or Creator) bound through the environment's current native Instagram Login mode.
- Reconnect the test account after this scope-truth fix.
- Confirm `instagram_accounts.scopes` contains both `instagram_business_basic` and `instagram_business_manage_comments` from verifiable sources.
- Confirm the stored token type and selected API host match the account's auth mode.
- Use a task item published by this application with `status = 'published'`, a non-empty final `instagram_video_id`, a permalink, and at least one real comment.
- Confirm the media allows comments and the Meta app/tester relationship is valid.
- Capture HTTP status, Meta error code/subcode, rate-limit headers, and action-log metadata without recording tokens.

## 9. Admission criteria for Phase 3B

Static admission criteria:

- Missing OAuth scope evidence no longer falls back to requested configuration.
- Native mode no longer fabricates granted permissions or debug scopes.
- Callback persistence uses only verifiable granted-scope sources.
- Token refresh cannot upgrade scopes.
- Instagram comment requirements are selected by the same exported `getInstagramAuthMode()` helper used for the comment API host.
- Both account capability and server-side `assertScopes` use the same auth-mode-specific requirement and all-of matcher.
- Legacy Facebook Login scopes cannot pass in native mode, and native business scopes cannot pass in Facebook Login mode.
- Missing the mode's basic scope prevents comment readiness and platform API access.
- Published task items map to final media IDs, while processing/container states remain excluded.
- Instagram remains absent from the active social-comments allowlist and navigation.

Operational admission criteria still required for 3B:

- A dedicated test account must be reconnected in native Instagram Login mode and show both verified scopes: `instagram_business_basic` and `instagram_business_manage_comments`.
- The account's token/host/auth-mode combination must be confirmed.
- A known published media ID with a real comment must be selected for an explicitly authorized live test.

Phase 3A identified an auth-mode-specific scope-validation blocker; Phase 3A.1 resolves it by sharing one all-of rule between capability reporting and server enforcement. No known static scope-validation blocker remains. Phase 3B is still blocked operationally until the native test account is reconnected and both required scopes are verifiably stored. Live Meta behavior, App Review access, and real token/media compatibility remain unverified and are the purpose of Phase 3B.

## 10. OAuth callback log containment record

- Event classification: consumed OAuth callback query exposure in local development request logging.
- Sink inventory complete: true.
- Sink types: immutable restricted Codex/tool audit only; no raw file or external sink identified.
- Access token present: false.
- Provider payload present: false.
- Exposed values limited to consumed authorization code and completed state: true.
- Deletable raw sink count: 0; deleted count: 0.
- Local runtime stopped and controllable terminal session closed: true.
- Immutable audit disposition: restricted and consumed; not copied or forwarded.
- Cleanup disposition: blocked. The dead Native OAuth redirect is the only redirect in the control, and Meta disables Save when the list is empty. The unsaved removal was canceled; no control-plane write occurred. The local Native redirect override remains aligned with the unchanged Meta value pending review.
