# Facebook App Review submission worksheet

Last audited: 2026-08-10
Meta app: `StarGaze ls` (`1029912406155776`)
Facebook implementation branch: `codex/facebook-app-review-v25-20260808`

This worksheet is intentionally Facebook-only. Do not add another platform's permissions, recordings, credentials, or product behavior to this submission.

## Submission identity

- Website: `https://www.toryxai.com/`
- Star Gaze reviewer username: `Develop@toryxai.com`
- Star Gaze reviewer password: enter only in Meta's secure reviewer credential field; do not store it in this repository
- Star Gaze reviewer MFA: none; username and password are sufficient — revalidate immediately before submission
- Privacy Policy: `https://toryxai.com/privacy` (canonical URL successfully validated by Meta)
- Terms of Service: `https://www.toryxai.com/terms`
- User Data Deletion callback: `https://www.toryxai.com/api/facebook/data-deletion`
- Intended Deauthorization callback: `https://www.toryxai.com/api/facebook/deauthorize`
- Facebook Account Management: `https://www.toryxai.com/facebook-publish/accounts`
- Facebook Publishing: `https://www.toryxai.com/facebook-publish`
- Facebook Comment Management: `https://www.toryxai.com/facebook-publish/comments`
- Business Login configuration ID: `1793063098329073`
- Graph API version: `v25.0`
- Recording/reference Facebook Page: `Irene's Zone`
- Deletion demonstration: the Star Gaze binding for `Irene's Zone` is approved for deletion; this deletes the local binding/data, not the Facebook Page or Facebook-hosted content

Meta's current [Data Deletion Callback documentation](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback) requires a POST `signed_request` and a JSON response containing a status URL and confirmation code. Star Gaze's callback route is designed for that contract. Recheck the deployed response after the reviewed branch is released.

The Deauthorization Callback URL is confirmed and saved in Meta Business Login Settings as `https://www.toryxai.com/api/facebook/deauthorize`.

## What “test Page name” means

The test Page is the Facebook Page used in the submitted recording and the pre-submission smoke test to demonstrate the reviewed product flow. Its name is the exact public-facing Page name shown in Facebook and in the Star Gaze Page selector. It is not `Develop@toryxai.com`, the Meta App name `StarGaze ls`, a Page ID, a Business Portfolio, or the Business Login configuration ID. During an interactive review, the Meta reviewer may instead select a Page managed by the reviewer's own Meta account; Star Gaze must not supply a personal Facebook password.

Use one primary review Page that meets all of these conditions:

- It is a real Facebook Page controlled by the person preparing the submission.
- The preparer has full control and can authorize all six requested Page permissions.
- It is safe to publish a non-sensitive public test video on it.
- A second Facebook account can add a uniquely worded comment to the published video.
- The Page can remain available and unchanged throughout the review window.
- It contains no unrelated customer data or personal content in the recording.

The primary Page is sufficient for publishing, comments, replies, and deletion. Separately prepare a second real, non-sensitive Page managed by the same Meta account for the `pages_show_list` screencast, because Meta's current permission reference asks that recording to show multiple managed Pages successfully bound.

## Reviewer Instructions — paste-ready English copy

Replace every bracketed value before submission. Put credentials only in Meta's secure reviewer credential fields, never in a recording or ordinary description.

> Star Gaze is a SaaS product that lets an authenticated customer connect a Facebook Page they manage, publish a user-selected video to that Page, read comments on the Page's content, and send replies that the customer explicitly writes and submits.
>
> 1. Open https://www.toryxai.com/ and sign in as Develop@toryxai.com using the password supplied in Meta's secure reviewer credential field.
> 2. Open Facebook Account Management at https://www.toryxai.com/facebook-publish/accounts.
> 3. Click “Connect Facebook Page,” review the policy links, select the consent checkbox, and continue to Meta authorization.
> 4. Sign in with your own Meta reviewer account, grant all requested Facebook Page permissions, and select a Page managed by that account.
> 5. Return to Star Gaze and confirm that the selected Page appears as a connected Page without a missing-comment-permission warning.
> 6. Open https://www.toryxai.com/facebook-publish, select the connected Page and a non-sensitive test video, review the title, description, Page, public status, and timing, then click Publish once.
> 7. Wait for the success result and open the returned Facebook URL to confirm that the video is present.
> 8. From a different Facebook account, add a uniquely worded comment to that test video.
> 9. Open https://www.toryxai.com/facebook-publish/comments, select the connected Page and content, synchronize if necessary, and confirm that the exact comment and author appear.
> 10. Type a unique reply, click the reply submission control once, and confirm the same reply beneath the comment on Facebook.
> 11. Return to Facebook Account Management to inspect the disconnect and Delete All Facebook Data controls. Use only the disposable test binding identified below if exercising deletion.
>
> Recording/reference Page: Irene's Zone
>
> Second recording/reference Page for pages_show_list: [REPLACE WITH EXACT PUBLIC PAGE NAME]
>
> During interactive review, you may select any Facebook Page managed by your Meta reviewer account.
>
> Test video file: facebook-review-irene-zone-v25.mp4
>
> Test video Facebook title: Star Gaze Facebook API Review Test - Irene's Zone - v25
>
> Disposable binding approved for deletion: Irene's Zone
>
> No payment, invitation, customer allowlist, or geographic restriction is required for the supplied Star Gaze reviewer account. [Replace this sentence if that statement is not factually true.]

