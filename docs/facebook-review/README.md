# Facebook App Review package

Last audited: 2026-08-08
Meta app: `StarGaze ls` (`1029912406155776`)  
Implementation branch: `codex/facebook-review-readiness-v25`

## Submission scope

Request Advanced Access only for the permissions exercised by the visible Facebook Page workflow:

| Permission | User-visible feature | Review demonstration |
| --- | --- | --- |
| `pages_show_list` | Connect and select a Page managed by the reviewer | Start from Facebook Account Management, complete authorization, and show the selected Page in Star Gaze |
| `pages_manage_metadata` | Subscribe the connected Page to `feed` webhooks for comment updates | Connect the Page, then add a Facebook comment and show it arriving in Facebook Comments without a manual full sync |
| `pages_read_engagement` | Read Page identity, profile image, aggregate Page information, Page posts/videos, and engagement data | Show the connected Page card and open the Page's published-content/comment workspace |
| `pages_read_user_content` | Read comments created by people on Page content | Add a comment from a separate Facebook account and show it in the Star Gaze comment list |
| `pages_manage_posts` | Publish a user-selected video to a selected Page | Select a Page and video, review title/description and public status, submit, then open the returned Facebook watch URL |
| `pages_manage_engagement` | Submit a reply explicitly written and confirmed by the user | Select a synced comment, type a reply, submit it, and show the reply on Facebook |

Do not request `business_management` for this Facebook Page workflow. It is not in `FACEBOOK_PAGE_SCOPES`. Before removing it from the Meta app, confirm whether the separate Instagram use case still depends on it.

## Reviewer path

Use a dedicated Star Gaze reviewer login and non-sensitive test Pages for the submitted recordings. Meta reviewers use their own Meta test accounts, so do not provide a personal Facebook password. The reviewer instructions must explain how to sign in to Star Gaze and reach the Facebook workflow without geographic, payment, invitation, or allowlist blockers.

1. Sign in to Star Gaze with the reviewer account.
2. Open `/facebook-publish/accounts`.
3. Select **Connect Facebook Page**, read the policy links, check the consent box, and continue.
4. In Meta authorization, grant all six requested Page permissions and select the test Pages. For the `pages_show_list` clip, use an account that manages at least two Pages so the Page list is visible.
5. Confirm that the Page card appears and has no “comment permissions missing” warning.
6. Open `/facebook-publish`, choose the Page and a non-sensitive test video, enter the final title and description, keep the visible public status, and publish.
7. Open the returned Facebook URL and confirm the video is present.
8. From a different Facebook account, add a comment to the test video.
9. Open `/facebook-publish/comments`, select the Page/content, synchronize if needed, and show the inbound comment.
10. Type and explicitly submit a reply. Return to Facebook and show the reply.
11. Open Facebook Account Management and show both controls:
    - disconnect one Page, which removes only that Page's webhook subscription and local data;
    - delete all Facebook data, which removes all local Facebook bindings/data and attempts app-level token revocation.

Record the actual cursor/tap that triggers every write. Do not describe automatic posting or automatic replies: the product requires an explicit user action.

## Permission explanations for Meta

### `pages_show_list`

Star Gaze uses this permission only after the user chooses to connect Facebook. It retrieves the Pages the authenticated person manages so the person can select and bind a Page for publishing and comment management. The Page selection and connected Page are visible in Facebook Account Management.

### `pages_manage_metadata`

Star Gaze uses this permission to subscribe a Page selected by the user to the Page `feed` webhook. The subscription is created during a successful Page connection (or refresh) and removed when that Page is disconnected. Webhook deliveries are signature-verified and are mapped only to content previously published for the same Star Gaze user and Page.

### `pages_read_engagement`

Star Gaze uses this permission to display the connected Page's identity and aggregate information, locate Page-published content, and retrieve engagement/comment data required by the visible publishing and comment-management workspace.

### `pages_read_user_content`

Star Gaze uses this permission to retrieve user-generated comments on content belonging to the connected Page. Comments are displayed only to the Star Gaze user who owns the matching Page binding. The data is used for comment management and is not sold or used for unrelated advertising or general-purpose AI training.

### `pages_manage_posts`

Star Gaze uses this permission to publish a video selected by the user to a Page selected by the user. Before submission, the user reviews the media, title, description, Page, public status, and timing. Star Gaze does not publish without the user's explicit submission.

