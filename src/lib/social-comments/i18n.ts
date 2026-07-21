export type SocialCommentLang = 'zh' | 'en'

const API_MESSAGES: Record<string, Record<SocialCommentLang, string>> = {
  unauthorized: {
    zh: '请先登录',
    en: 'Please sign in first.',
  },
  invalid_platform: {
    zh: '平台参数无效',
    en: 'Invalid platform.',
  },
  invalid_request: {
    zh: '请求参数无效',
    en: 'Invalid request.',
  },
  account_not_found: {
    zh: '账号不存在或无权访问',
    en: 'Account not found or not accessible.',
  },
  account_not_active: {
    zh: '账号当前不可用，请重新授权后再试',
    en: 'The account is inactive. Reconnect it before trying again.',
  },
  content_not_found: {
    zh: '内容不存在或无权访问',
    en: 'Content not found or not accessible.',
  },
  comment_not_found: {
    zh: '评论不存在或无权访问',
    en: 'Comment not found or not accessible.',
  },
  token_missing: {
    zh: '授权令牌不存在，请重新绑定账号',
    en: 'Authorization token is missing. Please reconnect the account.',
  },
  missing_comment_scope: {
    zh: '账号缺少评论权限，请重新绑定并授予最新评论 OAuth scope',
    en: 'The account is missing comment permissions. Reconnect it with the latest OAuth scopes.',
  },
  unsupported_platform_operation: {
    zh: '该平台的当前官方账号 API 不支持此评论操作',
    en: 'The current official account API for this platform does not support this comment operation.',
  },
  needs_verification: {
    zh: '该平台的评论接口仍需验证，当前暂不开放同步或回复',
    en: 'Comment sync or reply for this platform still needs verification and is disabled for now.',
  },
  empty_reply: {
    zh: '回复内容不能为空',
    en: 'Reply message cannot be empty.',
  },
  reply_too_long: {
    zh: '回复内容不能超过 2000 个字符',
    en: 'Reply message cannot exceed 2000 characters.',
  },
  cannot_reply: {
    zh: '当前账号无法回复这条评论',
    en: 'The current account cannot reply to this comment.',
  },
  reply_disabled: {
    zh: 'Instagram 评论回复尚未开放',
    en: 'Instagram comment replies are not enabled yet.',
  },
  missing_idempotency_key: {
    zh: '缺少回复幂等键，请刷新后重试',
    en: 'Reply idempotency key is required. Refresh and try again.',
  },
  invalid_idempotency_key: {
    zh: '回复幂等键格式无效',
    en: 'Invalid reply idempotency key.',
  },
  duplicate_request_running: {
    zh: '相同回复请求正在处理中，请稍后查看结果',
    en: 'The same reply request is already running. Check again shortly.',
  },
  duplicate_request_sent: {
    zh: '相同回复请求已经完成',
    en: 'The same reply request has already completed.',
  },
  duplicate_request_failed: {
    zh: '相同回复请求已有终态，请使用新的请求重试',
    en: 'The same reply request already has a terminal status. Retry with a new request.',
  },
  idempotency_key_conflict: {
    zh: '该幂等键已用于另一条回复请求，请使用新的请求重试',
    en: 'This idempotency key was already used for another reply request. Retry with a new key.',
  },
  reply_throttled: {
    zh: '回复过于频繁，请稍后再试',
    en: 'Please wait before replying to this comment again.',
  },
  sync_already_running: {
    zh: '相同同步任务正在处理中，请稍后查看结果',
    en: 'The same sync is already running. Check again shortly.',
  },
  sync_throttled: {
    zh: '同步过于频繁，请稍后再试',
    en: 'Sync was requested too recently. Please wait before trying again.',
  },
  provider_unreachable: {
    zh: '海外平台接口暂时无法连接，请稍后重试。',
    en: 'The overseas platform API is temporarily unreachable. Please try again shortly.',
  },
  internal_error: {
    zh: '服务器错误',
    en: 'Server error.',
  },
}

export function getRequestLang(headers: Headers): SocialCommentLang {
  const explicit = headers.get('x-toryx-lang')
  if (explicit === 'en' || explicit === 'zh') return explicit
  const acceptLanguage = headers.get('accept-language') || ''
  return acceptLanguage.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export function getApiMessage(code: string, fallback: string, lang: SocialCommentLang): string {
  return API_MESSAGES[code]?.[lang] || fallback || API_MESSAGES.internal_error[lang]
}
