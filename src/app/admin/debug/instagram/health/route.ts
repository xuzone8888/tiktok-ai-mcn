import crypto from 'crypto'

import { NextResponse, type NextRequest } from 'next/server'

import { requireAdmin } from '@/lib/admin-auth'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type CheckStatus = 'PASS' | 'FAILED' | 'NOT_APPLICABLE'

interface FetchResult {
  ok: boolean
  status: number | null
  data: Record<string, unknown> | null
  reason: string | null
}

interface SubscriptionEntry {
  id: string | null
  subscribed_fields: string[]
}

const REQUEST_TIMEOUT_MS = 8_000

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item))
    : []
}

function safeReason(value: unknown, fallback: string): string {
  const raw = value instanceof Error ? value.message : typeof value === 'string' ? value : fallback
  return raw
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(access_token|token|secret|code)=\S+/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 240) || fallback
}

function providerReason(data: Record<string, unknown> | null, status: number | null): string {
  const error = data?.error
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const message = text((error as Record<string, unknown>).message)
    const code = text((error as Record<string, unknown>).code)
    if (message || code) return safeReason([code, message].filter(Boolean).join(': '), 'Provider rejected request')
  }
  return status ? `Provider request failed with HTTP ${status}` : 'Provider request failed before a response was received'
}

async function fetchJson(url: URL, token?: string): Promise<FetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    })
    let data: Record<string, unknown> | null = null
    try {
      const parsed: unknown = await response.json()
      data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } catch {
      return { ok: false, status: response.status, data: null, reason: 'Provider returned invalid JSON' }
    }
    return {
      ok: response.ok,
      status: response.status,
      data,
      reason: response.ok ? null : providerReason(data, response.status),
    }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError'
      ? `Provider request timed out after ${REQUEST_TIMEOUT_MS}ms`
      : safeReason(error, 'Provider network request failed')
    return { ok: false, status: null, data: null, reason }
  } finally {
    clearTimeout(timer)
  }
}

function parseSubscriptions(data: Record<string, unknown> | null): SubscriptionEntry[] {
  if (!Array.isArray(data?.data)) return []
  return data.data.flatMap((raw): SubscriptionEntry[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const row = raw as Record<string, unknown>
    return [{ id: text(row.id), subscribed_fields: stringArray(row.subscribed_fields) }]
  })
}

function scopeIsPresent(scopes: Set<string>, requested: string): boolean {
  if (scopes.has(requested)) return true
  if (requested === 'instagram_basic') return scopes.has('instagram_business_basic')
  if (requested === 'instagram_manage_comments') return scopes.has('instagram_business_manage_comments')
  return false
}

function envText(name: string): string | null {
  return text(process.env[name])
}

