export const IMAGE_FACTORY_UPGRADING_MESSAGE = "商图精修正在升级中";
export const WHATSAPP_INBOX_DISABLED_MESSAGE = "WhatsApp Inbox is disabled.";

function isEnabledFlag(value: string | undefined): boolean {
  return value === "true";
}

export function isImageFactoryEnabled(): boolean {
  return isEnabledFlag(process.env.IMAGE_FACTORY_ENABLED);
}

export function isImageFactoryUiEnabled(): boolean {
  return isEnabledFlag(process.env.NEXT_PUBLIC_IMAGE_FACTORY_ENABLED);
}

export function isLinkedInPublishEnabledServer(): boolean {
  return isEnabledFlag(process.env.LINKEDIN_PUBLISH_ENABLED);
}

export function isLinkedInPublishEnabled(): boolean {
  return isEnabledFlag(process.env.NEXT_PUBLIC_LINKEDIN_PUBLISH_ENABLED);
}

export function isWhatsAppInboxEnabledServer(): boolean {
  return isEnabledFlag(process.env.WHATSAPP_INBOX_ENABLED);
}

export function isWhatsAppInboxEnabled(): boolean {
  return isEnabledFlag(process.env.NEXT_PUBLIC_WHATSAPP_INBOX_ENABLED);
}
