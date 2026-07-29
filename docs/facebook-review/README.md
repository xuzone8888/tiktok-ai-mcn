# Facebook App Review package

Last audited: 2026-07-29
Meta app: `StarGaze ls` (`1029912406155776`)  
Implementation branch: `codex/facebook-app-review`

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

Use a dedicated Meta test user or reviewer-accessible Facebook account with full control of a test Page. Do not use a production creator account in the recording.

1. Sign in to Star Gaze with the reviewer account.
2. Open `/facebook-publish/accounts`.
3. Select **Connect Facebook Page**, read the policy links, check the consent box, and continue.
4. In Meta authorization, grant all six requested Page permissions and select the test Page.
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

## Current Meta dashboard findings

- The app is published/live.
- The company has confirmed the irreversible **technology provider** designation in Meta. The Review section now exposes Testing, Verification, and App Review.
- The business portfolio `StarGaze` (`1717744712985897`) is **verified**. Meta shows an initial verification date of July 28, 2026.
- Access verification was submitted on July 29, 2026 and is **under review**. Meta states that it will review the submission within five days and contact the business if more information is required.
- The submitted access-verification answers identify Star Gaze as a SaaS platform, state that it does not manage multiple business portfolios, and use `https://toryxai.com` as the company website. The Platform Data explanation limits use to customer-authorized Facebook Page connection, publishing, Page/content display, comment reading, and manual replies, and states that Platform Data is not sold or used for unrelated advertising.
- A Website platform has been added and saved with `https://www.toryxai.com/`. This removed the “no platform” blocker from Reviewer Instructions.
- The application is still ineligible for submission because the required 1024×1024 app icon is missing. The repository's existing approved-size candidate is `public/images/toryx_logo_icon_new.png`; upload must be completed through the native file picker.
- The current App Review draft has been narrowed to the Facebook-only scope: the six Page permissions in this package plus the default `public_profile`. Five Instagram permissions and `business_management` were removed from this submission only, not from the app.
- Reviewer Instructions now request the website navigation/test steps, confirmation that Facebook Login is integrated, optional access credentials/codes, optional geographic restrictions, and optional supporting recordings/screenshots. Do not enter reviewer credentials until a dedicated account is ready and the review branch is deployed.
- Every requested Page permission requires its own usage explanation, end-to-end screen recording, applicable test API call, and acceptable-use attestation.
- The Data Handling form asks for:
  - whether any processors/service providers can access Platform Data and their legal names;
  - the legal entity responsible for Platform Data and its country;
  - whether Platform Data was disclosed for national-security requests in the preceding 12 months;
  - which government-request review, challenge, minimization, and logging procedures actually exist.
  These answers must be factually confirmed before they are entered.
- Both “all calls” and “app role calls” are set to Graph API `v25.0`; the implementation has been aligned to that version.
- All six required Page permissions are present and currently marked **Ready for testing**.
- Meta's Page use-case test is currently marked **Testing completed**. Meta notes that test activity can take up to 24 hours to appear and remains valid for 30 days, so rerun the final reviewer path shortly before submission.
- The Page webhook callback is already configured, its verification token is stored, `feed` is subscribed, and the field version is `v25.0`. Meta opens the Webhook screen on the **User** object by default, which can make the configured Page subscription look empty until **Page** is selected.
- The live webhook URL reaches the application handler and rejects an unsigned verification request with `403`, confirming the route exists.
- User Data Deletion currently points to the privacy-policy instructions page rather than a callback.
- The advanced deauthorization callback is empty.
- The newly implemented production data-deletion and deauthorization routes are not deployed yet; both currently return `404` on `www.toryxai.com`.

## Pre-submission gate

- [ ] Migration applied and production schema checked
- [ ] Webhook deployed, Page object selected, endpoint verified, and `feed` subscribed
- [ ] Production feature flag enabled
- [ ] Deauthorization and data-deletion callbacks configured and tested
- [ ] Existing test Page reconnected/refreshed
- [ ] Six permissions confirmed in Business Login configuration
- [x] Complete business verification with the exact registered address/postal code and accepted proof document
- [ ] Access verification submitted; wait for Meta approval or a request for additional information
- [ ] Upload the required 1024×1024 Meta app icon
- [ ] Reviewer test credentials and Page role prepared
- [ ] Confirm all Data Handling answers with the company, including processors and government-request history/procedures
- [ ] One continuous end-to-end recording plus permission-specific clips prepared
- [ ] English permission explanations pasted from this package and adjusted only if product behavior changes
- [ ] No secrets, personal accounts, unrelated customer data, browser password managers, or admin consoles appear in recordings
- [ ] Final submission reviewed by a second person before pressing Submit