function webhookCallbackUrl(): string | null {
  const explicit = envText('INSTAGRAM_WEBHOOK_CALLBACK_URL')
  if (explicit) return explicit
  const supabaseUrl = envText('NEXT_PUBLIC_SUPABASE_URL')
  return supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/instagram-comments-webhook` : null
}

async function checkWebhook(callbackUrl: string | null, verifyToken: string | null) {
  if (!callbackUrl) return { status: 'FAILED' as const, verified: false, reason: 'Webhook callback URL is not configured' }
  if (!verifyToken) return { status: 'FAILED' as const, verified: false, reason: 'INSTAGRAM_WEBHOOK_VERIFY_TOKEN is not configured' }
  let url: URL
  try {
    url = new URL(callbackUrl)
    if (url.protocol !== 'https:') throw new Error('not_https')
  } catch {
    return { status: 'FAILED' as const, verified: false, reason: 'Webhook callback URL is not valid HTTPS' }
  }
  const challenge = `health-${crypto.randomUUID()}`
  url.searchParams.set('hub.mode', 'subscribe')
  url.searchParams.set('hub.verify_token', verifyToken)
  url.searchParams.set('hub.challenge', challenge)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { redirect: 'manual', cache: 'no-store', signal: controller.signal })
    const body = (await response.text()).slice(0, 128)
    if (response.status === 200 && body === challenge) {
      return { status: 'PASS' as const, verified: true, reason: null }
    }
    return {
      status: 'FAILED' as const,
      verified: false,
      reason: `Webhook verification returned HTTP ${response.status} without the expected challenge`,
    }
  } catch (error) {
    return {
      status: 'FAILED' as const,
      verified: false,
      reason: error instanceof Error && error.name === 'AbortError'
        ? `Webhook verification timed out after ${REQUEST_TIMEOUT_MS}ms`
        : safeReason(error, 'Webhook verification request failed'),
    }
  } finally {
    clearTimeout(timer)
  }
}

function reportLine(label: string, status: CheckStatus) {
  return `${status === 'PASS' ? '✅' : status === 'FAILED' ? '❌' : '➖'} ${label}: ${status}`
}

export async function GET(_request: NextRequest) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error

  const errors: Array<{ check: string; reason: string }> = []
  const addError = (check: string, reason: string) => errors.push({ check, reason })
  const admin = createAdminClient() as any
  const authMode = process.env.INSTAGRAM_AUTH_MODE === 'instagram' ? 'instagram' : 'facebook'
  const version = envText('INSTAGRAM_API_VERSION') || envText('FACEBOOK_API_VERSION') || 'v25.0'
  const graphFacebook = `https://graph.facebook.com/${version}`
  const graphInstagram = `https://graph.instagram.com/${version}`
  const oauthClientId = authMode === 'instagram'
    ? envText('INSTAGRAM_NATIVE_CLIENT_ID') || envText('INSTAGRAM_CLIENT_ID') || envText('FACEBOOK_CLIENT_ID')
    : envText('INSTAGRAM_CLIENT_ID') || envText('FACEBOOK_CLIENT_ID')
  const oauthClientSecret = authMode === 'instagram'
    ? envText('INSTAGRAM_NATIVE_CLIENT_SECRET') || envText('INSTAGRAM_CLIENT_SECRET') || envText('FACEBOOK_CLIENT_SECRET')
    : envText('INSTAGRAM_CLIENT_SECRET') || envText('FACEBOOK_CLIENT_SECRET')

  const accountResult = await admin
    .from('instagram_accounts')
    .select('id,user_id,channel_id,channel_title,channel_handle,status,scopes,access_token_expires_at,updated_at')
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(2)
  const accounts = Array.isArray(accountResult.data) ? accountResult.data : []
  const account = accounts[0] ?? null
  if (accountResult.error) addError('Instagram Account', `Database query failed: ${safeReason(accountResult.error.message, 'database error')}`)
  if (accounts.length === 0) addError('Instagram Account', 'No active Instagram account exists in the test environment')
  if (accounts.length > 1) addError('Instagram Account', 'More than one active Instagram account exists; health target is ambiguous')

  const tokenResult = account
    ? await admin.from('instagram_account_tokens').select('access_token,refresh_token,access_token_expires_at').eq('account_id', account.id).maybeSingle()
    : { data: null, error: null }
  const tokenRow = tokenResult.data ?? null
  if (tokenResult.error) addError('OAuth Token', `Token database query failed: ${safeReason(tokenResult.error.message, 'database error')}`)
  if (account && !tokenRow?.access_token) addError('OAuth Token', 'No access token is stored for the active Instagram account')

  let debugResult: FetchResult = { ok: false, status: null, data: null, reason: 'OAuth app credentials or access token are missing' }
  if (oauthClientId && oauthClientSecret && tokenRow?.access_token) {
    const url = new URL(`${graphFacebook}/debug_token`)
    url.searchParams.set('input_token', tokenRow.access_token)
    url.searchParams.set('access_token', `${oauthClientId}|${oauthClientSecret}`)
    debugResult = await fetchJson(url)
  }
  const debugData = debugResult.data?.data && typeof debugResult.data.data === 'object' && !Array.isArray(debugResult.data.data)
    ? debugResult.data.data as Record<string, unknown>
    : null
  const tokenIsValid = debugData?.is_valid === true
  const tokenScopes = new Set(stringArray(debugData?.scopes))
  if (!debugResult.ok) addError('OAuth Token', debugResult.reason || 'debug_token failed')
  else if (!tokenIsValid) addError('OAuth Token', 'debug_token returned is_valid=false')

  const requestedScopes = ['instagram_basic', 'instagram_manage_comments']
  const missingScopes = requestedScopes.filter((scope) => !scopeIsPresent(tokenScopes, scope))
  if (missingScopes.length) addError('Scopes', `Missing Scope: ${missingScopes.join(', ')}`)

  let pageId: string | null = null
  let businessAccountId: string | null = account?.channel_id ?? null
  let businessStatus: CheckStatus = account ? 'PASS' : 'FAILED'
  let businessReason: string | null = account ? null : 'Instagram Business Account NOT FOUND'
  if (authMode === 'facebook' && tokenRow?.refresh_token) {
    const pagesUrl = new URL(`${graphFacebook}/me/accounts`)
    pagesUrl.searchParams.set('fields', 'id')
    const pagesResult = await fetchJson(pagesUrl, tokenRow.refresh_token)
    const pages = Array.isArray(pagesResult.data?.data) ? pagesResult.data.data.slice(0, 25) : []
    businessAccountId = null
    for (const raw of pages) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const candidatePageId = text((raw as Record<string, unknown>).id)
      if (!candidatePageId) continue
      const pageUrl = new URL(`${graphFacebook}/${encodeURIComponent(candidatePageId)}`)
      pageUrl.searchParams.set('fields', 'instagram_business_account')
      const pageResult = await fetchJson(pageUrl, tokenRow.refresh_token)
      const iba = pageResult.data?.instagram_business_account
      const ibaId = iba && typeof iba === 'object' && !Array.isArray(iba)
        ? text((iba as Record<string, unknown>).id)
        : null
      if (ibaId && (!account?.channel_id || ibaId === account.channel_id)) {
        pageId = candidatePageId
        businessAccountId = ibaId
        break
      }
    }
    businessStatus = businessAccountId ? 'PASS' : 'FAILED'
    businessReason = businessAccountId ? null : pagesResult.reason || 'Instagram Business Account NOT FOUND'
  }
  if (businessStatus === 'FAILED') addError('Business Account', businessReason || 'Instagram Business Account NOT FOUND')

  let userResult: FetchResult = { ok: false, status: null, data: null, reason: 'Instagram user ID or token is missing' }
  if (businessAccountId && tokenRow?.access_token) {
    const host = authMode === 'instagram' ? graphInstagram : graphFacebook
    const userUrl = new URL(`${host}/${encodeURIComponent(businessAccountId)}`)
    userUrl.searchParams.set('fields', 'id,username,profile_picture_url')
    userResult = await fetchJson(userUrl, tokenRow.access_token)
  }
  const profileExists = userResult.ok && Boolean(text(userResult.data?.id))
  if (!profileExists) addError('Instagram User', userResult.reason || 'Instagram user profile was not returned')

  let subscriptionResult: FetchResult = { ok: false, status: null, data: null, reason: 'Instagram user ID or token is missing' }
  if (businessAccountId && tokenRow?.access_token) {
    const host = authMode === 'instagram' ? graphInstagram : graphFacebook
    subscriptionResult = await fetchJson(
      new URL(`${host}/${encodeURIComponent(businessAccountId)}/subscribed_apps`),
      tokenRow.access_token,
    )
  }
  const subscriptions = parseSubscriptions(subscriptionResult.data)
  const subscribedFields = new Set(subscriptions.flatMap((entry) => entry.subscribed_fields))
  const commentsSubscribed = subscribedFields.has('comments')
  if (!subscriptionResult.ok) addError('Account Subscription', subscriptionResult.reason || 'subscribed_apps request failed')
  else if (!commentsSubscribed) addError('Account Subscription', 'Instagram Account NOT subscribed to comments')

  const currentMetaAppId = envText('INSTAGRAM_META_APP_ID') || envText('META_APP_ID') || envText('FACEBOOK_APP_ID')
  const webhookConfigAppId = envText('INSTAGRAM_WEBHOOK_APP_ID') || envText('INSTAGRAM_NATIVE_CLIENT_ID') || envText('INSTAGRAM_CLIENT_ID')
  const oauthTokenAppId = text(debugData?.app_id)
  const subscribedAppId = subscriptions.find((entry) => entry.subscribed_fields.includes('comments'))?.id || subscriptions[0]?.id || null
  const appIds = [currentMetaAppId, webhookConfigAppId, oauthTokenAppId, subscribedAppId]
  const appIdMissing = appIds.some((value) => !value)
  const appIdMismatch = !appIdMissing && new Set(appIds as string[]).size !== 1
  if (appIdMissing) addError('App ID Consistency', 'One or more App IDs are not available; configure INSTAGRAM_META_APP_ID and INSTAGRAM_WEBHOOK_APP_ID explicitly')
  else if (appIdMismatch) addError('App ID Consistency', 'App ID Mismatch')

  const callbackUrl = webhookCallbackUrl()
  const verifyToken = envText('INSTAGRAM_WEBHOOK_VERIFY_TOKEN')
  const webhook = await checkWebhook(callbackUrl, verifyToken)
  if (!webhook.verified) addError('Webhook Verified', webhook.reason || 'Webhook verification failed')

  const receiptsResult = await admin
    .from('webhook_receipts')
    .select('received_at,provider,status,step,signature_valid,body_length,http_status,error_code,metadata')
    .eq('provider', 'instagram')
    .order('received_at', { ascending: false })
    .limit(20)
  const receipts = Array.isArray(receiptsResult.data) ? receiptsResult.data : []
  const since = Date.now() - 24 * 60 * 60 * 1000
  const receiptCount24h = receipts.filter((row: any) => {
    const time = Date.parse(row.received_at)
    return Number.isFinite(time) && time >= since
  }).length
  if (receiptsResult.error) addError('Webhook Receipt', `Receipt query failed: ${safeReason(receiptsResult.error.message, 'database error')}`)
  else if (receiptCount24h === 0) addError('Webhook Receipt', '最近 24 小时 0 条 Instagram Receipt：Meta 从未请求我们的 Callback')

  const commentsResult = await admin
    .from('social_comments')
    .select('external_comment_id,external_content_id,author_name,remote_created_at,created_at,task_item_id,status,metadata')
    .eq('user_id', account?.user_id ?? auth.user.id)
    .eq('platform', 'instagram')
    .order('created_at', { ascending: false })
    .limit(20)
  const comments = Array.isArray(commentsResult.data) ? commentsResult.data : []
  if (commentsResult.error) addError('Comment Storage', `Comment query failed: ${safeReason(commentsResult.error.message, 'database error')}`)
  else if (comments.length === 0) addError('Comment Storage', 'No Instagram Comments Stored')

  const checks: Record<string, CheckStatus> = {
    oauth_token: tokenIsValid ? 'PASS' : 'FAILED',
    scopes: missingScopes.length === 0 && tokenIsValid ? 'PASS' : 'FAILED',
    instagram_account: account && accounts.length === 1 ? 'PASS' : 'FAILED',
    business_account: businessStatus,
    instagram_user: profileExists ? 'PASS' : 'FAILED',
    webhook_verified: webhook.status,
    account_subscription: subscriptionResult.ok && commentsSubscribed ? 'PASS' : 'FAILED',
    app_id_consistency: !appIdMissing && !appIdMismatch ? 'PASS' : 'FAILED',
    webhook_receipt: !receiptsResult.error && receiptCount24h > 0 ? 'PASS' : 'FAILED',
    comment_storage: !commentsResult.error && comments.length > 0 ? 'PASS' : 'FAILED',
  }
  const overall = Object.values(checks).every((status) => status === 'PASS') ? 'PASS' : 'FAILED'

  const likelyCauses: string[] = []
  if (!commentsSubscribed) likelyCauses.push('Instagram Account 未正确订阅 comments。')
  if (receiptCount24h === 0) likelyCauses.push('Meta 没有向 Callback 推送事件。')
  const latestReceipt = receipts[0] as any
  if (latestReceipt?.status === 'rejected') likelyCauses.push(`Webhook 请求在 ${latestReceipt.step} 阶段被拒绝。`)
  if (latestReceipt?.status === 'failed') likelyCauses.push(`Webhook 已到达，但在 ${latestReceipt.step} 阶段失败。`)
  if (latestReceipt?.status === 'processed' && comments.length === 0) likelyCauses.push('Webhook 已通过签名和解析，但映射或入库没有产生评论。')
  if (appIdMismatch) likelyCauses.push('OAuth、Webhook 或账号订阅使用了不同 App ID。')

  const recommendations: string[] = []
  if (!commentsSubscribed) recommendations.push('使用当前账号 Token 订阅 subscribed_fields=[comments]，然后用一条新评论验证。')
  if (receiptCount24h === 0 && commentsSubscribed) recommendations.push('在 Meta 控制台确认 App 已发布/Live、comments 字段已订阅，并用新事件验证。')
  if (latestReceipt?.status === 'rejected') recommendations.push('根据 Receipt step/error_code 修复 Callback 或签名配置，无需修改评论解析。')
  if (latestReceipt?.status === 'processed' && comments.length === 0) recommendations.push('对照 Receipt 中的 mapped/saved/ignored 计数检查账号、媒体和任务归属。')
  if (appIdMismatch || appIdMissing) recommendations.push('统一 Current Meta App、Webhook、OAuth Token 和 subscribed_apps 的 App ID 配置。')

  const report = [
    '========================',
    'Instagram Health Report',
    '========================',
    reportLine('OAuth Token', checks.oauth_token),
    reportLine('Scopes', checks.scopes),
    reportLine('Instagram Account', checks.instagram_account),
    reportLine('Business Account', checks.business_account),
    reportLine('Webhook Verified', checks.webhook_verified),
    reportLine('Account Subscription', checks.account_subscription),
    reportLine('Webhook Receipt', checks.webhook_receipt),
    reportLine('Comment Storage', checks.comment_storage),
    '',
    `Overall Result: ${overall}`,
    '========================',
  ].join('\n')

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    auth_mode: authMode,
    target: { active_account_count: accounts.length },
    access_token: {
      status: checks.oauth_token,
      is_valid: tokenIsValid,
      expires_at: debugData?.expires_at ?? tokenRow?.access_token_expires_at ?? null,
      scopes: [...tokenScopes],
      app_id: oauthTokenAppId,
      user_id: text(debugData?.user_id),
      reason: checks.oauth_token === 'FAILED' ? errors.find((item) => item.check === 'OAuth Token')?.reason : null,
    },
    scope_check: {
      status: checks.scopes,
      required: requestedScopes,
      aliases: {
        instagram_basic: 'instagram_business_basic',
        instagram_manage_comments: 'instagram_business_manage_comments',
      },
      missing: missingScopes,
    },
    business_account: {
      status: checks.business_account,
      page_id: pageId,
      instagram_business_id: businessAccountId,
      reason: authMode === 'instagram'
        ? 'NOT_APPLICABLE: Instagram Native Login does not use Facebook Page /me/accounts'
        : businessReason,
    },
    instagram_user: {
      status: checks.instagram_user,
      id: text(userResult.data?.id),
      username: text(userResult.data?.username),
      profile_exists: profileExists,
      profile_picture_exists: Boolean(text(userResult.data?.profile_picture_url)),
      reason: profileExists ? null : userResult.reason,
    },
    account_subscription: {
      status: checks.account_subscription,
      subscribed_apps: subscriptions,
      fields: {
        comments: subscribedFields.has('comments'),
        mentions: subscribedFields.has('mentions'),
        messages: subscribedFields.has('messages'),
      },
      reason: commentsSubscribed ? null : subscriptionResult.reason || 'Instagram Account NOT subscribed to comments',
    },
    app_ids: {
      status: checks.app_id_consistency,
      current_meta_app_id: currentMetaAppId,
      webhook_config_app_id: webhookConfigAppId,
      oauth_token_app_id: oauthTokenAppId,
      subscribed_app_id: subscribedAppId,
      mismatch: appIdMismatch,
      missing: appIdMissing,
      reason: appIdMismatch ? 'App ID Mismatch' : appIdMissing ? 'One or more App IDs are unavailable' : null,
    },
    webhook: {
      status: checks.webhook_verified,
      callback_url: callbackUrl,
      verify_token: verifyToken ? 'CONFIGURED' : 'MISSING',
      verified: webhook.verified,
      reason: webhook.reason,
    },
    webhook_receipts: {
      status: checks.webhook_receipt,
      count_24h: receiptCount24h,
      message: receiptCount24h === 0 ? 'Meta 从未请求我们的 Callback' : null,
      recent: receipts,
    },
    comments: {
      status: checks.comment_storage,
      message: comments.length === 0 ? 'No Instagram Comments Stored' : null,
      recent: comments.map((row: any) => ({
        comment_id: row.external_comment_id,
        media_id: row.external_content_id,
        author: row.author_name,
        created_time: row.remote_created_at || row.created_at,
        task_id: row.task_item_id,
        status: row.status,
      })),
    },
    checks,
    errors,
    diagnosis: {
      most_likely_causes: likelyCauses.length ? likelyCauses : ['No failing layer was detected.'],
      recommended_next_steps: recommendations.length ? recommendations : ['No corrective action is required.'],
    },
    overall_result: overall,
    report,
  }, { status: 200 })
}
