# TikTok Stable HTTPS Staging Plan

Status: planning only. This document does not authorize DNS, TLS, deployment,
Portal changes, OAuth, form submission, or feature-flag enablement.

## 1. Objective and isolation boundary

Use a stable, company-controlled HTTPS origin for TikTok review and sandbox
testing without changing the production `toryxai.com` runtime.

Recommended origin:

```text
https://tiktok-review.toryxai.com
```

Recommended topology:

| Component | Production | TikTok review staging |
| --- | --- | --- |
| Hostname | `toryxai.com`, `www.toryxai.com` | `tiktok-review.toryxai.com` |
| App port | 3000 | 3010 |
| App directory | existing production directory | separate review directory |
| Process | existing production process | separate `star-gaze-tiktok-review` process |
| Environment | production secrets and flags | isolated staging credentials and flags |
| Database | production project | approved `tiktok-ai-mcn-test` staging project |

Do not reuse a Quick Tunnel hostname. Do not proxy the staging hostname to the
production port. Do not share `.env.local`, `.next`, PM2 process names, log
files, or writable upload directories between the two runtimes.

## 2. Preconditions before any external change

1. The user approves the exact hostname and confirms control of the
   `toryxai.com` DNS zone.
2. The DNS console's current production records and TTLs are exported or
   screenshotted. The target origin IP is verified in the authoritative DNS or
   server console; local resolver output is not sufficient evidence.
3. The server operator identifies the current owner and network exposure of
   port 3010 before selecting it. A pre-deployment external probe observed that
   the candidate server accepted a TCP connection on 3010 but returned no HTTP
   response; this is a stop condition, not evidence that the port is free. The
   operator must inspect the instance listener and security-group/firewall rule
   without changing them, then either close the unexplained exposure and prove
   the port is free or approve a different dedicated loopback port throughout
   this plan. The review process must use the dedicated loopback-only command
   in Section 7; the repository's existing `server.js` and
   `ecosystem.config.js` bind `0.0.0.0` and must not be reused.
4. A reviewed Git commit identifies the exact staging artifact. Do not deploy
   an uncommitted working tree.
5. A clean checkout of that commit passes tests, type-check, lint, production
   build, and sanitized readiness.
6. The staging Supabase migration/RPC verification remains green. Production
   migrations are not part of this plan.
7. TikTok comment read/reply flags remain false until their later, separate
   approval gates.

## 3. DNS and certificate change set

Proposed DNS record, subject to authoritative-console verification:

```text
Type: A
Name: tiktok-review
Value: verified public IPv4 address of the existing review-capable server
TTL: 300 during initial rollout, raised after acceptance
```

If the production zone uses a managed proxy/CDN, document whether the record is
proxied and verify that it preserves HTTPS origin, query parameters, cookies,
and the callback path exactly. Do not infer the origin address from the local
`198.18.0.0/15` resolver results seen in the development environment.

The selected bootstrap method is HTTP-01 webroot with the DNS record initially
set to DNS-only (not CDN-proxied):

1. Create `/var/www/letsencrypt/.well-known/acme-challenge`.
2. Install and enable the HTTP-only bootstrap vhost below, run `nginx -t`, and
   reload Nginx. Verify a non-secret test file under
   `/.well-known/acme-challenge/` is publicly reachable before invoking
   Certbot. The bootstrap catch-all returns 404 and does not reference any
   certificate file.
3. Run `certbot certonly --webroot -w /var/www/letsencrypt -d
   tiktok-review.toryxai.com`.
4. Only after the certificate files exist, install the TLS vhost below and run
   `nginx -t`.
5. Install a renewal deploy hook that runs `nginx -t && systemctl reload nginx`,
   then record a successful `certbot renew --dry-run`.

The first bootstrap vhost contains no TLS directives:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name tiktok-review.toryxai.com;

    access_log /var/log/nginx/tiktok-review-access.log tiktok_review_no_query;
    error_log /var/log/nginx/tiktok-review-error.log warn;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        try_files $uri =404;
    }

    location / {
        return 404;
    }
}
```

After certificate issuance, retain the ACME location and replace only the
bootstrap catch-all with the HTTPS redirect shown in the final vhost.

Certificate requirements:

- certificate SAN includes only the intended review hostname or an already
  controlled wildcard;
- TLS 1.2 or newer;
- automatic renewal is configured and a dry-run succeeds;
- HTTP redirects once to the same hostname and exact HTTPS path;
- The parent production origin already emits HSTS with `includeSubDomains` and
  `preload`. The review hostname therefore inherits an HTTPS-only browser
  requirement even before the staging vhost exists; HSTS cannot be deferred at
  the child hostname. HTTP-01 remains usable for the certificate authority, but
  no user or reviewer may open the staging hostname until a valid certificate
  and final TLS vhost are installed and verified.

## 4. Nginx staging vhost draft

Create a new vhost; do not edit the production `toryxai.com` server block.
Define this query-free format once in the Nginx `http` context (for example in
`/etc/nginx/conf.d/tiktok-review-log-format.conf`):

```nginx
log_format tiktok_review_no_query
    '$remote_addr - $remote_user [$time_local] '
    '"$request_method $uri $server_protocol" $status $body_bytes_sent '
    '"$http_user_agent"';

