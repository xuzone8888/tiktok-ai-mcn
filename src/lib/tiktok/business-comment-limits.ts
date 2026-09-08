export interface TikTokCommentReadLimits {
  perEndpointRequestsPerMinute: number
  topLevelRequestBudget: number
  replyRequestBudget: number
}

function strictPositiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!/^[1-9]\d*$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : fallback
}

export function getTikTokCommentReadLimits(
  env: NodeJS.ProcessEnv = process.env,
): TikTokCommentReadLimits {
  const perEndpointRequestsPerMinute = strictPositiveInteger(
    env.TIKTOK_BUSINESS_READ_QPM_PER_ACCOUNT,
    20,
    10000,
  )
  return {
    perEndpointRequestsPerMinute,
    topLevelRequestBudget: Math.min(
      strictPositiveInteger(env.TIKTOK_COMMENT_TOP_LEVEL_CALL_BUDGET, 5, 100),
      perEndpointRequestsPerMinute,
    ),
    replyRequestBudget: Math.min(
      strictPositiveInteger(env.TIKTOK_COMMENT_REPLY_CALL_BUDGET, 15, 100),
      perEndpointRequestsPerMinute,
    ),
  }
}
