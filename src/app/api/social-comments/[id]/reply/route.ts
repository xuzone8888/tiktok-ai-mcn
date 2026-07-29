import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import {
  getEnabledSocialCommentPlatforms,
  isInstagramCommentsReplyEnabled,
  isSocialCommentsApiEnabled,
} from '@/lib/social-comments/feature-flag'
import { getApiMessage, getRequestLang } from '@/lib/social-comments/i18n'
import { mapSocialCommentError, replyToSocialComment } from '@/lib/social-comments/service'

export const dynamic = 'force-dynamic'

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/

function isRequestObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSocialCommentsApiEnabled()) {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }

  const lang = getRequestLang(request.headers)

  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return NextResponse.json({ error: getApiMessage('unauthorized', 'Unauthorized', lang), code: 'unauthorized' }, { status: 401 })
    }

    const body = await request.json().catch(() => null) as unknown
    if (!isRequestObject(body)) {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }

    const message = body.message
    if (typeof message !== 'string') {
      return NextResponse.json({ error: getApiMessage('invalid_request', 'Invalid request', lang), code: 'invalid_request' }, { status: 400 })
    }
    if (!message.trim()) {
      return NextResponse.json({ error: getApiMessage('empty_reply', 'Reply message cannot be empty.', lang), code: 'empty_reply' }, { status: 400 })
    }
    if (message.length > 2000) {
      return NextResponse.json({ error: getApiMessage('reply_too_long', 'Reply message cannot exceed 2000 characters.', lang), code: 'reply_too_long' }, { status: 400 })
    }

    const idempotencyKeyValue = body.idempotencyKey
    if (typeof idempotencyKeyValue !== 'string') {
      return NextResponse.json(
        { error: getApiMessage('invalid_idempotency_key', 'Invalid reply idempotency key.', lang), code: 'invalid_idempotency_key' },
        { status: 400 }
      )
    }
    const idempotencyKey = idempotencyKeyValue.trim()
    if (idempotencyKey.length < 12 || idempotencyKey.length > 160 || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      return NextResponse.json(
        { error: getApiMessage('invalid_idempotency_key', 'Invalid reply idempotency key.', lang), code: 'invalid_idempotency_key' },
        { status: 400 }
      )
    }

    const reply = await replyToSocialComment(user.id, id, message, idempotencyKey, {
      enabledPlatforms: getEnabledSocialCommentPlatforms(),
      instagramReplyEnabled: isInstagramCommentsReplyEnabled(),
    })

    return NextResponse.json({ reply })
  } catch (error) {
    const mapped = mapSocialCommentError(error, 'Reply failed.')
    console.error('Social comment reply API error:', error)
    return NextResponse.json(
      { error: getApiMessage(mapped.code, mapped.message, lang), code: mapped.code },
      { status: mapped.status }
    )
  }
}