limit_req_zone $binary_remote_addr zone=tiktok_review:10m rate=10r/s;
```

The format intentionally uses `$uri`, never `$request`, `$request_uri`, or
`$args`. Create a reusable proxy snippet for the headers/timeouts below, then
use exact callback locations with access logging disabled. Application logging
must also never log callback query strings, authorization codes, or state.

`/etc/nginx/snippets/tiktok-review-proxy.conf` contains exactly:

```nginx
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_connect_timeout 30s;
proxy_send_timeout 300s;
proxy_read_timeout 300s;
proxy_cache_bypass $http_upgrade;
```

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name tiktok-review.toryxai.com;

    access_log /var/log/nginx/tiktok-review-access.log tiktok_review_no_query;
    error_log /var/log/nginx/tiktok-review-error.log warn;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
        try_files $uri =404;
    }

    location / {
        return 301 https://tiktok-review.toryxai.com$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name tiktok-review.toryxai.com;

    ssl_certificate /etc/letsencrypt/live/tiktok-review.toryxai.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tiktok-review.toryxai.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    # Upload testing is outside this gate. Keep a conservative explicit limit
    # instead of inheriting Production's 100 MB value.
    client_max_body_size 1m;
    access_log /var/log/nginx/tiktok-review-access.log tiktok_review_no_query;
    error_log /var/log/nginx/tiktok-review-error.log warn;
    limit_req zone=tiktok_review burst=30 nodelay;

    location = /api/tiktok/auth/callback {
        access_log off;
        error_log /dev/null;
        include /etc/nginx/snippets/tiktok-review-proxy.conf;
        proxy_pass http://127.0.0.1:3010;
    }

    location = /api/tiktok/business-auth/callback/ {
        access_log off;
        error_log /dev/null;
        include /etc/nginx/snippets/tiktok-review-proxy.conf;
        proxy_pass http://127.0.0.1:3010;
    }

    location / {
        include /etc/nginx/snippets/tiktok-review-proxy.conf;
        proxy_pass http://127.0.0.1:3010;
    }
}
```

The proxy snippet must not enable access logging. Nginx and PM2 log directories
are created with rotation and permissions that prevent the app user from
reading unrelated production logs.

Before reload: save the current enabled-vhost list, run `nginx -t`, and compare
the rendered config to ensure that the production vhost is unchanged. Reload,
do not restart, unless the operator has a separately approved maintenance plan.

## 5. Exact origin and redirect matrix

The three redirect concepts must remain distinct:

| Purpose | Proposed staging value | Exchanges a token |
| --- | --- | --- |
| App origin | `https://tiktok-review.toryxai.com` | No |
| Login Kit callback | `https://tiktok-review.toryxai.com/api/tiktok/auth/callback` | Yes, Login Kit |
| Business account-holder callback | Origin + `/api/tiktok/business-auth/callback/` | Yes, Accounts API |
| Business advertiser return/landing | Separate landing; confirm the current Portal definition | No |

The Business account-holder callback intentionally has a trailing slash. The
Portal value, `TIKTOK_BUSINESS_REDIRECT_URI`, the authorization request, Broker
request, and token exchange body must match byte-for-byte.

Do not set the advertiser redirect field to the account-holder callback. Before
choosing its final landing URL, archive the Portal's current field help text and
confirm whether authentication is allowed on the landing page.

## 6. Staging environment contract

Non-secret values:

