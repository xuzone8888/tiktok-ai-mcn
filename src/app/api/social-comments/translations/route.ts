import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { isSocialCommentsApiEnabled } from '@/lib/social-comments/feature-flag'
import { getApiMessage, getRequestLang } from '@/lib/social-comments/i18n'
import { getOrCreateCommentTranslations } from '@/lib/social-comments/translation-service'
import { isCommentTranslationLanguage } from '@/lib/social-comments/translation-core'
import { consumeCommentTranslationRequest } from '@/lib/social-comments/translation-rate-limit'

export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_COMMENT_IDS = 30

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
    const body = await request.json().catch(() => null) as { commentIds?: unknown; targetLanguage?: unknown } | null
    const commentIds = Array.isArray(body?.commentIds) ? [...new Set(body.commentIds)] : []
    if (
      commentIds.length === 0
      || commentIds.length > MAX_COMMENT_IDS
      || commentIds.some((id) => typeof id !== 'string' || !UUID_PATTERN.test(id))
      || !isCommentTranslationLanguage(body?.targetLanguage)
    ) {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }
    if (!await consumeCommentTranslationRequest(user.id)) {
      return NextResponse.json(
        { error: getApiMessage('rate_limited', 'Too many translation requests. Please try again shortly.', lang), code: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const translations = await getOrCreateCommentTranslations(user.id, commentIds as string[], body.targetLanguage)
    return NextResponse.json({ translations })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Comment translation failed.'
    const unavailable = message === 'Comment translation is not configured.' || message === 'Comment translation timed out.'
    console.error('Social comment translation API error:', { name: error instanceof Error ? error.name : 'Error', message })
    return NextResponse.json(
      { error: getApiMessage('translation_failed', message, lang), code: unavailable ? 'translation_unavailable' : 'translation_failed' },
      { status: unavailable ? 503 : 500 }
    )
  }
}
