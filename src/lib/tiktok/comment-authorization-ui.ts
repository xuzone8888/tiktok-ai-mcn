export type TikTokCommentAuthorizationStatus =
  | 'active'
  | 'not_connected'
  | 'expired'
  | 'incomplete'
  | 'disconnecting'

export function hasTikTokCommentAuthorization(
  status: TikTokCommentAuthorizationStatus,
): boolean {
  return status !== 'not_connected'
}

export function canDisconnectTikTokCommentAuthorization(
  status: TikTokCommentAuthorizationStatus,
): boolean {
  return status === 'active' || status === 'expired' || status === 'incomplete'
}
