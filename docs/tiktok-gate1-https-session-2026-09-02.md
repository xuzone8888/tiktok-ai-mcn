# TikTok Gate 1 HTTPS Session Evidence - 2026-09-02

> Evidence classification: sanitized local-session record.
> This file contains no OAuth state, authorization code, client secret, access token,
> refresh token, password, verification code, account ID, or user ID.

## Scope and authorization boundary

- The HTTPS preparation phase only established a one-time tunnel and isolated local build.
- After that phase passed, a separately authorized Sandbox add-only callback change was
  applied. Production, scopes, target users, and all other App fields were unchanged.
- A first OAuth attempt was aborted and safely expired. A later, separately authorized
  Web OAuth retry completed successfully using the approved HTTPS callback.
- No migration, Git stage/commit/push, Production deployment, or feature enablement occurred.

## Replacement session status

**PASS — HTTPS preparation and the separately authorized callback addition completed.**

After the original port-3011 attempt was safely stopped, a replacement session was
created on a separately verified unused loopback port. No pre-existing listener or
`cloudflared` process targeted this port before startup. During the running session,
the approved replacement tunnel is the only `cloudflared` process targeting the port.

### Replacement isolated build and runtime

- Source branch: `codex/tiktok-review-latest-main`
- Base HEAD: `30848db5462ac6345bc38c4b98f792ab373699f7`
- Build source: current uncommitted working-tree candidate copied to a private temporary directory
- Previous `.next`: excluded; the replacement session used a fresh Production build
- Node: 20.19.5
- Build result: passed with the previously recorded non-blocking warnings
- Next listener: `127.0.0.1:39117` only
- Tunnel transport: Cloudflare quick tunnel over HTTP/2
- Replacement HTTPS origin:
  `https://routers-phd-amended-ambient.trycloudflare.com`
- Exact running-process audit result: one approved `cloudflared` process targets port 39117

### Replacement effective Login Kit values

- `NEXT_PUBLIC_APP_URL`:
  `https://routers-phd-amended-ambient.trycloudflare.com`
- `TIKTOK_REDIRECT_URI`:
  `https://routers-phd-amended-ambient.trycloudflare.com/api/tiktok/auth/callback`
- Callback path: exact `/api/tiktok/auth/callback`, without a trailing slash
- Source `.env.local` was not modified; build/runtime used process-level overrides.
- TikTok video-list server/UI flags: false
- Social-comments API flag: false
- TikTok comments and general comments-center UI flags: false
- TikTok reply server/UI flags: false
- Business callback, App ID/Secret, and OAuth broker: absent

The production-readiness command passed in the same effective environment used for the
fresh build and isolated runtime.

### Replacement connectivity checks

| Check | Local | HTTPS tunnel |
| --- | ---: | ---: |
| `/auth/login` | 200 | 200 |
| `/tiktok-publish/accounts` | 200 | 200 |
| `/api/tiktok/videos` with rollout gate off | 404 | 404 |
| TLS certificate verification | n/a | passed |

During this preparation phase, no authorization page was opened, no OAuth state was
generated, and no TikTok Portal value was changed or saved. Callback synchronization
occurred only later under the separately recorded user authorization. The later OAuth
retry is documented separately below.

## Original attempt final status

**ABORTED — not eligible for callback synchronization or OAuth.**

After the initial connectivity checks, a read-only process audit found a pre-existing
Facebook review tunnel also targeting local port 3011. Even though the new Next process
listened only on loopback, the candidate build could be reached through more than one
public tunnel. This violated the single-origin isolation requirement.

The TikTok Next process and the new TikTok tunnel were stopped. The pre-existing Facebook
review tunnel was not modified or terminated. No OAuth state or provider request occurred.

## Isolated build and runtime

- Source branch: `codex/tiktok-review-latest-main`
- Base HEAD: `30848db5462ac6345bc38c4b98f792ab373699f7`
- Build source: current uncommitted working-tree candidate copied to a private temporary directory
- Previous `.next`: excluded; the session used a fresh Production build
- Node: 20.19.5
- Build result: passed with the previously recorded non-blocking warnings
- Next listener: `127.0.0.1:3011` only
- Tunnel transport: Cloudflare quick tunnel over HTTP/2
- Aborted HTTPS origin (must not be registered or reused):
  `https://deserve-border-obligation-gear.trycloudflare.com`

## Effective Login Kit values used by the aborted build

- `NEXT_PUBLIC_APP_URL`:
  `https://deserve-border-obligation-gear.trycloudflare.com`
- `TIKTOK_REDIRECT_URI`:
  `https://deserve-border-obligation-gear.trycloudflare.com/api/tiktok/auth/callback`
- Callback path: exact `/api/tiktok/auth/callback`, without a trailing slash
- Source `.env.local` was not modified; the isolated build/runtime used process-level overrides.
- Existing source `.env.local` callback remains:
  `https://shaky-donuts-appear.loca.lt/api/tiktok/auth/callback`

## Pre-change read-only Developers Sandbox callback inventory

