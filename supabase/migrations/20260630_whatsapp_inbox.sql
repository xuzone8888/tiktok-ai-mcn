-- WhatsApp Business Cloud API Inbox
-- Independent customer messaging module. Not part of social publishing queues.

CREATE TABLE IF NOT EXISTS public.whatsapp_business_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number_id TEXT NOT NULL,
  business_account_id TEXT,
  display_phone_number TEXT,
  verified_name TEXT,
  source_platform TEXT NOT NULL DEFAULT 'whatsapp_cloud',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(phone_number_id),
  UNIQUE(user_id, phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_business_accounts_user_id
  ON public.whatsapp_business_accounts(user_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  wa_id TEXT NOT NULL,
  display_name TEXT,
  country TEXT,
  source_platform TEXT NOT NULL DEFAULT 'whatsapp_cloud',
  last_message_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'archived')),
  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, wa_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_user_last_message
  ON public.whatsapp_contacts(user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INT NOT NULL DEFAULT 0,
  assigned_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_user_last_message
  ON public.whatsapp_conversations(user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_contact_id
  ON public.whatsapp_conversations(contact_id);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  whatsapp_message_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  media_url TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'received')),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, whatsapp_message_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_contact_created
  ON public.whatsapp_messages(contact_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_user_created
  ON public.whatsapp_messages(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_whatsapp_message_id
  ON public.whatsapp_messages(whatsapp_message_id);

ALTER TABLE public.whatsapp_business_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own WhatsApp business accounts"
  ON public.whatsapp_business_accounts;
DROP POLICY IF EXISTS "Users can view their own WhatsApp business accounts"
  ON public.whatsapp_business_accounts;
DROP POLICY IF EXISTS "Users can manage their own WhatsApp contacts"
  ON public.whatsapp_contacts;
DROP POLICY IF EXISTS "Users can manage their own WhatsApp conversations"
  ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "Users can manage their own WhatsApp messages"
  ON public.whatsapp_messages;

CREATE POLICY "Users can view their own WhatsApp business accounts"
  ON public.whatsapp_business_accounts
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own WhatsApp contacts"
  ON public.whatsapp_contacts
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their own WhatsApp conversations"
  ON public.whatsapp_conversations
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their own WhatsApp messages"
  ON public.whatsapp_messages
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.whatsapp_business_accounts IS 'Maps WhatsApp Cloud API phone number IDs to application users for webhook ownership.';
COMMENT ON TABLE public.whatsapp_contacts IS 'WhatsApp customer contacts for Inbox conversations.';
COMMENT ON TABLE public.whatsapp_conversations IS 'WhatsApp Inbox conversation state.';
COMMENT ON TABLE public.whatsapp_messages IS 'Inbound and outbound WhatsApp customer messages.';
