import { NextRequest, NextResponse } from 'next/server'

import * as facebookOAuth from '@/lib/facebook/oauth'
import * as instagramOAuth from '@/lib/instagram/oauth'
import * as socialComments from '@/lib/social-comments/platform-api'
import * as youtubeOAuth from '@/lib/youtube/oauth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// fail-closed bearer，照搬 instagram/publish/process/route.ts 的 isAuthorized 模式。
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.BROKER_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

type BrokerPlatform = 'facebook' | 'youtube' | 'instagram'

type BrokerFn = (...args: unknown[]) => Promise<unknown>

// 闭合白名单：每家只暴露绑定/刷新真正需要的导出网络函数。broker 永不接受调用方传入任何 URL/host
//（只会用 oauth.ts 里写死的 5 个 Meta/Google 主机）。params 决定从 args 里按名取值并按位传参。
const OPS: Record<BrokerPlatform, Record<string, { fn: BrokerFn; params: string[] }>> = {
  facebook: {
    exchangeFacebookCodeForToken: { fn: facebookOAuth.exchangeFacebookCodeForToken as BrokerFn, params: ['code', 'codeVerifier'] },
    exchangeForLongLivedUserToken: { fn: facebookOAuth.exchangeForLongLivedUserToken as BrokerFn, params: ['accessToken'] },
    discoverMyFacebookPages: { fn: facebookOAuth.discoverMyFacebookPages as BrokerFn, params: ['userAccessToken'] },
    getMyFacebookPages: { fn: facebookOAuth.getMyFacebookPages as BrokerFn, params: ['userAccessToken'] },
    getFacebookUserInfo: { fn: facebookOAuth.getFacebookUserInfo as BrokerFn, params: ['userAccessToken'] },
    getFacebookPageInfo: { fn: facebookOAuth.getFacebookPageInfo as BrokerFn, params: ['pageId', 'pageAccessToken'] },
    subscribeFacebookPageToWebhooks: { fn: facebookOAuth.subscribeFacebookPageToWebhooks as BrokerFn, params: ['pageId', 'pageAccessToken'] },
    unsubscribeFacebookPageFromWebhooks: { fn: facebookOAuth.unsubscribeFacebookPageFromWebhooks as BrokerFn, params: ['pageId', 'pageAccessToken'] },
    refreshFacebookPageAccessToken: { fn: facebookOAuth.refreshFacebookPageAccessToken as BrokerFn, params: ['userAccessToken', 'pageId'] },
    revokeFacebookToken: { fn: facebookOAuth.revokeFacebookToken as BrokerFn, params: ['token'] },
    getFacebookGrantedPermissions: { fn: facebookOAuth.getFacebookGrantedPermissions as BrokerFn, params: ['userAccessToken'] },
    debugFacebookUserToken: { fn: facebookOAuth.debugFacebookUserToken as BrokerFn, params: ['userAccessToken'] },
    listFacebookComments: { fn: socialComments.listFacebookComments as BrokerFn, params: ['token', 'externalContentId'] },
    replyToFacebookComment: { fn: socialComments.replyToFacebookComment as BrokerFn, params: ['token', 'parentExternalCommentId', 'externalContentId', 'message'] },
  },
  youtube: {
    exchangeYouTubeCodeForToken: { fn: youtubeOAuth.exchangeYouTubeCodeForToken as BrokerFn, params: ['code', 'codeVerifier'] },
    refreshYouTubeAccessToken: { fn: youtubeOAuth.refreshYouTubeAccessToken as BrokerFn, params: ['refreshToken'] },
    revokeYouTubeToken: { fn: youtubeOAuth.revokeYouTubeToken as BrokerFn, params: ['token'] },
    getMyYouTubeChannel: { fn: youtubeOAuth.getMyYouTubeChannel as BrokerFn, params: ['accessToken'] },
    listYouTubeComments: { fn: socialComments.listYouTubeComments as BrokerFn, params: ['token', 'externalContentId'] },
    replyToYouTubeComment: { fn: socialComments.replyToYouTubeComment as BrokerFn, params: ['token', 'parentExternalCommentId', 'message'] },
  },
  instagram: {
    exchangeInstagramCodeForToken: { fn: instagramOAuth.exchangeInstagramCodeForToken as BrokerFn, params: ['code', 'codeVerifier'] },
    exchangeForLongLivedUserToken: { fn: instagramOAuth.exchangeForLongLivedUserToken as BrokerFn, params: ['accessToken'] },
    discoverMyInstagramAccounts: { fn: instagramOAuth.discoverMyInstagramAccounts as BrokerFn, params: ['userAccessToken'] },
    refreshInstagramAccountAccessToken: { fn: instagramOAuth.refreshInstagramAccountAccessToken as BrokerFn, params: ['userAccessToken', 'accountId'] },
    revokeInstagramToken: { fn: instagramOAuth.revokeInstagramToken as BrokerFn, params: ['token'] },
    getInstagramGrantedPermissions: { fn: instagramOAuth.getInstagramGrantedPermissions as BrokerFn, params: ['userAccessToken'] },
    debugInstagramUserToken: { fn: instagramOAuth.debugInstagramUserToken as BrokerFn, params: ['userAccessToken'] },
    listInstagramComments: { fn: socialComments.listInstagramComments as BrokerFn, params: ['token', 'externalContentId'] },
    replyToInstagramComment: { fn: socialComments.replyToInstagramComment as BrokerFn, params: ['token', 'parentExternalCommentId', 'externalContentId', 'message'] },
  },
}

function isPlatform(p: unknown): p is BrokerPlatform {
  return p === 'facebook' || p === 'youtube' || p === 'instagram'
}

export async function POST(request: NextRequest) {
  // 递归护栏：broker 永不该设 OAUTH_BROKER_URL，否则 oauth.ts 函数会再次委派 → 自调死循环。
  if (process.env.OAUTH_BROKER_URL && process.env.OAUTH_BROKER_URL.trim()) {
    return NextResponse.json({ ok: false, error: 'broker_misconfigured' }, { status: 500 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  let body: { platform?: unknown; op?: unknown; args?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  const { platform, op } = body
  const args = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, unknown>
  const entry = isPlatform(platform) && typeof op === 'string' ? OPS[platform][op] : undefined
  if (!entry) {
    return NextResponse.json({ ok: false, error: 'unknown_platform_or_op' }, { status: 400 })
  }

  const callArgs = entry.params.map((name) => args[name])
  try {
    const result = await entry.fn(...callArgs)
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const providerError = err && typeof err === 'object'
      ? err as {
          code?: unknown
          httpStatus?: unknown
          retryable?: unknown
          retryAfter?: unknown
        }
      : null
    const httpStatus =
      typeof providerError?.httpStatus === 'number'
        ? providerError.httpStatus
        : null
    // 只记 platform/op/httpStatus，绝不记 token/code/secret/body/message。
    console.error(`[oauth-broker] ${String(platform)}:${String(op)} failed httpStatus=${httpStatus}`)
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'oauth broker call failed',
        httpStatus,
        code: typeof providerError?.code === 'string' ? providerError.code : null,
        retryable: providerError?.retryable === true,
        retryAfter: typeof providerError?.retryAfter === 'string' || providerError?.retryAfter === null
          ? providerError.retryAfter
          : null,
      },
      { status: 200 },
    )
  }
}
