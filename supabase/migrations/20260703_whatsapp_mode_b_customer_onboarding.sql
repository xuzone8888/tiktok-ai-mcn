-- WhatsApp Mode B customer onboarding metadata.
-- Keeps whatsapp_business_accounts as the per-user WhatsApp channel table.

ALTER TABLE public.whatsapp_business_accounts
  ADD COLUMN IF NOT EXISTS business_portfolio_id TEXT,
  ADD COLUMN IF NOT EXISTS business_portfolio_name TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_mode TEXT NOT NULL DEFAULT 'local_env',
  ADD COLUMN IF NOT EXISTS webhook_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS webhook_last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS messaging_status TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS channel_label TEXT;

DO $$
BEGIN
  ALTER TABLE public.whatsapp_business_accounts
    ADD CONSTRAINT whatsapp_business_accounts_onboarding_mode_check
    CHECK (onboarding_mode IN ('embedded_signup', 'coexistence', 'manual', 'local_env'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.whatsapp_business_accounts
    ADD CONSTRAINT whatsapp_business_accounts_webhook_status_check
    CHECK (webhook_status IN ('unknown', 'mapped', 'verified', 'disabled', 'error'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.whatsapp_business_accounts
    ADD CONSTRAINT whatsapp_business_accounts_messaging_status_check
    CHECK (messaging_status IN ('unknown', 'ready', 'blocked', 'disabled'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

UPDATE public.whatsapp_business_accounts
SET onboarding_mode = CASE
    WHEN binding_source IN ('embedded_signup', 'facebook_login_for_business') THEN 'embedded_signup'
    WHEN binding_source = 'local_env' THEN 'local_env'
    ELSE onboarding_mode
  END,
  webhook_status = CASE
    WHEN status = 'active' AND phone_number_id IS NOT NULL THEN 'mapped'
    ELSE webhook_status
  END,
  messaging_status = CASE
    WHEN status = 'disabled' THEN 'disabled'
    ELSE messaging_status
  END
WHERE onboarding_mode = 'local_env'
  OR webhook_status = 'unknown'
  OR messaging_status = 'unknown';

CREATE INDEX IF NOT EXISTS idx_whatsapp_business_accounts_business_portfolio_id
  ON public.whatsapp_business_accounts(business_portfolio_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_business_accounts_onboarding_mode
  ON public.whatsapp_business_accounts(onboarding_mode);

COMMENT ON COLUMN public.whatsapp_business_accounts.business_portfolio_id IS 'Meta customer business / business portfolio id discovered during customer Embedded Signup.';
COMMENT ON COLUMN public.whatsapp_business_accounts.onboarding_mode IS 'Customer onboarding path: embedded_signup, coexistence, manual, or local_env.';
COMMENT ON COLUMN public.whatsapp_business_accounts.webhook_status IS 'Local webhook readiness for this WhatsApp channel. mapped means phone_number_id -> user_id routing is stored.';
COMMENT ON COLUMN public.whatsapp_business_accounts.messaging_status IS 'Local messaging readiness for this WhatsApp channel.';
