import { isWhatsAppInboxEnabledServer } from "@/lib/feature-flags"

import { WhatsAppInboxDisabledPage, WhatsAppInboxEnabledPage } from "./whatsapp-inbox-client"

export default function WhatsAppInboxPage() {
  return isWhatsAppInboxEnabledServer() ? <WhatsAppInboxEnabledPage /> : <WhatsAppInboxDisabledPage />
}
