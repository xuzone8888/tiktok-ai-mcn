import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import {
  isSocialCommentPlatformEnabled,
  isSocialCommentsApiEnabled,
} from '@/lib/social-comments/feature-flag'
import { getApiMessage, getRequestLang } from '@/lib/social-comments/i18n'
import {
  mapSocialCommentError,
  syncRecentSocialComments,
  syncSocialComments,
} from '@/lib/social-comments/service'
import {
  isSocialCommentSyncTargetValid,
  normalizeSocialCommentContentId,
} from '@/lib/social-comments/sync-request'
import { isSocialPlatform } from '@/lib/social-comments/types'

export const dynamic = 'force-dynamic'

function isRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function POST(request: NextRequest) {
  if (!isSocialCommentsApiEnabled()) {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }

  const lang = getRequestLang(request.headers)

  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return NextResponse.json({ error: getApiMessage('unauthorized', 'Unauthorized', lang), code: 'unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null) as unknown
    if (!isRequestObject(body)) {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }

    if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== 'string') {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined
    if (body.source !== undefined && body.source !== 'manual' && body.source !== 'auto') {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }
    const source = body.source === 'auto' ? 'auto' : 'manual'

    const platform = typeof body.platform === 'string' ? body.platform : ''
    const accountId = typeof body.accountId === 'string' ? body.accountId : ''
    const contentId = normalizeSocialCommentContentId(body.contentId)

    if (!platform || !isSocialPlatform(platform) || !accountId) {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }
    if (!isSocialCommentPlatformEnabled(platform)) {
      return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
    }
    if (!isSocialCommentSyncTargetValid(platform, source, contentId)) {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }

    if (contentId) {
      const result = await syncSocialComments(user.id, {
        platform,
        accountId,
        contentId,
      }, {
        idempotencyKey,
        source,
      })
      return NextResponse.json({ ...result, mode: 'single' })
    }

    const result = await syncRecentSocialComments(user.id, platform, accountId, { idempotencyKey })
    return NextResponse.json({
      mode: 'recent',
      syncedCount: result.syncedCount,
      completedCount: result.completedCount,
      failedCount: result.failedCount,
      results: result.results,
    })
  } catch (error) {
    const mapped = mapSocialCommentError(error, 'Comment sync failed.')
    console.error('Social comments sync API error:', error)
    return NextResponse.json(
      { error: getApiMessage(mapped.code, mapped.message, lang), code: mapped.code },
      { status: mapped.status }
    )
  }
}