After the aborted tunnel was stopped, the correct Chrome profile was used for a read-only
Portal inspection. The Sandbox contained exactly these Login Kit Web callbacks:

1. `https://toryxai.com/api/tiktok/auth/callback`
2. `https://www.toryxai.com/api/tiktok/auth/callback`

Production was not edited. Sandbox fields were not changed and **Apply changes** was not
clicked. The aborted quick-tunnel callback is not present in the Portal.

## Immediate global OAuth drain before the callback proposal

The replacement listener, unique tunnel process, and public origin were checked both
before and after this read-only database aggregate. They remained unchanged.

Only non-sensitive counts were selected. No state value, user/account ID, token, code,
credential, or row content was output.

| OAuth state family | Pending total | Pending unexpired | Processing total | Valid processing lease |
| --- | ---: | ---: | ---: | ---: |
| Ordinary Login Kit | 0 | 0 | 0 | 0 |
| Business account-holder | 0 | 0 | 0 | 0 |

These counts are proposal-time evidence only. They must be rerun immediately before any
approved **Apply changes** action because a later OAuth flow could invalidate the result.

## Developers Sandbox callback add-only change

Status: **applied after explicit user approval**.

Pre-change complete Sandbox list:

1. `https://toryxai.com/api/tiktok/auth/callback`
2. `https://www.toryxai.com/api/tiktok/auth/callback`

Approved and applied complete Sandbox list:

1. `https://toryxai.com/api/tiktok/auth/callback`
2. `https://www.toryxai.com/api/tiktok/auth/callback`
3. `https://routers-phd-amended-ambient.trycloudflare.com/api/tiktok/auth/callback`

Exact diff:

- retain both existing `toryxai.com` callbacks;
- add only the replacement quick-tunnel callback;
- delete nothing;
- change Sandbox only; Production remains unchanged.

Immediately before **Apply changes**, the replacement listener, unique tunnel, public
origin, and both OAuth state aggregates were rechecked. The eight aggregate values were
still zero. The form contained the exact proposed three-item list and remained on
Sandbox. Only **Apply changes** was clicked.

After saving, a browser refresh confirmed:

- Sandbox remained selected and Production remained unselected;
- the complete callback list contained the exact three entries above;
- the page reported no unsaved changes;
- `video.list` remained present;
- the Target Users table still contained its original two entries;
- no scope, target user, Production setting, or other App field was changed.

The listener and HTTPS origin remained available after saving. A final read-only database
aggregate again returned zero for all eight ordinary/Business OAuth active-state counts.
No authorization page was opened and no OAuth state or provider request was created.

Exit plan: after the separately authorized local OAuth session is complete, first confirm
no active ordinary OAuth flow remains. Then request separate approval to remove the exact
temporary quick-tunnel callback, restoring the two-item Sandbox list. The tunnel must not
be reused after it stops or its hostname changes.

## First Web OAuth attempt — ABORTED

The first user-authorized Web OAuth attempt was stopped before login, consent, or code
issuance. The controlled Chrome tab was visually showing the expected account page, but
its authoritative URL remained the old `localhost:3010` instance. That instance generated
an authorization request with the old `loca.lt` redirect URI.

The request correctly contained only the four baseline publishing/profile scopes and did
not request `video.list`. TikTok rejected the mismatched redirect URI before authentication
or consent. No token exchange, user-info call, callback, account write, or secure-token
write occurred. The dedicated test user's account and secure-row counts remained at the
Gate 0 baseline of one each.

At the time the attempt was stopped, one ordinary Web OAuth state remained pending and
unexpired; processing and all Business OAuth active-state counts remained zero. No cleanup
or retry was performed without separate user authorization.

The user later authorized a single fixed-error callback to terminalize that pending state.
A browser-runtime direct request could not connect, and an address-bar key action did not
change the tab authority; neither attempt changed database state. The controlled tab then
navigated to the approved HTTPS callback. Its navigation watcher timed out while the
callback performed a second redirect, but the authoritative final location was the correct
HTTPS accounts page and its URL contained no state.

By execution time, the state was no longer claimable because its pending lifetime had
elapsed. The callback followed the fail-closed expiry path; the recent sanitized status
summary confirmed `expired:expired`, while all eight ordinary/Business active-state counts
returned to zero. The same state was not submitted again. Account and secure-row counts
remained one each. The original attempt reached TikTok's authorization endpoint, but the
terminalization performed no token-exchange, user-info, or other credential API request.

Preventive gate for every retry:

1. the user must open the exact approved HTTPS account-page URL in the designated Chrome;
2. automation must read the tab's authoritative scheme, host, and path before clicking;
3. the HTTPS-host session must be confirmed as the dedicated website test user; the first
   post-abort check showed that this HTTPS origin was not yet signed in;
4. after creating a new authorization request, its redirect URI and four-scope set must be
   inspected before login or consent;
5. any mismatch requires immediate stop and fenced terminalization of the new state.

This record intentionally excludes the OAuth state, client key, full authorization URL,
authorization code, token, account identifier, and test-user identifier.

