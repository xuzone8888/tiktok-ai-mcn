# Facebook comment author profile readiness

## Verified on 2026-09-16

- Business Asset User Profile Access was added to the existing App Review draft. Meta also associates it with the Instagram use case; the owner explicitly approved that dashboard-only effect. No Instagram implementation is changed here.
- Adding the feature is not approval. Its allowed-usage description, screencast and compliance confirmation remain incomplete; the review was not submitted.
- Before adding the feature, read-only requests with a newly bound Page token returned the recorded `good` comment successfully on both v20 and v25, but omitted `from`. The stored comment also had no author ID/name. This establishes missing identity in the provider response, not a frontend rendering failure. The underlying access restriction has not been conclusively isolated.
- The running international broker has `FACEBOOK_API_VERSION=v20.0`; its built comment code uses the environment value ahead of the v25 default. This has NOT been changed. It requires a separately approved release/configuration update.

## Implementation

- Request `from{id,name,picture{url,is_silhouette}}` for Facebook comments and replies, with no additional per-comment request.
- Preserve returned name and HTTPS picture URL. Do not construct Graph image URLs containing access tokens. Reject credential-bearing/token-bearing image URLs and silhouettes.
- Missing profile data remains nullable. If expanded fields fail with Graph field/permission codes 10, 100 or 200, retry the existing comment fields once per sync. All later comment and reply pages in that sync reuse the downgrade; a new sync retries profile access. The state is never shared across concurrent syncs/accounts. Expired tokens, rate limits and server failures are not treated as profile-access failures.
- The same mapping runs in the international broker. Deploying only the main application will NOT activate this change on a broker-enabled installation.
- No database migration, OAuth scope change, or change to other platforms is included.

## Before release and new screencast

1. Review and merge the isolated Facebook PR only after owner approval; do not push or deploy automatically.
2. Coordinate main application and international broker versions. Verify the broker's effective Facebook version is v25 after the approved rollout; leave Instagram's version independent.
3. Use an authorized test Page/user to read a real comment with the expanded fields. Record only presence/absence of identity fields, never tokens. Test replies and missing-profile fallback as well.
4. Confirm displayed name/avatar correspond to the real author. CDN images can expire; resync refreshes their returned URL. Do not assume approval immediately resolves every missing profile.
5. If ordinary-user identity remains unavailable, inspect feature access and eligible app-role testing in Meta. Do not fabricate identity or edit screenshots to imply access.
6. Only after implementing and testing the visible behavior, record the feature screencast: user posts a comment on the authorized Page, administrator opens Comment Management, and the same comment with available author name/avatar is displayed.

## Proposed review description (not submitted; use only after verification)

Star Gaze uses Business Asset User Profile Access to display the name and profile picture of people who comment on Facebook Pages connected by an authorized Page administrator. These details appear beside the corresponding comment in Comment Management so the administrator can distinguish participants and respond to the correct conversation. Access is limited to the connected Page workflow; the application does not use this feature to browse arbitrary user profiles. When Meta does not return a profile field, the comment remains available with a neutral placeholder.

Official reference: https://developers.facebook.com/docs/features-reference/business-asset-user-profile-access/
