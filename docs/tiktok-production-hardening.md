# TikTok production hardening and rollout

This runbook covers TikTok management, secure tokens, video statistics, Business OAuth,
comment read/reply, ordinary Login Kit callback fencing, shared Accounts API read budgets,
independent Business comment revocation, ordinary Content Posting `FILE_UPLOAD`, durable
account disconnection, fenced video statistics, and user-controlled deletion introduced
by migrations `20260723` through `20260911`.

It deliberately keeps the legacy `/publish` aliases and the legacy token columns. Removing either is a separate post-stabilization project.

## Release gates

Run both checks before deployment. They print variable names and validation results, never values.

```bash
npm run check:tiktok-production
node scripts/tiktok-production-readiness.cjs --role=broker --env=broker.env
```

The application check fails when:

- ordinary Login Kit client credentials are missing, or its callback is not the exact production HTTPS `/api/tiktok/auth/callback` on `NEXT_PUBLIC_APP_URL`;
- a public TikTok comments flag is enabled without the API and `tiktok` platform allowlist;
- the reply UI is enabled without the server reply gate;
- Business OAuth credentials or callback are missing when TikTok comments are enabled;
- Business read QPM and per-sync request budgets are missing or invalid when TikTok comments are enabled;
- callback or Broker URLs are not HTTPS;
- a Broker secret is missing or shorter than 32 characters.

The Broker check additionally fails if `OAUTH_BROKER_URL` is present, because a Broker must never delegate back to itself.

## Required migration order

Apply migrations in this order and wait for PostgREST schema-cache visibility after each RPC-bearing migration:

1. `20260723_tiktok_account_tokens.sql`
2. `20260724_tiktok_video_stats_atomic.sql`
3. `20260725_tiktok_business_oauth.sql`
4. `20260726_tiktok_business_comment_read.sql`
5. `20260727_social_comment_reply_finalize.sql`
6. `20260728_tiktok_oauth_state_fencing.sql`
7. `20260808_tiktok_business_comment_controls.sql`
8. `20260908_tiktok_content_posting_file_upload.sql`
9. `20260909_tiktok_account_disconnect_hardening.sql`
10. `20260909_tiktok_video_data_hardening.sql`
11. `20260911_tiktok_user_data_deletion.sql`

Before enabling any flag, verify every runtime RPC without reading credentials:

```sql
WITH required(signature) AS (
  VALUES
    ('public.claim_tiktok_token_refresh(uuid,text,uuid,integer)'),
    ('public.release_tiktok_token_refresh(uuid,uuid)'),
    ('public.commit_tiktok_token_refresh(uuid,text,uuid,text,text,timestamptz,timestamptz,timestamptz)'),
    ('public.apply_tiktok_task_video_stats(uuid,uuid,jsonb)'),
    ('public.claim_tiktok_business_auth_state(text,uuid,integer)'),
    ('public.complete_tiktok_business_auth_state(text,uuid,text,text,text,timestamptz,timestamptz,jsonb)'),
    ('public.fail_tiktok_business_auth_state(text,uuid,text,text)'),
    ('public.claim_tiktok_business_token_refresh(uuid,uuid,uuid,uuid,integer)'),
    ('public.commit_tiktok_business_token_refresh(uuid,uuid,uuid,uuid,text,text,text,timestamptz,timestamptz,jsonb)'),
    ('public.release_tiktok_business_token_refresh(uuid,uuid,uuid)'),
    ('public.finalize_social_comment_reply(uuid,uuid,uuid,text,uuid,jsonb)'),
    ('public.transition_tiktok_reply_action(uuid,uuid,uuid,text[],text,text,text,jsonb)'),
    ('public.abandon_stale_tiktok_reply_dispatch(uuid,uuid,uuid)'),
    ('public.mark_tiktok_reply_dispatch_started(uuid,uuid,uuid)'),
    ('public.mark_stale_tiktok_reply_dispatch_unknown(uuid,uuid,uuid)'),
    ('public.claim_tiktok_auth_state(text,text,uuid,uuid,integer)'),
    ('public.complete_tiktok_auth_state(text,text,uuid,uuid)'),
    ('public.fail_tiktok_auth_state(text,text,uuid,uuid,text,text)'),
    ('public.expire_tiktok_auth_state(text,text,uuid)'),
    ('public.commit_tiktok_auth_account(text,text,uuid,uuid,text,text,text,text,text,bigint,bigint,bigint,bigint,text,text,timestamptz,timestamptz,jsonb)'),
    ('public.claim_tiktok_business_api_budget(uuid,uuid,text,integer,integer)'),
    ('public.begin_tiktok_business_token_revocation(uuid,uuid,uuid,uuid,integer,boolean)'),
    ('public.complete_tiktok_business_token_revocation(uuid,uuid,uuid,uuid)'),
    ('public.defer_tiktok_business_token_revocation(uuid,uuid,uuid,uuid,text,text)'),
    ('public.delete_tiktok_user_data(uuid)')
),
resolved AS (
  SELECT signature, to_regprocedure(signature) AS function_oid
  FROM required
)
SELECT
  resolved.signature,
  resolved.function_oid IS NOT NULL AS function_exists,
  COALESCE(has_function_privilege('service_role', resolved.function_oid, 'EXECUTE'), FALSE)
    AS service_role_execute,
  NOT COALESCE(has_function_privilege('anon', resolved.function_oid, 'EXECUTE'), TRUE)
    AS anon_denied,
  NOT COALESCE(has_function_privilege('authenticated', resolved.function_oid, 'EXECUTE'), TRUE)
    AS authenticated_denied,
  NOT EXISTS (
    SELECT 1
    FROM pg_proc function_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(function_row.proacl, acldefault('f', function_row.proowner))
    ) function_acl
    WHERE function_row.oid = resolved.function_oid
      AND function_acl.grantee = 0
      AND function_acl.privilege_type = 'EXECUTE'
  ) AS public_denied
FROM resolved
ORDER BY resolved.signature;
```