## Web OAuth retry — PASS

The user separately authorized one ordinary Web reauthorization for the existing
designated Sandbox target account. Before approval, the user was informed that a successful flow would
replace the existing publishing credentials atomically and store the scope set reported by
the provider. The approval did not include `video.list`, Business comments, replies, QR,
Portal changes, migrations, deployment, or feature-flag changes.

Immediately before the single Bind action:

- the authoritative browser URL was the approved HTTPS account-management page;
- the HTTPS-host session was the dedicated website test user;
- only one loopback listener and one approved tunnel targeted port 39117;
- the origin returned HTTP 200 with successful TLS verification;
- production readiness passed in the exact running environment;
- all eight ordinary and Business active-state aggregate values were zero;
- video-list, comment, and reply gates remained false; and
- Business credentials and the OAuth broker remained absent.

The authorization request was inspected before TikTok login or consent. Only its
non-sensitive structure was recorded:

- provider origin/path: `https://www.tiktok.com/v2/auth/authorize/`;
- redirect URI: exact match for the approved HTTPS callback;
- requested scopes: `user.info.basic`, `user.info.stats`, `video.publish`, and
  `video.upload`;
- `video.list`: not requested;
- response type: `code`;
- PKCE method: `S256`; and
- state, client-key, and code-challenge parameters: present, with values not recorded.

The consent page identified `Star Gaze (Sandbox)` and the designated Sandbox target
account. The user-authorized flow continued once. The browser returned to the approved
HTTPS account-management page without query parameters and displayed a successful binding
notification.

Post-callback database checks confirmed:

- the newest ordinary Web state was `completed`, with no error code;
- its completion timestamp was present and its verifier, processing fence, and lease were
  cleared;
- all eight ordinary and Business active-state aggregate values were zero;
- the user still had exactly one `normal`, `active` TikTok account and one secure-token row;
- the parent and secure access token, refresh token, and both expiry fields matched;
- no duplicate account or secure-token row was created; and
- Shop account and Shop secure-token counts remained zero.

The request and stored scope facts are intentionally recorded separately. The authorization
request contained exactly the four baseline scopes and omitted `video.list`. TikTok's token
response retained the account's existing Sandbox `video.list` grant, so the provider-reported
and stored scope set contained the four requested scopes plus `video.list`. The application
stored the provider result without falsifying it. Both video-list rollout gates remained
false, so this historical Sandbox grant did not expose the video-list UI or API and must not
be treated as Production approval.

No Portal setting, Business OAuth configuration, QR flow, video-list endpoint, comment
read, comment reply, migration, Git operation, or deployment was exercised in this retry.
No additional OAuth attempt is required for Gate 1.

## Original attempt fail-closed configuration

- TikTok video-list server/UI flags: false
- Social-comments API flag: false
- TikTok comments UI flag: false
- General social-comments-center UI flag: false
- TikTok reply server/UI flags: false
- Business callback, App ID/Secret, and OAuth broker: absent

The production-readiness command passed in the same effective environment used for the
fresh build and isolated runtime. This technical result does not override the later
multi-tunnel isolation failure.

## Original attempt connectivity checks

| Check | Local | HTTPS tunnel |
| --- | ---: | ---: |
| `/auth/login` | 200 | 200 |
| `/tiktok-publish/accounts` | 200 | 200 |
| `/api/tiktok/videos` with rollout gate off | 404 | 404 |
| TLS certificate verification | n/a | passed |

The build manifest contains the Login Kit callback, authorization URL route, video API,
and canonical TikTok account-management page. These checks describe the aborted attempt
only and cannot authorize a callback change.

## Completed pre-Apply hard stops

All pre-Apply hard stops passed for the running port-39117 session:

1. the loopback port had no existing listener or tunnel before startup;
2. all running `cloudflared` processes were enumerated;
3. a fresh isolated Production build and loopback-only Next instance were created;
4. readiness, HTTP/TLS checks, and tunnel/upstream uniqueness checks passed;
5. full-table, non-sensitive ordinary and Business OAuth aggregates were all zero;
6. the pre-change two-item list and add-only three-item diff were reviewed;
7. the user separately approved the exact Sandbox-only addition;
8. the same runtime and database gates were rechecked immediately before Apply;
9. the three-item list was saved and verified after a browser refresh.

## Completed OAuth hard stops and future-change gate

The six hard stops below were completed before the successful retry. They remain mandatory
before any later OAuth attempt or callback change:

1. confirm the currently applied Sandbox list contains the exact three entries recorded above;
2. confirm the replacement listener, sole approved tunnel, and origin remain alive and unchanged;
3. rerun full-table, non-sensitive ordinary and Business OAuth active-state aggregates;
4. stop if any aggregate is nonzero or any runtime/configuration evidence changed;
5. verify the authoritative browser-tab URL rather than relying on visually identical pages;
6. obtain separate user authorization for OAuth or for the exact future callback diff.

Do not start another authorization flow, enable any video/comment/reply feature flag, or
remove the temporary callback without new, separate authorization.
