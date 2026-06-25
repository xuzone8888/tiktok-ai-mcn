import { NextRequest, NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { generateTitles, type GeneratedTitle } from '@/lib/title-generator'

export const dynamic = 'force-dynamic'

const FALLBACK_HASHTAGS = ['#Facebook', '#Reels', '#视频分享']

function sanitizeTitle(value: string) {
  return value
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function trimTitle(value: string) {
  return value.length > 255 ? value.slice(0, 255) : value
}

function makeFallbackTitles(description: string, count: number, videoNames: string[]): GeneratedTitle[] {
  const base = sanitizeTitle(description) || '精彩视频分享'
  const safeCount = Math.min(Math.max(count, 1), 50)

  return Array.from({ length: safeCount }, (_, index) => {
    const videoName = sanitizeTitle(videoNames[index] || '')
    const title = trimTitle(videoName || (safeCount > 1 ? `${base} ${index + 1}` : base))
    const hashtags = FALLBACK_HASHTAGS.slice(0, 3)

    return {
      index,
      title,
      topics: hashtags,
      tags: [],
      combined: trimTitle(`${title} ${hashtags.join(' ')}`),
    }
  })
}

export async function POST(request: NextRequest) {
  try {
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

    if (!description) {
      return NextResponse.json({ success: false, error: '请输入视频内容描述' }, { status: 400 })
    }

    if (!Number.isFinite(count) || count < 1 || count > 50) {
      return NextResponse.json({ success: false, error: '生成数量需在 1-50 之间' }, { status: 400 })
    }

    const result = await generateTitles(description, count, language)
    if (result.success && result.titles?.length) {
      return NextResponse.json({
        success: true,
        titles: result.titles,
        provider: 'doubao',
      })
    }

    return NextResponse.json({
      success: true,
      fallback: true,
      warning: result.error
        ? `AI 标题服务暂不可用：${result.error}。已使用本地兜底标题。`
        : 'AI 标题服务暂不可用，已使用本地兜底标题。',
      titles: makeFallbackTitles(description, count, videoNames),
    })
  } catch (error) {
    console.error('Facebook generate titles error:', error)
    return NextResponse.json({
      success: true,
      fallback: true,
      warning: 'AI 标题服务暂不可用，已使用本地兜底标题。',
      titles: makeFallbackTitles('精彩视频分享', 1, []),
    })
  }
}