Every row must report `true` for all five boolean columns. A missing function or any inherited/public execute grant fails deployment.

## Rollout sequence

1. Keep all TikTok comment and reply flags false. Keep
   `TIKTOK_VIDEO_LIST_SCOPE_ENABLED=false` and
   `NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED=false` in Production until the
   Production revision containing `video.list` is approved and Live.
2. Back up the affected tables and record row counts. Do not export token values into tickets or logs.
3. Apply the migrations in order. Migration `20260808` keeps legacy Business-auth state inserts
   compatible by filling `account_generation` in a database `BEFORE INSERT` trigger. Even with that
   compatibility, block new Login Kit and Business OAuth starts, drain both callback paths, and verify
   both state tables have no `pending` or `processing` rows before the application transition. The new
   application intentionally fails closed before provider exchange until all five
   ordinary Login Kit RPCs are visible in PostgREST. The commit RPC verifies the
   live attempt fence, writes or updates the normal account, lets the existing
   secure-token trigger mirror credentials, and completes state in one transaction.
4. Confirm the RPCs and grants above, then force/await PostgREST schema-cache refresh.
   Also confirm the `20260908` transfer/outcome columns are visible before deploying
   application code that creates `FILE_UPLOAD` tasks. This additive migration defaults
   existing and old-application rows to `PULL_FROM_URL`; the new application must never
   be deployed before the columns are visible. `FILE_UPLOAD` task creation uses the
   dedicated `/api/publish/file-tasks` route, which is absent from the previous release.
   If a new browser reaches an old instance, the request must fail with `404`/`405`
   before any task row is created. If creation reached a new instance but initialization
   reaches an old one, the browser must retain the selected `File` objects and the same
   idempotency key so the user can resume the same task after the rollout completes.
5. Deploy the overseas Broker and pass its readiness check.
6. Deploy the application with comments API and both video-list rollout gates
   still closed. Confirm ordinary Web and QR authorization still request exactly
   `user.info.basic`, `user.info.stats`, `video.upload`, and `video.publish`.
   Drain old application instances before admitting new Login Kit Web/QR callbacks:
   old callback code does not participate in the new claim fence, so callback
   traffic must not be served by old and new instances concurrently. Before allowing
   production `FILE_UPLOAD`, probe `/api/publish/file-tasks` and both item-level
   `file-upload` routes on every serving instance. During rollback, keep the additive
   migration and FILE_UPLOAD-capable backend until no active FILE_UPLOAD item remains;
   rollback the browser UI first rather than routing a loaded new UI to a fully old backend.
