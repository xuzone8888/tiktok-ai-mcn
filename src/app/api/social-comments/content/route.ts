import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import {
  isSocialCommentPlatformEnabled,
  isSocialCommentsApiEnabled,
} from '@/lib/social-comments/feature-flag'
import { getApiMessage, getRequestLang } from '@/lib/social-comments/i18n'
import { getSocialCommentContent } from '@/lib/social-comments/service'
import { isSocialPlatform } from '@/lib/social-comments/types'

export const dynamic = 'force-dynamic'

function parseLimit(value: string | null): number | null {
  if (value === null || value === '') return 100
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.min(Math.max(Math.floor(parsed), 1), 200)
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

    const limit = parseLimit(searchParams.get('limit'))
    if (limit === null) {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return NextResponse.json({ error: getApiMessage('unauthorized', 'Unauthorized', lang), code: 'unauthorized' }, { status: 401 })
    }

    const content = await getSocialCommentContent(user.id, {
      platform: platformParam,
      accountId: searchParams.get('accountId') || undefined,
      limit,
    })

    return NextResponse.json({ content })
  } catch (error) {
    console.error('Social comment content API error:', error)
    return NextResponse.json(
      { error: getApiMessage('internal_error', error instanceof Error ? error.message : 'Server error', lang), code: 'internal_error' },
      { status: 500 }
    )
  }
}
