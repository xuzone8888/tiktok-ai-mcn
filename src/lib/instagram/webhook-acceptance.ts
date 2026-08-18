export const INSTAGRAM_WEBHOOK_ACCEPTANCE_PATH = '/api/instagram/webhook'

export type InstagramWebhookAcceptanceDecision = 'disabled' | 'allow' | 'not_found'

export function getInstagramWebhookAcceptanceDecision(
  flagValue: string | undefined,
  pathname: string
): InstagramWebhookAcceptanceDecision {
  if (flagValue !== 'true') return 'disabled'
  return pathname === INSTAGRAM_WEBHOOK_ACCEPTANCE_PATH ? 'allow' : 'not_found'
}