### `pages_manage_engagement`

Star Gaze uses this permission only when the user explicitly writes or confirms a reply to a visible Page comment. The target comment and final reply text are displayed before submission. Star Gaze does not generate or submit automatic Facebook replies in this workflow.

## Recording package and order

Record at 1080p or higher with the browser URL and mouse pointer visible. Use the same dedicated Star Gaze reviewer login, test Pages, test video, and secondary commenter throughout. Keep each permission clip focused on one permission, but also retain one uninterrupted end-to-end recording so the reviewer can see that every API action comes from a visible user action.

| Order | Clip | Required evidence |
| --- | --- | --- |
| 1 | Reviewer access | Sign in with the dedicated Star Gaze credentials, open Facebook Account Management, and show that no payment, invitation, or geographic gate blocks the workflow. Do not show the password while typing. |
| 2 | `pages_show_list` | Select **Connect Facebook Page**, complete Meta authorization with an account managing at least two test Pages, and show the returned Page choices and selected Page card. |
| 3 | `pages_manage_metadata` | Complete the Page connection, then show that a new Facebook comment arrives through the Page `feed` webhook. Keep a screenshot from Meta's Page webhook screen showing the verified callback and `feed` subscription as supporting evidence. |
| 4 | `pages_read_engagement` | Show the connected Page identity and open the selected Page's published-content/comment workspace. |
| 5 | `pages_read_user_content` | From the secondary Facebook account, create a uniquely worded comment on the test video; return to Star Gaze and show that exact comment and author in the comment list. |
| 6 | `pages_manage_posts` | Select the test Page and video, enter the final title/description, show the public status, click publish once, wait for success, and open the returned Facebook URL. |
| 7 | `pages_manage_engagement` | Select the uniquely worded comment, type a unique reply, click submit once, and show the same reply beneath the comment on Facebook. |
| 8 | Data controls | Disconnect one Page and show its local removal; then use **Delete all Facebook data** with a disposable binding and show the confirmation/status flow. |

For the App Review “test API call” evidence, match the visible clips to these v25 calls without exposing access tokens: `GET /me/accounts`, `POST /{page-id}/subscribed_apps` with `subscribed_fields=feed`, Page identity/content reads, `GET /{object-id}/comments`, `POST /{page-id}/videos`, and `POST /{comment-id}/comments`. Redact authorization headers and query-string tokens in screenshots or logs.

## Reviewer instruction template

Provide Meta with the dedicated Star Gaze login URL, username, password, and any one-time-code procedure in the secure reviewer credential fields. The written steps should use the numbered Reviewer path above and identify the exact two test Page names and test video. State that the reviewer should authorize with their own Meta reviewer account, not with a Facebook credential supplied by Star Gaze. Confirm shortly before submission that the Star Gaze login is active, has no MFA dependency on an unavailable employee, and can reach all three routes: `/facebook-publish/accounts`, `/facebook-publish`, and `/facebook-publish/comments`.

## Data Handling answer worksheet

Use only answers confirmed by the legal/business owner. The product and code audit support the following statements; bracketed company facts must be completed before submission.

- Platform Data purpose: customer-authorized Facebook Page connection, Page/content display, user-initiated video publishing, comment retrieval, webhook-driven comment updates, and user-initiated replies.
- Sale/advertising/training: Platform Data is not sold, is not used for unrelated advertising, and is not used for general-purpose AI model training.
- Access control and retention: Facebook data is associated with the authenticated Star Gaze user and selected Page; disconnect and delete controls remove the applicable local Facebook bindings/data, and Meta deauthorization/data-deletion callbacks are implemented.
- Service providers/processors with potential Platform Data access: `[confirm every provider's legal name and purpose, including hosting, database, logging/monitoring, and support vendors; enter “None” only if factually true]`.
- Entity responsible for Platform Data: `[confirmed legal entity name]`, organized in `[country]`.
- National-security disclosures during the preceding 12 months: `[Yes/No — legal confirmation required]`.
- Government-request procedures: select only controls that actually exist and can be evidenced: `[legal review]`, `[challenge invalid requests]`, `[data minimization]`, `[request logging]`, `[other documented procedure]`. Do not select all options by default.
- Contact: `[privacy/legal contact name or role and monitored email]`.

