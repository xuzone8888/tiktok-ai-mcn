-- WhatsApp Business account binding
-- Adds merchant-side Embedded Signup / Facebook Login for Business storage.
-- Keeps whatsapp_business_accounts as the phone_number_id -> user_id mapping
-- used by Inbox webhook ownership.

CREATE TABLE IF NOT EXISTS public.whatsapp_auth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_verifier TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'expired')),
  error_code TEXT,
  error_message TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_states_state
  ON public.whatsapp_auth_states(state);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_states_user_created
  ON public.whatsapp_auth_states(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_states_pending_expiry
  ON public.whatsapp_auth_states(status, expires_at);

ALTER TABLE public.whatsapp_business_accounts
  ADD COLUMN IF NOT EXISTS business_account_name TEXT,
  ADD COLUMN IF NOT EXISTS binding_source TEXT NOT NULL DEFAULT 'local_env'
    CHECK (binding_source IN ('embedded_signup', 'facebook_login_for_business', 'local_env')),
  ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_whatsapp_business_accounts_business_account_id
  ON public.whatsapp_business_accounts(business_account_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_business_accounts_status
  ON public.whatsapp_business_accounts(status);

CREATE TABLE IF NOT EXISTS public.whatsapp_business_account_tokens (
  account_id UUID PRIMARY KEY REFERENCES public.whatsapp_business_accounts(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  token_type TEXT,
  scopes JSONB NOT NULL DEFAULT '[]',
  access_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_business_account_tokens_expires_at
  ON public.whatsapp_business_account_tokens(access_token_expires_at);

ALTER TABLE public.whatsapp_auth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_business_account_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.whatsapp_auth_states IS 'Service-role-only OAuth state storage for WhatsApp Business Embedded Signup.';
COMMENT ON TABLE public.whatsapp_business_account_tokens IS 'Service-role-only WhatsApp Business token storage. No user RLS policies are granted.';
COMMENT ON COLUMN public.whatsapp_business_accounts.binding_source IS 'How this WhatsApp business phone mapping was created: embedded signup, Facebook Login for Business, or local env fallback.';