7. Set `TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT` from the approved App Detail/rate-limit tier.
   Keep conservative top-level and reply budgets within that limit. Never treat the example values
   as a permanent provider entitlement.
8. Enable `SOCIAL_COMMENTS_API_ENABLED=true` and add `tiktok` to `SOCIAL_COMMENTS_ENABLED_PLATFORMS`.
9. Enable `NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=true` and rebuild. Validate read-only sync first.
10. Enable `TIKTOK_COMMENTS_REPLY_ENABLED=true`. Exercise one private/staging reply while the public reply flag remains false.
11. Enable `NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=true` and rebuild.

## FILE_UPLOAD Production migration gate

The exact reviewed artifact is
`supabase/migrations/20260908_tiktok_content_posting_file_upload.sql`: 159 lines,
5,738 bytes, SHA-256
`1f7708a9a1d021120f9b7376ed14b911bc1c66ff71cbd8450687ac223aa6f802`.
Any byte change invalidates this approval and requires replay in the test database.

Before execution, record a fresh restorable Supabase backup timestamp and save the
following aggregate/catalog output without exporting task contents or credentials.
The catalog query must show either no `20260908` objects (first application), or an
exactly matching complete set (idempotent replay). A partial or differently-defined
set is a no-go.

```sql
SELECT count(*) AS publish_task_items_before
FROM public.publish_task_items;

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'publish_task_items'
  AND column_name IN (
    'tiktok_transfer_method',
    'source_video_size_bytes',
    'source_video_mime_type',
    'tiktok_upload_outcome',
    'tiktok_upload_reported_at'
  )
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.publish_task_items'::regclass
  AND conname IN (
    'publish_task_items_tiktok_transfer_method_check',
    'publish_task_items_tiktok_upload_outcome_check',
    'publish_task_items_file_upload_metadata_check'
  )
ORDER BY conname;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
    'FILE_UPLOAD items are server-managed',
    'Ambiguous FILE_UPLOAD items cannot be deleted',
    'Tasks with ambiguous FILE_UPLOAD items cannot be deleted'
  )
ORDER BY tablename, policyname;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('publish_tasks', 'publish_task_items')
ORDER BY table_name, grantee, privilege_type;
```

Execute only the exact hashed migration in a single transaction through the approved
Production database mechanism. Do not edit it in the SQL editor. After commit, request
a PostgREST cache reload and wait until both authenticated-user and service-role HEAD
queries can resolve all five new columns:

```sql
NOTIFY pgrst, 'reload schema';
```

The postflight is successful only when all five columns, all three constraints, and all
three restrictive policies match the migration; RLS remains enabled; the table-grant
snapshot is unchanged; the total row count is unchanged; and, before the new application
is exposed, every existing row still reports `PULL_FROM_URL` with null FILE_UPLOAD-only
metadata:

```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
WHERE oid IN (
  'public.publish_tasks'::regclass,
  'public.publish_task_items'::regclass
)
ORDER BY relname;

SELECT
  count(*) AS publish_task_items_after,
  count(*) FILTER (WHERE tiktok_transfer_method = 'PULL_FROM_URL') AS pull_rows,
  count(*) FILTER (WHERE tiktok_transfer_method = 'FILE_UPLOAD') AS file_rows,
  count(*) FILTER (
    WHERE source_video_size_bytes IS NOT NULL
       OR source_video_mime_type IS NOT NULL
       OR tiktok_upload_outcome IS NOT NULL
       OR tiktok_upload_reported_at IS NOT NULL
  ) AS rows_with_file_metadata
FROM public.publish_task_items;
```

The default rollback is application rollback while retaining this additive schema.
Never drop the columns or restrictive policies while any FILE_UPLOAD task exists or a
new browser bundle can still reach the service. A destructive database rollback is a
separate approval and is permitted only after application rollback, browser/CDN drain,
and a locked transaction proves `count(*) FILTER (WHERE tiktok_transfer_method =
'FILE_UPLOAD') = 0`; it must then remove the three policies, three constraints, and five
columns together, reload the PostgREST cache, and reproduce the recorded preflight
catalog and row-count snapshots.

The `video.list` rollout is separate from the Business comment rollout:

1. Use isolated Sandbox/staging credentials and a stable HTTPS origin with
   `TIKTOK_VIDEO_LIST_SCOPE_ENABLED=true` and
   `NEXT_PUBLIC_TIKTOK_VIDEO_LIST_ENABLED=true` to record and verify the
   end-to-end Display API review flow.
