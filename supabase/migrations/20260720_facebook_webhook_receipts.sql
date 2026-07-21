-- Extend the safe webhook transport receipt allowlist for Facebook Page events.
-- Payloads, signatures, tokens, provider IDs and comment text remain excluded.

ALTER TABLE public.webhook_receipts
  DROP CONSTRAINT IF EXISTS webhook_receipts_provider_check;

ALTER TABLE public.webhook_receipts
  ADD CONSTRAINT webhook_receipts_provider_check
  CHECK (provider IN ('instagram', 'facebook'));
