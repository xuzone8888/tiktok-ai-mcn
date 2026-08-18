import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import {
  isSocialCommentPlatformEnabled,
  isSocialCommentsApiEnabled,
} from '@/lib/social-comments/feature-flag'
import { getApiMessage, getRequestLang } from '@/lib/social-comments/i18n'
import { getSavedSocialComments } from '@/lib/social-comments/service'
import { isSocialPlatform } from '@/lib/social-comments/types'

export const dynamic = 'force-dynamic'

function parseBoundedNumber(
  value: string | null,
  fallback: number,
  options: { min: number; max?: number; invalidBelow?: number }
): number | null {
  if (value === null || value === '') return fallback
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  if (options.invalidBelow !== undefined && parsed < options.invalidBelow) return null
  const clamped = Math.min(Math.max(Math.floor(parsed), options.min), options.max ?? Number.MAX_SAFE_INTEGER)
  return clamped
}

export async function GET(request: NextRequest) {
  if (!isSocialCommentsApiEnabled()) {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }

  const lang = getRequestLang(request.headers)

  try {
    const searchParams = request.nextUrl.searchParams
    const platformParam = searchParams.get('platform') || 'all'
    if (platformParam === 'all') {
      return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
    }
    if (!isSocialPlatform(platformParam)) {
      return NextResponse.json({ error: getApiMessage('invalid_platform', 'Invalid platform', lang), code: 'invalid_platform' }, { status: 400 })
    }
    if (!isSocialCommentPlatformEnabled(platformParam)) {
      return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
    }

    const limit = parseBoundedNumber(searchParams.get('limit'), 100, { min: 1, max: 200, invalidBelow: 0 })
    const offset = parseBoundedNumber(searchParams.get('offset'), 0, { min: 0, invalidBelow: 0 })
    if (limit === null || offset === null) {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return NextResponse.json({ error: getApiMessage('unauthorized', 'Unauthorized', lang), code: 'unauthorized' }, { status: 401 })
    }

    const result = await getSavedSocialComments(user.id, {
      platform: platformParam,
      accountId: searchParams.get('accountId') || undefined,
      contentId: searchParams.get('contentId') || undefined,
      status: searchParams.get('status') || undefined,
      limit,
      offset,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Social comments API error:', error)
    return NextResponse.json(
      { error: getApiMessage('internal_error', error instanceof Error ? error.message : 'Server error', lang), code: 'internal_error' },
      { status: 500 }
    )
  }
}