```dotenv
NODE_ENV=production
PORT=3010
NEXT_PUBLIC_APP_URL=https://tiktok-review.toryxai.com
TIKTOK_REDIRECT_URI=https://tiktok-review.toryxai.com/api/tiktok/auth/callback
TIKTOK_BUSINESS_REDIRECT_URI=https://tiktok-review.toryxai.com/api/tiktok/business-auth/callback/

# Default state before each separately approved test gate
TIKTOK_VIDEO_LIST_SCOPE_ENABLED=false
NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED=false
SOCIAL_COMMENTS_API_ENABLED=false
SOCIAL_COMMENTS_ENABLED_PLATFORMS=
NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=false
NEXT_PUBLIC_SOCIAL_COMMENTS_CENTER_ENABLED=false
TIKTOK_COMMENTS_REPLY_ENABLED=false
NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=false

# Direct provider transport for this staging gate
# OAUTH_BROKER_URL must be absent, not blank or a placeholder.

# Conservative read budgets retained while comments are disabled
TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT=20
TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET=5
TIKTOK_COMMENT_REPLY_CALL_BUDGET=15
```

Secrets are supplied from the approved staging secret store and never copied
into this document, chat, screenshots, shell history, Git, build logs, or Portal
evidence. Business App ID/Secret remain unset until the App is approved and the
credentials are actually issued.

When a later gate enables video-list Sandbox recording, the two video-list
flags are changed to exact `true` together. Business comment flags remain false.
When a later gate enables Business read-only validation, reply flags remain
false. The exact read-only combination is:

```dotenv
SOCIAL_COMMENTS_API_ENABLED=true
SOCIAL_COMMENTS_ENABLED_PLATFORMS=tiktok
NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=true
NEXT_PUBLIC_SOCIAL_COMMENTS_CENTER_ENABLED=false
TIKTOK_COMMENTS_REPLY_ENABLED=false
NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=false
TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT=20
TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET=5
TIKTOK_COMMENT_REPLY_CALL_BUDGET=15
```

`NEXT_PUBLIC_*` values are embedded at build time. Every later gate that changes
any `NEXT_PUBLIC_*` value requires a fresh production build from the approved
exact commit using the newly approved effective environment. Stop the isolated
PM2 process only for the artifact switch, replace its `.next` with that new
build, restart it, rerun readiness, and verify both the sanitized build summary
and the value observed by a fresh browser session. A PM2 restart alone must
never enable a client flag, and the initial all-false `.next` must not be reused
for video-list or Business read-only recording.

Reply enablement is a separate final gate. If direct staging egress to the
Business API is unavailable, stop and request a separate Broker approval; do
not silently set `OAUTH_BROKER_URL`.

## 7. Deployment sequence requiring separate approval

1. Create the DNS record and wait for authoritative propagation. Because the
   parent HSTS policy covers this hostname, do not send a browser or reviewer
   to it during the HTTP-only bootstrap interval.
2. Create the isolated app directory and checkout the approved commit.
3. Install dependencies using the exact command verified in clean checkout.
4. Write the isolated staging environment with restrictive file permissions.
5. Build inside the staging directory; do not copy the production `.next`.
6. Start the app with a dedicated PM2 definition. Do not use `server.js` or the
   production ecosystem file. The staging definition uses:

   ```js
   {
     name: 'star-gaze-tiktok-review',
     cwd: '/var/www/star-gaze-tiktok-review',
     script: 'node_modules/next/dist/bin/next',
     args: 'start -H 127.0.0.1 -p 3010',
     out_file: '/var/log/pm2/star-gaze-tiktok-review-out.log',
     error_file: '/var/log/pm2/star-gaze-tiktok-review-error.log',
     env: { NODE_ENV: 'production' }
   }
   ```

   Acceptance requires `ss -ltnp` or `lsof -nP -iTCP:3010 -sTCP:LISTEN` to
   show only `127.0.0.1:3010`, never `0.0.0.0:3010` or `[::]:3010`.
7. Verify localhost health, then install and enable only the HTTP bootstrap
   vhost. Run `nginx -t`, reload Nginx, and verify the ACME challenge path.
8. Issue the certificate with the selected HTTP-01 webroot command. Only after
   the certificate files exist, install the final HTTP redirect and TLS vhost,
   run `nginx -t`, and reload Nginx.
9. Record a sanitized build-time environment summary and a separate sanitized
   PM2 runtime effective-environment summary. Include variable names and safe
   booleans/origins only, never credentials. Confirm the approved server and
   `NEXT_PUBLIC_*` values match the artifact, then run readiness in the same
   effective environment as the running process.
10. Perform anonymous HTTPS, authenticated account-page, callback-path, cookie,
    and canonical-route acceptance checks.
11. Only after acceptance, update the applicable TikTok Sandbox callback. Do
    not modify Production Portal settings in this staging gate.

## 8. Acceptance checklist

