# Facebook Webhook runtime readiness — 2026-09-17

## Evidence and limits

- The production callback was switched to project `hfabrifuvujpdzarlbky` and Meta's GET verification succeeded.
- Production received signed POSTs at 06:30:49 and 06:31:20 UTC, returning HTTP 500 (`webhook_processing_failed`). The test comment was not found in saved comments.
- The dashboard reports no active new secret API keys. The deployed configuration resolver rejects an empty `SUPABASE_SECRET_KEYS` map even when the legacy service-role key works for receipt logging.
- An empty runtime map is a hypothesis consistent with this evidence, not a directly observed runtime value. Do not report the incident resolved until a real signed comment is saved.

## Scoped change

Only the Facebook handler treats a valid, empty JSON object as unprovisioned new keys and falls back to the existing service-role key. Missing new-key configuration retains existing fallback behavior. Nonempty incomplete maps, invalid JSON, arrays, null and blank values still fail closed. No keys are generated or rotated; Instagram behavior is unchanged.

Failures now include an allowlisted `reason` in internal logs and receipt metadata. Unknown exceptions use `unclassified_processing_error`. Do not log raw exceptions, credentials or comment payloads. Public error codes remain unchanged.

## Release gate

1. Review and merge through the Facebook-only branch; no direct main push.
2. Deploy only `facebook-comments-webhook` to the production project after explicit approval, preserving its existing secrets and signature verification. A web-app deployment alone does not update this function.
3. Check bundled imports: the dashboard version uses `instagram-core.ts`, while repository imports use the Deno import map. Do not deploy stale bundled code. Do not deploy the Instagram function.
4. Add a fresh uniquely named comment to a video published through the application, without triggering manual comment sync.
5. Verify a signed POST returning 200, `saved_count > 0`, and the matching saved comment with `metadata.source = webhook`. Test each Page separately.
6. If HTTP 500 persists, inspect only the sanitized `reason`; do not repeatedly rebind Pages or reset secrets. Preserve the previous function artifact for rollback.

Frontend auto-refresh is separate and is not included in this patch.