2. Create and submit the Production revision using that reviewed evidence while
   both Production flags remain false.
3. Only after TikTok marks the Production revision containing `video.list` as
   approved and Live, enable both Production flags in one maintenance window,
   rerun readiness, rebuild, and restart the application.
4. Existing accounts can then be prompted once to reauthorize for `video.list`.
   Never show that prompt while the Production scope gate is false.

`NEXT_PUBLIC_*` values are compiled into the browser bundle. A process restart without a rebuild does not change them.

## Business App and account-holder authorization evidence

- Request only **Get Business Comment** (`comment.list`) and **Manage Account Comment**
  (`comment.list.manage`). The initial implementation does not request Account User or Get Account Media.
- The Advertiser redirect URL in the App creation form is a separate landing-page field. It must
  not be confused with the TikTok account-holder redirect URL used to exchange `auth_code`.
- The account-holder callback is exactly
  `https://<stable-review-host>/api/tiktok/business-auth/callback/`. The value in Portal,
  `TIKTOK_BUSINESS_REDIRECT_URI`, the Broker, and the token exchange body must match byte-for-byte.
- Do not replace the authorization host/path based on assumptions. After the App is approved, capture
  the account-holder authorization URL generated by App Detail, validate its fixed scheme/host/path and
  fixed parameters, and allow the application to inject only a fresh random state and the two approved scopes.
- The two OAuth open IDs are app-specific and cannot be compared as proof of identity. The UI must
  instruct the user to authorize the same TikTok account selected for publishing; test a deliberate
  wrong-account authorization before production rollout.
- Official recordings are made only after stable HTTPS staging, final UI, exact Portal fields, policies,
  and review account are frozen. Earlier recordings are labeled **prototype** and must not imply live API approval.

## Broker deployment

- `broker.env` must be mode `0600`, excluded from Git and image layers.
- Write literal dollar signs in validated env values as `\$`; unresolved `$NAME`/`${NAME}` references and malformed or empty quoted values fail readiness.
- App readiness always uses the production Next file set: `.env`, `.env.production`, `.env.local`, and `.env.production.local`, followed by shell overrides. Broker credential fields stay sourced from `broker.env` because the service consumes them through `env_file`/the BuildKit file secret; shell overrides apply only to the five `${BROKER_*}` network interpolation fields in Compose. Run readiness and deployment from the same controlled shell; the readiness result is invalid if those network exports change between the two commands.
- Do not use backtick quoting in `broker.env`; Docker Compose only treats single and double quotes as env-file quoting.
- Never set `OAUTH_BROKER_URL` on the Broker.
- Keep `BROKER_ALLOW_IP` restricted to the application server's fixed egress IP.
- Use an IPv4 address or approved hostname for `BROKER_PUBLIC_ADDR`; the current Caddy site-address template intentionally rejects raw IPv6. `BROKER_ALLOW_IP` may be a fixed globally routable IPv4 or IPv6 address.
- `BROKER_LOCAL_PORT` and `BROKER_UPSTREAM` must identify the same loopback listener.
- The application and Broker must use the same `BROKER_SECRET`, Business client ID, secret, and redirect URI. Compare hashes or lengths operationally; never print the values.
- Keep Caddy restricted to `/api/oauth-broker/call`; all other paths must return 404.
- Always pass `--env-file broker.env` to Docker Compose. `env_file:` injects the Broker container but does not supply `${...}` interpolation for the Compose/Caddy configuration.
- Run `docker compose --env-file broker.env -p stargaze-broker -f docker-compose.broker.yml config` and inspect only variable names/addresses before `up`.
- Confirm an unauthorized request returns 401 and an unknown operation returns 400 before running provider tests.
- Rotate `BROKER_SECRET` by updating both sides in one maintenance window. Keep reply gates off during a non-overlapping rotation.

## Staging end-to-end acceptance

Use a normal TikTok account, not a Shop account.

1. Set both video-list rollout flags to `true`, complete Login Kit authorization,
   and confirm `video.list`.
   Submit the same Web callback twice and overlap two confirmed QR polls; only one
   request may reach token exchange and a late failure must not downgrade completed.