## Permission form copy and evidence mapping

Use one permission-specific clip per card. A clip may show adjacent steps needed to reach the feature, but the requested permission's visible product value must be unmistakable.

### `pages_show_list`

**Why Star Gaze requests this permission**

> Star Gaze uses pages_show_list only after the user chooses to connect Facebook. It retrieves the Facebook Pages managed by the authenticated person so that person can select and bind a Page for publishing and comment management. The Page choices and the final connected Page are visible in Facebook Account Management.

**Reviewer steps**

> Sign in to the supplied Star Gaze reviewer account, open Facebook Account Management, click Connect Facebook Page, and complete Meta authorization with a Meta account that manages at least two real test Pages. Show the multiple Pages returned/bound in Star Gaze, then select the primary Page for the remainder of the workflow.

**Evidence file:** `01-pages_show_list-connect-and-select.mp4`

### `pages_manage_metadata`

**Why Star Gaze requests this permission**

> Star Gaze uses pages_manage_metadata to subscribe a Page selected by the user to the Page feed webhook. The subscription is created during a successful Page connection or refresh and removed when that Page is disconnected. Webhook deliveries are signature-verified and are mapped only to content previously published for the same Star Gaze user and Page.

**Reviewer steps**

> Connect the test Page, publish or select the identified test content, and add a uniquely worded Facebook comment from a second account. Open Facebook Comment Management and show that the comment is available for the connected Page. Supporting evidence also shows the verified Page webhook callback, the feed subscription, and Graph API v25.0 without revealing the verification token.

**Evidence files:** `02-pages_manage_metadata-page-feed-webhook.mp4`, `02a-page-webhook-v25-feed.png`

### `pages_read_engagement`

**Why Star Gaze requests this permission**

> Star Gaze uses pages_read_engagement to display the connected Page's identity and aggregate information, locate Page-published content, and retrieve the engagement data required by the visible publishing and comment-management workspace.

**Reviewer steps**

> Open Facebook Account Management and show the connected Page identity. Then open Facebook Comment Management, choose that Page, and show the Page's published test content and its engagement/comment workspace.

**Evidence file:** `03-pages_read_engagement-page-and-content.mp4`

### `pages_read_user_content`

**Why Star Gaze requests this permission**

> Star Gaze uses pages_read_user_content to retrieve user-generated comments on content belonging to the connected Page. Comments are displayed only to the authenticated Star Gaze user who owns the matching Page binding. This data is used for comment management and is not sold, used for unrelated advertising, or used for general-purpose AI model training.

**Reviewer steps**

> From the secondary Facebook account, create a uniquely worded comment on the identified test video. Return to Facebook Comment Management, select the connected Page and content, synchronize if necessary, and show that exact comment and author in the comment list.

**Evidence file:** `04-pages_read_user_content-comment-read.mp4`

### `pages_manage_posts`

**Why Star Gaze requests this permission**

> Star Gaze uses pages_manage_posts to publish a video selected by the user to a Facebook Page selected by the user. Before submission, the user reviews the media, title, description, Page, public status, and timing. Star Gaze does not publish without the user's explicit submission.

**Reviewer steps**

> Open Facebook Publishing, select the connected test Page and non-sensitive test video, enter or review the final title and description, show the public status and timing, and click Publish once. Wait for success, open the returned Facebook URL, and confirm that the video is present on the selected Page.

**Evidence file:** `05-pages_manage_posts-user-initiated-publish.mp4`