Before pasting these answers, compare them with the current privacy policy, Terms, vendor contracts, retention behavior, and the company's actual government-request history. Any mismatch must be resolved in the company records or product behavior before submission, not explained away in the review form.

## Backend configuration sequence

Complete these in order after the branch is deployed:

1. Apply `supabase/migrations/20260728_facebook_review_compliance.sql`.
2. Confirm `facebook-comments-webhook` remains deployed with JWT verification disabled at the Supabase gateway (an unsigned verification request currently reaches the handler and returns its own `403`, rather than a gateway `401` or a `404`).
3. Set a strong server-only `FACEBOOK_WEBHOOK_VERIFY_TOKEN`; keep it out of source control and recordings.
4. Reconfirm the existing Meta **Page** webhook product (not the default User product):
   - callback: `<NEXT_PUBLIC_SUPABASE_URL>/functions/v1/facebook-comments-webhook`
   - verification token: the value from step 3
   - API version: `v25.0`
   - subscribed field: `feed` (currently subscribed)
5. Set `FACEBOOK_PAGE_WEBHOOK_ENABLED=true` only after Meta verifies the endpoint.
6. Deploy the Next.js application and confirm these public endpoints return the expected non-success response to an unsigned request rather than a 404:
   - `/api/facebook/deauthorize`
   - `/api/facebook/data-deletion`
   - `/facebook-data-deletion`
7. In Meta App Settings:
   - set the deauthorization callback to `https://www.toryxai.com/api/facebook/deauthorize`;
   - change User Data Deletion from an instruction URL to the callback `https://www.toryxai.com/api/facebook/data-deletion`;
   - keep Privacy Policy `https://www.toryxai.com/privacy`;
   - keep Terms `https://www.toryxai.com/terms`.
8. Reconnect or refresh every existing review/test Page once so `authorized_by_facebook_user_id` is populated and the Page webhook is subscribed.
9. Verify the Business Login configuration includes exactly the six Page permissions in the submission scope.
10. Run the full reviewer path with the test Page and retain screenshots of successful webhook verification, publish, comment sync, reply, disconnect, and deletion status.

## Current verified status

- The app is published/live.
- The company has confirmed the irreversible **technology provider** designation in Meta. The Review section exposes Testing, Verification, and App Review.
- The business portfolio `StarGaze` (`1717744712985897`) is verified.
- Access verification has passed.
- The submitted access-verification answers identify Star Gaze as a SaaS platform, state that it does not manage multiple business portfolios, and use `https://toryxai.com` as the company website. The Platform Data explanation limits use to customer-authorized Facebook Page connection, publishing, Page/content display, comment reading, and manual replies, and states that Platform Data is not sold or used for unrelated advertising.
- A Website platform has been added and saved with `https://www.toryxai.com/`. This removed the “no platform” blocker from Reviewer Instructions.
- The repository icon `public/images/toryx_logo_icon_new.png` was verified as a 1024×1024 RGBA PNG, uploaded to Meta Basic Settings, saved, and rechecked on 2026-08-08. After reload, the missing-icon submission blocker was no longer displayed.
- The current App Review draft has been narrowed to the Facebook-only scope: the six Page permissions in this package plus the default `public_profile`. Five Instagram permissions and `business_management` were removed from this submission only, not from the app.
- Reviewer Instructions now request the website navigation/test steps, confirmation that Facebook Login is integrated, optional access credentials/codes, optional geographic restrictions, and optional supporting recordings/screenshots. Do not enter reviewer credentials until a dedicated account is ready and the review branch is deployed.
- Every requested Page permission requires its own usage explanation, end-to-end screen recording, applicable test API call, and acceptable-use attestation. These final permission-specific clips and descriptions are not yet uploaded.
- The Data Handling form asks for:
  - whether any processors/service providers can access Platform Data and their legal names;
  - the legal entity responsible for Platform Data and its country;
  - whether Platform Data was disclosed for national-security requests in the preceding 12 months;
  - which government-request review, challenge, minimization, and logging procedures actually exist.
  These answers must be factually confirmed before they are entered.