2. Complete Business OAuth and confirm `comment.list` plus `comment.list.manage`.
3. Load the canonical account, video, and comments routes; also verify legacy `/publish` aliases.
4. Fetch multiple video pages and verify cursors strictly decrease.
5. Run two overlapping statistics syncs and confirm task totals equal current item totals.
6. Sync a video with top-level and nested comments and confirm both map to the same provider reply target.
7. Send one reply with a stable idempotency key. Re-submit that key and confirm no second provider call.
8. Inject a local finalize failure after a provider receipt; retry and confirm local recovery without another provider call.
9. Inject a transport timeout/HTTP 408/HTTP 5xx; confirm the action becomes `unknown`, a different key is blocked, and synchronization reconciles only one bounded unique candidate.
10. Pause before dispatch, abandon the stale attempt, restart with the same key, and confirm the old attempt token cannot mark, transition, or finalize the new attempt.
11. Verify a foreign account ID and a Shop account ID fail before token/Broker/provider access.
12. Disconnect only the Business comment authorization. Confirm provider revoke is called, local token use
    is blocked immediately, and publishing authorization and tasks remain. An uncertain remote result stays
    in protected `revocation_pending` and must not trigger another provider call; after the user confirms
    revocation in TikTok settings, exercise the audited local-completion path.
13. Start Business OAuth, then begin an independent disconnect before OAuth completion. Confirm the
    account authorization generation advances and the older OAuth attempt cannot persist credentials.
    Repeat in the opposite order and confirm reauthorization is blocked while revocation is pending.
14. Confirm logs and API responses contain no access token, refresh token, authorization header, Broker secret, or OAuth code.

The repository's Node tests model these paths. A real PostgreSQL staging run remains mandatory for row-lock and RPC behavior.

## Rollback and incident containment

Rollback is flag-first and non-destructive:

1. Set `NEXT_PUBLIC_TIKTOK_COMMENTS_REPLY_ENABLED=false` and rebuild.
2. Set `TIKTOK_COMMENTS_REPLY_ENABLED=false`.
3. Remove `tiktok` from `SOCIAL_COMMENTS_ENABLED_PLATFORMS` if reads must also stop.
4. Set `NEXT_PUBLIC_TIKTOK_COMMENTS_ENABLED=false` and rebuild if the page must disappear.
5. Set `SOCIAL_COMMENTS_API_ENABLED=false` only for a cross-platform comments emergency.

Do not drop the new tables, functions, columns, triggers, or BIGINT conversions during an incident. They are backward-compatible while flags are off, and destructive rollback can lose rotated refresh tokens or reply receipts. Restore the previous application only after reply flags are off. Prepare a separately reviewed forward migration for any schema correction.

For an ambiguous reply outcome, preserve the `unknown` action and unique fence. Reconcile from provider data or use an audited manual decision; never delete the row merely to allow a retry.

## Token and permission audit

- `tiktok_account_tokens`, `tiktok_business_account_tokens`, and
  `tiktok_business_api_rate_windows` remain service-role-only.
- Shared read-rate evidence is retained for one day per active account/endpoint and is pruned by the next
  reservation, so continuous synchronization cannot grow minute buckets without bound.
- Normal-account checks must precede every service-role token read.
- Shop credentials remain on their existing isolated path.
- No credential may appear in a PostgREST URL filter.
- Broker and application logs record only stable error code/status/retry metadata.
- Legacy token columns remain compatibility debt. Do not grant broader access; plan their removal only after all old application instances are retired and production reads prove the secure tables are authoritative.

## Webhook decision

Do not enable comment webhooks in this release.

TikTok for Developers documents at-least-once webhooks for authorization and publishing events, but its documented event list does not provide the Business organic-comment contract used here. TikTok API for Business lists `/business/webhook/update/`, but this repository has not yet established and tested its comment event types, signature verification, replay key, tenant mapping, ordering, or reconciliation semantics.

Continue manual polling/synchronization as the source of truth. A later webhook phase must first capture the official Business webhook contract, implement raw-body verification and durable deduplication, acknowledge quickly, and treat events as sync triggers rather than authoritative replacements.

Official references:

- https://developers.tiktok.com/doc/webhooks-overview
- https://developers.tiktok.com/doc/webhooks-events
- https://business-api.tiktok.com/gateway/docs/index?doc_id=1735713875563521
