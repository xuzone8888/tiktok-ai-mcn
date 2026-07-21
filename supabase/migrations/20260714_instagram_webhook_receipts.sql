-- Safe webhook observability. Stores transport metadata only; never payloads,
-- headers, tokens, signatures, usernames, comment text, or provider IDs.

CREATE TABLE IF NOT EXISTS public.webhook_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL CHECK (provider IN ('instagram')),
  status TEXT NOT NULL CHECK (status IN ('rejected', 'failed', 'processed')),
  step TEXT NOT NULL CHECK (step IN ('body', 'configuration', 'signature', 'encoding', 'json', 'processing', 'completed')),
  signature_valid BOOLEAN,
  body_length INTEGER CHECK (body_length IS NULL OR body_length >= 0),
  http_status INTEGER NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  error_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_receipts_provider_received
  ON public.webhook_receipts(provider, received_at DESC);

ALTER TABLE public.webhook_receipts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.webhook_receipts IS
  'Safe webhook transport diagnostics. Payloads, raw signatures, tokens and provider identifiers are intentionally excluded.';
COMMENT ON COLUMN public.webhook_receipts.signature_valid IS
  'Whether the provider signature verified; the signature value is never stored.';
COMMENT ON COLUMN public.webhook_receipts.metadata IS
  'Allowlisted numeric processing counters only.';