- Both “all calls” and “app role calls” are set to Graph API `v25.0`. Facebook OAuth, publishing, comments, and replies now default to v25 in code when the environment variable is absent; Instagram version fallback remains independent.
- All six required Page permissions plus the default `public_profile` are present in the App Review draft.
- Meta's Facebook Page use-case test and API test calls have been completed. Test activity can take time to appear and remains time-limited, so rerun the final reviewer path shortly before submission.
- The Page webhook callback is already configured, its verification token is stored, `feed` is subscribed, and the field version is `v25.0`. Meta opens the Webhook screen on the **User** object by default, which can make the configured Page subscription look empty until **Page** is selected.
- The Page object was rechecked on 2026-08-08: its callback is `https://wjfgusdwudsynbsyveoe.supabase.co/functions/v1/facebook-comments-webhook`, matching the local Supabase project URL; an invalid verification request returns handler-level `403`. The `feed` row is checked as subscribed at `v25.0`.
- The live webhook URL reaches the application handler and rejects an unsigned verification request with `403`, confirming the route exists.
- The production privacy, terms, and Facebook data-deletion status pages return `200`.
- The production deauthorization and data-deletion routes are deployed and reject malformed requests as expected.
- The final Meta callback values must be:
  - deauthorization: `https://www.toryxai.com/api/facebook/deauthorize`
  - data deletion: `https://www.toryxai.com/api/facebook/data-deletion`
- The remaining production uncertainty is configuration, not route availability: confirm the deployed runtime has `FACEBOOK_PAGE_WEBHOOK_ENABLED=true` and that a newly connected reviewer Page is subscribed through `/{page-id}/subscribed_apps`.
- Meta Basic Settings now uses **Data Deletion Callback URL** with `https://www.toryxai.com/api/facebook/data-deletion`; the value was saved and persisted after reload on 2026-08-08.
- Meta Advanced Settings shows both **all calls** and **app role calls** at `v25.0`.
- All six Page permission cards and `public_profile` are present in **Reasonable Use**, but each still shows **Start**: the usage description, permission-specific recording, API-test evidence where requested, and acceptable-use attestation have not been completed in the form.
- The Data Handling form and Reviewer Instructions fields are still blank. The reviewer website is `https://www.toryxai.com/`; a dedicated Star Gaze reviewer login must be prepared before those fields are completed.
- The production Facebook Comment Management page is visible and enabled. The browser account used for this audit currently has no connected Facebook Page, so a v25 Page binding/publish/comment/reply retest cannot begin until this branch is deployed and a review Page is connected.
- A separate legacy development `.env.local` outside this worktree still explicitly sets `FACEBOOK_API_VERSION=v20.0` and does not define `FACEBOOK_PAGE_WEBHOOK_ENABLED`. It is not proof of the deployed environment, but it must not be reused for the v25 retest without correction.

## Pre-submission gate

- [x] Migration tables/fields present in production
- [x] Webhook endpoint deployed, Page object selected, callback verified, and app-level `feed` subscribed
- [ ] Confirm production `FACEBOOK_PAGE_WEBHOOK_ENABLED=true`
- [ ] Confirm `NEXT_PUBLIC_FACEBOOK_COMMENTS_ENABLED=true`, `SOCIAL_COMMENTS_API_ENABLED=true`, and `SOCIAL_COMMENTS_ENABLED_PLATFORMS` contains `facebook`
- [ ] Confirm the deauthorization URL in Meta matches the production callback above
- [x] User Data Deletion uses callback mode with `https://www.toryxai.com/api/facebook/data-deletion`
- [ ] Locate and confirm the Meta deauthorization callback is `https://www.toryxai.com/api/facebook/deauthorize`
- [ ] Existing test Page reconnected/refreshed
- [x] Six permissions confirmed in Business Login configuration `1793063098329073`
- [x] Complete business verification with the exact registered address/postal code and accepted proof document
- [x] Access verification passed
- [x] Upload and save the required 1024×1024 Meta app icon
- [ ] Reviewer test credentials and Page role prepared
- [ ] Confirm all Data Handling answers with the company, including processors and government-request history/procedures
- [ ] One continuous end-to-end recording plus permission-specific clips prepared
- [ ] English permission explanations pasted from this package and adjusted only if product behavior changes
- [ ] No secrets, personal accounts, unrelated customer data, browser password managers, or admin consoles appear in recordings
- [ ] Final submission reviewed by a second person before pressing Submit