### `pages_manage_engagement`

**Why Star Gaze requests this permission**

> Star Gaze uses pages_manage_engagement only when the user explicitly writes and submits a reply to a visible Facebook Page comment. The target comment and final reply text are visible before submission. Star Gaze does not automatically generate or submit Facebook replies in this workflow.

**Reviewer steps**

> Open Facebook Comment Management, select the uniquely worded inbound comment, type a unique reply, and click the reply submission control once. Return to Facebook and show the identical reply beneath the target comment.

**Evidence file:** `06-pages_manage_engagement-explicit-reply.mp4`

## Continuous recording run order

Create `00-facebook-end-to-end-reviewer-path.mp4` as one uninterrupted reference recording:

1. Show the production URL and sign in without exposing the password.
2. Open Facebook Account Management and start the visible connection action.
3. Complete Meta authorization and select the test Page.
4. Show the connected Page card and absence of missing-permission warnings.
5. Publish the prepared non-sensitive video through the visible submit action.
6. Open the returned Facebook URL.
7. Add the unique inbound comment from the secondary account.
8. Return to Facebook Comment Management and show the comment appearing through webhook delivery or an explicit synchronization action.
9. Type and explicitly submit the unique reply.
10. Show the reply on Facebook.
11. Show the disconnect and Delete All Facebook Data controls. Exercise deletion only on the pre-approved disposable binding.

Keep the URL bar and pointer visible. Record at 1080p or higher. Do not display access tokens, app secrets, webhook verification tokens, password-manager popups, personal Pages, unrelated customer data, admin consoles, or browser notifications.

## Test video specification

Prepare one original, non-sensitive video using these exact identifiers:

- Local filename: `facebook-review-irene-zone-v25.mp4`
- Facebook title: `Star Gaze Facebook API Review Test - Irene's Zone - v25`
- Facebook description: `Test video published through Star Gaze during Meta App Review. This video contains no customer or personal data.`
- Container/codec: MP4, H.264 video, AAC audio if audio is present
- Resolution: 1080×1920 vertical or 1920×1080 horizontal
- Duration: 10–20 seconds
- Recommended file size: below 50 MB for a fast, reliable reviewer demonstration
- Content: simple original scenery, product-neutral animation, or other material owned by the company
- Exclude: copyrighted music, private individuals, customer information, political content, medical/financial claims, watermarks from another platform, and content requiring age or geographic restrictions

Keep the published test video available on `Irene's Zone` throughout the review window. The Star Gaze binding may be deleted during the deletion demonstration and reconnected afterward.

## API-test evidence mapping

Do not expose tokens in query strings, request headers, screenshots, or recordings.

| Permission | Representative Graph API v25 action |
| --- | --- |
| `pages_show_list` | `GET /me/accounts` |
| `pages_manage_metadata` | `POST /{page-id}/subscribed_apps` with `subscribed_fields=feed` |
| `pages_read_engagement` | Page identity and Page-owned content/engagement reads |
| `pages_read_user_content` | `GET /{object-id}/comments` |
| `pages_manage_posts` | `POST /{page-id}/videos` |
| `pages_manage_engagement` | `POST /{comment-id}/comments` |

## Data Handling — company confirmation required

Do not guess these answers or select every control by default. The legal/business owner must provide written confirmation for each bracketed value.

