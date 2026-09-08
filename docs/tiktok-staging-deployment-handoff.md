# TikTok Review Staging Deployment Handoff

Status: preparation only. This handoff does not authorize DNS, firewall,
certificate, server, database, Portal, OAuth, or feature-flag changes.

The normative design and rollback rules are in
`docs/tiktok-stable-staging-plan.md`. This file defines the evidence that the
server operator must return before and after an approved deployment.

## 1. Current gate

The common TikTok foundation has passed provisional verification in the
uncommitted latest-main migration working tree:

- base `main` commit `30848db5462ac6345bc38c4b98f792ab373699f7`;
- Node 20.19.5: 380 total / 379 passed / 1 skipped / 0 failed;
- TypeScript type-check;
- full `src` ESLint with zero errors;
- production build;
- sanitized TikTok readiness with video-list and comment gates disabled;
- loopback-only production-server smoke test;
- public Contact, Privacy, Terms, and Legal pages return 200 and contain the
  approved same-domain contact address;
- disabled TikTok video and comment APIs return 404 before sensitive access.

This is not yet a deployable artifact. The reviewed release commit SHA and
matching tree hash are both **TBD after latest-main migration review and local
acceptance**. The operator must receive those exact values after the separate
Git approval gate. A directory copy, archive of the working tree, branch name,
base-main SHA, or the provisional test result above is not an artifact identity.

## 2. Responsibility boundary

The server operator owns and executes:

- authoritative DNS and cloud security-group inspection;
- listener, firewall, Nginx, PM2, disk, and certificate inspection;
- the approved DNS, TLS, Nginx, PM2, and application deployment changes;
- command output and rollback evidence, with secrets removed.

The application reviewer owns:

- exact commit/tree verification;
- tests, build, readiness, routes, flags, callback behavior, and policy checks;
- comparison of the returned deployment evidence with the approved plan.

The user separately approves Git publication, infrastructure changes, Portal
changes, OAuth tests, and each feature-flag gate. Approval for one category
does not authorize another.

## 3. Required read-only server report

Before any change, the operator returns a sanitized report containing:

1. Instance identity, region, operating-system version, and public IP used by
   the authoritative `toryxai.com` record.
2. Inbound cloud security-group and host-firewall rules for ports 22, 80, 443,
   and the proposed staging port. Do not include credentials or unrelated
   private addressing.
3. `ss -ltnp` or equivalent listener ownership for the proposed staging port.
   A prior external probe accepted TCP on 3010 but received no HTTP response;
   3010 must be treated as unavailable until its listener and exposure are
   explained.
4. Existing Nginx include layout, enabled vhosts, certificate lineages, and
   the exact production `toryxai.com` server block checksum. Do not print
   callback query strings.
5. Existing PM2 process names, working directories, ports, Node/npm versions,
   available disk space, and log-rotation policy.
6. Confirmation that the production application, production `.next`,
   production environment, upload directories, and production database will
   not be reused by staging.
7. Confirmation that the selected staging Supabase project is the already
   verified test project and that migration `20260808` plus its RPC/ACL checks
   are present. Do not rerun the migration merely to prove presence.

Read-only inspection must stop if it requires changing a rule, restarting a
process, exposing a secret, or entering a production database mutation path.

## 4. Values to freeze in the approved change sheet

The final change sheet must replace every `TBD` below before execution:

| Item | Required value |
| --- | --- |
| Git commit | `TBD_REVIEWED_COMMIT_SHA` |
| Git tree | `TBD_REVIEWED_TREE_HASH` |
| Hostname | `tiktok-review.toryxai.com` |
| Authoritative A/AAAA target | `TBD_VERIFIED_BY_OPERATOR` |
| Loopback app port | `TBD_AFTER_3010_INVESTIGATION` |
| Application directory | `/var/www/star-gaze-tiktok-review` or reviewed equivalent |
| PM2 process | `star-gaze-tiktok-review` |
| Staging database project | approved `tiktok-ai-mcn-test` project |
| Certificate method | Let's Encrypt HTTP-01 webroot |
| Nginx staging files | staging-only vhost, query-free log format, proxy snippet |

If the operator selects a port other than 3010, every environment, PM2, Nginx,
health-check, acceptance, and rollback reference must change together before
approval. Do not make an execution-time substitution.

## 5. Initial deployed state

The first HTTPS deployment is configuration-only and keeps all new TikTok
capabilities closed:

```dotenv
TIKTOK_VIDEO_LIST_SCOPE_ENABLED=false
NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED=false
SOCIAL_COMMENTS_API_ENABLED=false
SOCIAL_COMMENTS_ENABLED_PLATFORMS=
NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=false
NEXT_PUBLIC_SOCIAL_COMMENTS_CENTER_ENABLED=false
TIKTOK_COMMENTS_REPLY_ENABLED=false
NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=false
```

`OAUTH_BROKER_URL` is absent. Business App credentials remain absent until
TikTok approves the App and issues them. Secrets are provided through the
approved staging secret store and never included in the change sheet.

The parent domain already applies HSTS with `includeSubDomains` and `preload`.
The operator may use HTTP only for the CA's HTTP-01 challenge. No reviewer or
browser may visit the staging hostname until the certificate and final TLS
vhost are valid.

## 6. Evidence required after an approved deployment

Return only non-sensitive evidence:

- authoritative DNS answers and certificate hostname/chain/expiry;
- successful `nginx -t` and Certbot renewal dry-run;
- listener bound only to `127.0.0.1:<approved-port>`;
- PM2 process name, commit SHA, tree hash, and application directory;
- sanitized build-time and runtime flag summaries;
- readiness result from the running effective environment;
- status matrix for public policy pages, login, canonical TikTok routes,
  disabled APIs, and representative unauthorized admin/sensitive routes;
- cookie isolation evidence showing no parent-domain session cookie;
- production-vhost checksum and production-process status unchanged;
- rollback commands for the exact staging-only DNS record, certificate lineage,
  Nginx files, PM2 process, logs, and application directory.

Never return environment values, authorization codes, state values, access or
refresh tokens, cookies, secrets, raw callback URLs with queries, or database
credential rows.

## 7. Stop conditions

Do not deploy or continue when any of the following is true:

- the exact commit/tree is not approved;
- the staging port listener or public exposure is unexplained;
- the DNS target is not the inspected instance;
- a certificate is unavailable while the inherited HSTS policy applies;
- the deployment would edit or reload an invalid production Nginx block;
- staging would share the production process, directory, `.next`, environment,
  writable storage, session namespace, or database;
- readiness fails or any new TikTok flag is enabled;
- a secret appears in output;
- rollback cannot be limited to staging-only resources.

After this evidence passes read-only review, Portal callback changes and real
OAuth remain later, separately approved gates.
