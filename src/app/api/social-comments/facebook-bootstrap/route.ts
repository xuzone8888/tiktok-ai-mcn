import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import {
  isSocialCommentPlatformEnabled,
  isSocialCommentsApiEnabled,
} from '@/lib/social-comments/feature-flag'
import { getApiMessage, getRequestLang } from '@/lib/social-comments/i18n'
import {
  getSavedSocialComments,
  getSocialCommentAccounts,
} from '@/lib/social-comments/service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isSocialCommentsApiEnabled() || !isSocialCommentPlatformEnabled('facebook')) {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }

  const lang = getRequestLang(request.headers)

  try {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return NextResponse.json({ error: getApiMessage('unauthorized', 'Unauthorized', lang), code: 'unauthorized' }, { status: 401 })
    }

    const [accounts, saved] = await Promise.all([
      getSocialCommentAccounts(user.id, ['facebook']),
      getSavedSocialComments(user.id, {
        platform: 'facebook',
        limit: 120,
        offset: 0,
      }),
    ])

    return NextResponse.json({ accounts, comments: saved.comments })
  } catch (error) {
    console.error('Facebook comment bootstrap API error:', error)
    return NextResponse.json(
      { error: getApiMessage('internal_error', error instanceof Error ? error.message : 'Server error', lang), code: 'internal_error' },
      { status: 500 }
    )
  }
}
