import { NextRequest, NextResponse } from 'next/server'

import { isLinkedInPublishEnabledServer } from '@/lib/feature-flags'
import { generateTitles, type GeneratedTitle } from '@/lib/title-generator'
import { createClient } from '@/lib/supabase/server'
import {
  stripLinkedInDisallowedMetadataChars,
  truncateLinkedInText,
  LINKEDIN_TITLE_MAX_CHARACTERS,
} from '@/lib/linkedin/metadata-rules'

export const dynamic = 'force-dynamic'

function sanitizeTitle(value: string) {
  return stripLinkedInDisallowedMetadataChars(value)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[#＃][^\s#＃]+/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function trimTitle(value: string) {
  return truncateLinkedInText(value, LINKEDIN_TITLE_MAX_CHARACTERS)
}

function makeFallbackTitles(description: string, count: number, videoNames: string[]): GeneratedTitle[] {
  const safeCount = Math.min(Math.max(count, 1), 50)
  const base = sanitizeTitle(description) || 'LinkedIn 视频'

  return Array.from({ length: safeCount }, (_, index) => {
    const videoName = sanitizeTitle(videoNames[index] || '')
    const title = trimTitle(videoName || (safeCount > 1 ? `${base} ${index + 1}` : base))

    return {
      index,
      title,
      topics: [],
      tags: [],
      combined: title,
    }
  })
}

export async function POST(request: NextRequest) {
  try {
    if (!isLinkedInPublishEnabledServer()) {
      return NextResponse.json({ success: false, error: 'LinkedIn 发布功能已暂停', disabled: true }, { status: 403 })
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    const language = body.language === 'en' ? 'en' : 'zh'
    const count = Number(body.count || 1)
    const videoNames = Array.isArray(body.videoNames)
      ? body.videoNames.filter((name: unknown): name is string => typeof name === 'string')
      : []

    if (!description && videoNames.length === 0) {
      return NextResponse.json({ success: false, error: '请输入视频内容描述或先选择视频' }, { status: 400 })
    }

    if (!Number.isFinite(count) || count < 1 || count > 50) {
      return NextResponse.json({ success: false, error: '生成数量需在 1-50 之间' }, { status: 400 })
    }

    const result = await generateTitles(description || videoNames[0] || 'LinkedIn 视频', count, language)
    if (result.success && result.titles?.length) {
      return NextResponse.json({
        success: true,
        provider: 'doubao',
        titles: result.titles.map((item, index) => {
          const title = trimTitle(sanitizeTitle(item.title || item.combined || description))
          return {
            ...item,
            index,
            title,
            topics: [],
            tags: [],
            combined: title,
          }
        }),
      })
    }

    return NextResponse.json({
      success: true,
      fallback: true,
      warning: result.error
        ? `AI 标题服务暂不可用：${result.error}。已使用本地标题。`
        : 'AI 标题服务暂不可用，已使用本地标题。',
      titles: makeFallbackTitles(description, count, videoNames),
    })
  } catch (error) {
    console.error('[LinkedIn Generate Titles] Error:', error)
    return NextResponse.json({
      success: true,
      fallback: true,
      warning: 'AI 标题服务暂不可用，已使用本地标题。',
      titles: makeFallbackTitles('LinkedIn 视频', 1, []),
    })
  }
}