- DNS resolves from at least two independent public resolvers.
- Certificate hostname, chain, expiry, and renewal dry-run pass.
- A fresh browser reaches the hostname over valid HTTPS on its first visit;
  the inherited parent-domain HSTS policy is recorded in the acceptance
  evidence rather than described as deferred.
- HTTP to HTTPS preserves path and query once.
- `NEXT_PUBLIC_APP_URL` is the exact public origin.
- Login Kit callback has no query/hash/userinfo in its registered base value.
- Business account-holder callback preserves the trailing slash and does not
  pass through a 307/308 before the handler.
- Readiness passes in the running process environment.
- `X-Robots-Tag` is present on review pages.
- The intended review use is limited to login, the TikTok account/video
  workflow, callback endpoints, and public policy pages. Nginx proxies the
  whole application; it does not implement a route allowlist. Existing
  application authentication and role checks remain mandatory for all account
  data and admin routes. Before rollout, anonymously probe representative
  account, admin, upload, and sensitive API routes and confirm they reject
  access. Only the dedicated review user is supplied to reviewers.
- Content Posting upload is outside this gate. The vhost deliberately enforces
  `client_max_body_size 1m`; no upload regression claim may be made from this
  environment. A later gate that needs upload recording must separately review
  and approve a larger limit plus connection/body-rate protections.
- Nginx basic request limiting is active. `noindex` is treated only as search
  indexing control, never as authentication or authorization.
- No CDN/Zero-Trust access layer is enabled in the initial gate. If one is
  proposed later, both TikTok callbacks and the reviewer flow require explicit
  tested bypass rules before activation.
- Production `toryxai.com` homepage, login, publishing, and existing callbacks
  remain unchanged.
- Staging `Set-Cookie` headers do not contain `Domain=.toryxai.com` or any
  parent-domain scope. Supabase auth cookie/storage names use the staging
  project ref and differ from Production. Logging into or out of staging must
  not create, remove, or authenticate a Production session, and the reverse
  direction must also be tested in a fresh browser profile.
- Staging uses the staging Supabase project and approved review user only.
- No secret, authorization code, access token, or refresh token appears in
  screenshots, URLs, analytics, proxy access logs, or application logs.
- Callback Nginx error logs are intentionally discarded to prevent accidental
  query leakage. Diagnose callback failures through HTTP status, the
  application's stable error-code logs, OAuth state, and database audit fields;
  do not temporarily enable raw callback request logging.
- All comments and reply flags remain false unless the exact later gate has
  been approved.

## 9. Rollback and stop conditions

Immediate stop conditions:

- DNS points to an unverified origin;
- port 3010 still has an unidentified listener or public network exposure;
- the contents of an existing production server block change (the expected new
  staging block and log-format/snippet files are reviewed separately);
- certificate or hostname validation fails;
- readiness fails;
- callback changes path/origin or redirects unexpectedly;
- staging connects to the production database;
- any secret appears in output;
- an old and new callback instance can receive the same OAuth flow.

Rollback order:

1. Remove or disable only the staging Nginx vhost and reload after `nginx -t`.
2. Stop only `star-gaze-tiktok-review`.
3. Remove only the `tiktok-review` DNS record.
4. Revert only Sandbox callback entries added in this staging gate.
5. Disable and remove only the staging certificate renewal entry or deploy hook
   so Certbot does not keep retrying a removed hostname. Keep or revoke the
   issued certificate according to the approved retention decision; never
   touch another certificate lineage.
6. Remove only the staging vhost symlink, query-free log-format file, proxy
   snippet, PM2 definition, and staging log-rotation rule after archiving the
   non-sensitive audit logs. Preserve database audit state for review.
7. Keep the staging application directory and environment quarantined until
   the operator separately approves secure deletion; do not delete them as an
   incidental rollback step.
8. Do not alter the production process, production vhost, Production Portal
   callbacks, or production database as part of this rollback.

## 10. Recording timing

Prepare recording outlines now, but write the final click-by-click scripts only
after the stable origin, final review build, exact Portal fields, and approved
permissions are visible. Recordings made before those facts are stable become
misleading and should not be submitted.

Two distinct final recordings are expected:

1. TikTok for Developers: Login Kit plus `video.list` read-only video list and
   video-level aggregate metrics.
2. TikTok API for Business Developers: independent account-holder consent,
   comment/reply-list read-only flow, and—only after its separate approval—the
   user-initiated reply flow.

Prototype footage may be prepared earlier only if it is visibly labeled as a
prototype and never represented as a successful real API response.