- Legal entity responsible for Platform Data: `Wuhan Guanxing Cultural Media Co., Ltd.（武汉观星文化传媒有限公司）` — candidate supported by the published Terms; company/legal owner must confirm this is the entity responsible for Meta Platform Data
- Country of organization: `China` — candidate inferred from the published entity; company/legal owner must confirm the jurisdiction expected by Meta's form
- Privacy/legal contact role: `CEO`
- Monitored privacy/legal email: `toryxai@outlook.com` — published policy contact; confirm that it is actively monitored for privacy/legal requests
- Processors or service providers that can access Platform Data — submission answer:
  - Alibaba Cloud/Aliyun **exact contracting legal entity from the current invoice or contract**: hosts the public Star Gaze web application and API in China. It processes Facebook authentication callbacks, Page/account identifiers, authorized API requests, and operational server logs required for the Facebook Page publishing and comment-management features. Do not guess the contracting entity from the IP registration alone.
  - `netcup GmbH`: hosts the restricted United States OAuth/API broker used by the mainland production server to communicate with Meta Graph API. When the production broker is enabled, it processes access tokens and transient Facebook Page/comment request and response data and does not use that data for an independent purpose. Confirm `OAUTH_BROKER_URL` is enabled in the active production process before submission; repository and deployment evidence strongly indicate that it is.
  - `Supabase, Inc.`: provides database, authentication, storage, backend APIs, Edge Functions, native logs, and managed backups. Current evidence places the primary production project in AWS `us-east-2` (Ohio) and the separate project hosting the Facebook webhook in AWS `us-east-1` (Northern Virginia); Edge Function execution can occur at a nearby edge region. Verify the two-project data path before submission.
  - `Microsoft Corporation`: hosts the Outlook support mailbox. The company confirmed that the mailbox can receive Facebook Platform Data in support, privacy, or deletion requests. If the mailbox's actual contract identifies a different Microsoft legal entity, use that exact entity instead.
  - Any additional production logging, backup, monitoring, or support vendor: list only if cloud-console or contract evidence confirms that the vendor can access Meta Platform Data. No separate Sentry, Datadog, PostHog, New Relic, or similar monitoring processor was identified in the repository.
- Internal verification evidence — do not paste into Meta unless specifically requested:
  - `www.toryxai.com` responds through `nginx/1.24.0 (Ubuntu)` and the public IP is allocated by APNIC to `ALISOFT`/`Aliyun Computing Co., LTD`.
  - All checked Toryx public hostnames resolve to the Alibaba Cloud production server; none resolve to the United States broker. The broker is nevertheless a processor when the application sends Meta tokens or data to it.
  - Application/PM2 and web-server logs are stored on the Alibaba Cloud host; broker container logs are stored on the netcup host; Supabase supplies native logs and managed database backups. No independent external monitoring vendor is evidenced by the repository.
  - DNS service, Nginx software, an IP address, and vendors that cannot access Meta Platform Data are not separate processors for this answer.
  - AWS and Cloudflare are listed by Supabase as subprocessors. List the direct provider `Supabase, Inc.` in Meta's normal service-provider question; separately enumerate nested subprocessors only if the form explicitly requests them.
- Platform Data disclosed for national-security requests during the preceding 12 months: **No** — confirmed by the company on 2026-08-09
- Government-request procedures actually implemented as of 2026-08-09:
  - Legal review: **No**
  - Challenge invalid requests: **No**
  - Data minimization: **No**
  - Request logging: **No**
  - Other documented procedure: **None**

### National-security request question — plain-language confirmation

Meta is asking whether, during the preceding 12 months, the company received a request from a government or public authority seeking users' personal information for a national-security purpose and actually provided any personal information in response. It is not asking whether the company is located in China, whether the servers are on Alibaba Cloud, or whether the company generally follows applicable law.

The CEO/business owner confirmed the answer to this question on 2026-08-09:

> During the last 12 months, did Wuhan Guanxing Cultural Media Co., Ltd. provide any user's personal data or personal information to a government or public authority in response to a national-security request?

No such disclosure occurred during the preceding 12 months, so select **No**. Do not infer or change the company's answer based on a cloud provider's separate disclosure history.

The procedure questions ask whether the company itself has a real process for requests directed to the company. The company confirmed that it currently has no such process. Select **No** for each procedure/control and **None** for other documented procedures. A truthful negative answer is complete; do not represent a newly written suggestion as an implemented control.

For future governance, the company may separately choose to adopt the following draft. It is not an answer for the current submission unless it is formally adopted, communicated, and followed:

1. Route every government request to the CEO or designated legal owner.
2. Verify the requesting authority, jurisdiction, legal basis, signature, and scope.
3. Reject or challenge invalid, unauthorized, or overbroad requests where legally permitted.
4. Disclose only the minimum data legally required and preserve confidentiality/security.
5. Record the request, review decision, data categories disclosed, date, and responsible approver in a restricted register.
6. Never use Meta Platform Data to build or support surveillance tools or unrelated law-enforcement/national-security analysis.

Product/code-supported statements, subject to legal confirmation:

- Platform Data is used for customer-authorized Facebook Page connection, Page/content display, user-initiated video publishing, comment retrieval, webhook-driven comment updates, and user-initiated replies.
- Platform Data is not sold, is not used for unrelated advertising, and is not used for general-purpose AI model training.
- Facebook data is associated with the authenticated Star Gaze user and selected Page.
- Page disconnect, Delete All Facebook Data, Meta deauthorization, and Meta data-deletion callbacks have corresponding application paths.

## Remaining input register

The implementation and permission explanations are complete. Collect these facts or assets before the form is submitted:

| Item | Current state | Required action |
| --- | --- | --- |
| Star Gaze reviewer username | Confirmed: `Develop@toryxai.com` | Revalidate login shortly before submission |
| Star Gaze reviewer password / MFA | Confirmed: password login, no MFA | Put the password only in Meta's secure reviewer credential field and revalidate login before submission |
| Recording/reference Facebook Pages | Primary confirmed: `Irene's Zone`; second Page pending | Keep both Pages available throughout review and use the second Page to satisfy the `pages_show_list` multiple-Page screencast requirement |
| Secondary commenter | Not yet identified | Prepare a different Facebook account that can add a unique public comment; never provide its password to Meta |
| Test video | Specification complete | Prepare `facebook-review-irene-zone-v25.mp4` using the standard above |
| Disposable deletion binding | Confirmed: `Irene's Zone` | The Star Gaze binding may be deleted and reconnected; do not delete the Facebook Page itself |
| Permission recordings | Not yet recorded | Produce the uninterrupted walkthrough and six permission-specific clips using the filenames above |
| API-test screenshots | Partly completed in Meta | Capture only the evidence requested by each permission card; redact all tokens and unrelated data |
| Production v25 deployment | Pending | Merge/deploy through the normal process, then verify runtime version and Facebook-only feature gates |
| Production Page webhook subscription | Pending runtime proof | Reconnect/refresh the Page and confirm `/{page-id}/subscribed_apps` succeeds with `feed` |
| v25 end-to-end retest | Pending deployment | Re-run Page binding, publishing, comment read/webhook, and reply |
| Deauthorization Callback setting | Confirmed and saved on 2026-08-10 | Keep `https://www.toryxai.com/api/facebook/deauthorize` unchanged through review |
| Data Handling responsible role | Confirmed: CEO | Confirm the named person internally; Meta generally needs the role/answer, not a repository credential |
| Data Handling disclosure history | Confirmed | Select **No** for national-security disclosures during the preceding 12 months |
| Government-request procedures | Confirmed: none currently implemented | Select **No** for each listed control and **None** for other procedures; do not claim the optional draft as implemented |
| Alibaba Cloud legal entity | Pending contract check | Copy the exact legal name from the current Alibaba Cloud invoice or service agreement; do not submit only “Aliyun” or the IP registrant name |
| Production Meta broker | Strong evidence of use; runtime confirmation pending | Confirm the active production process has `OAUTH_BROKER_URL` enabled without exposing the value or credentials; if enabled, list `netcup GmbH` |
| Supabase project topology | Two projects identified; end-to-end verification pending | Confirm the Facebook webhook project writes into the same data path read by the production Facebook Comment Management UI; correct the Facebook-only wiring before review if it does not |
| Microsoft support processor | Confirmed | List `Microsoft Corporation` for the Outlook support mailbox unless the mailbox contract names another Microsoft entity |
| Additional logging/backup/monitoring vendors | No separate vendor evidenced | Check Alibaba Cloud and netcup consoles for optional snapshots, log shipping, or monitoring services and add only an actual vendor that can access Platform Data |
| v25 retest availability | Confirmed: can be run at any time | Schedule it immediately after the reviewed branch is deployed with production Facebook gates enabled |

## Final submission order

1. Deploy the reviewed Facebook branch through the normal PR-to-main process.
2. Confirm production uses Graph API v25 and enables the Facebook Page webhook and Facebook comment surfaces.
3. Reconnect or refresh the test Page and confirm `/{page-id}/subscribed_apps` succeeds.
4. Run the complete v25 smoke path: Page binding, publishing, webhook/comment read, reply.
5. Prepare the dedicated Star Gaze reviewer login, exact recording/reference Page name, test video, secondary commenter, and disposable deletion binding.
6. Record the uninterrupted path and six permission-specific clips.
7. Complete the six permission cards with the copy and evidence above.
8. Enter reviewer credentials only in Meta's secure credential fields.
9. Enter Data Handling answers only after confirming the Alibaba Cloud contract name, active broker setting, and two-project Supabase webhook data path.
10. Confirm the Deauthorization Callback in an unambiguous Meta field.
11. Have a second person review every field and recording for secrets, unrelated data, and behavior/copy mismatches.
12. Submit once all gates are green.
