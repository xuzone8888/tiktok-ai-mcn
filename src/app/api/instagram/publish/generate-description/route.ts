import { NextRequest, NextResponse } from 'next/server'

import { callDoubaoAPI } from '@/lib/doubao-api-client'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const INSTAGRAM_CAPTION_MAX_LENGTH = 2200

function normalizeTags(tags: unknown) {
  return Array.isArray(tags)
    ? tags.filter((item): item is string => typeof item === 'string').map((tag) => tag.replace(/^#/, '').trim()).filter(Boolean).slice(0, 30)
    : []
}

function formatTags(tags: string[]) {
  return tags.map((tag) => `#${tag}`).join(' ')
}

function cleanDescription(value: string, title: string, tags: string[]) {
  let text = value.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim()
  }

  const fixedParts = [title.trim(), formatTags(tags)].filter(Boolean)
  const fixedLength = fixedParts.join('\n\n').length
  const separatorLength = fixedLength > 0 && text ? 2 : 0
  const availableLength = Math.max(0, INSTAGRAM_CAPTION_MAX_LENGTH - fixedLength - separatorLength)

  return text.length > availableLength ? text.slice(0, availableLength) : text
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ success: false, error: '请先登录' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    const taskName = typeof body.taskName === 'string' ? body.taskName.trim() : ''
    const videoNames: string[] = Array.isArray(body.videoNames)
      ? body.videoNames.filter((item: unknown): item is string => typeof item === 'string').slice(0, 10)
      : []
    const tags = normalizeTags(body.tags)

    const context = [
      title ? `视频标题：${title}` : '',
      description ? `已有描述：${description}` : '',
      taskName ? `任务组名称：${taskName}` : '',
      videoNames.length > 0 ? `视频文件/素材：${videoNames.join('、')}` : '',
      tags.length > 0 ? `标签：${tags.map((tag) => `#${tag}`).join(' ')}` : '',
      prompt ? `用户补充要求：${prompt}` : '',
    ].filter(Boolean).join('\n')

    if (!context) {
      return NextResponse.json({ success: false, error: '请先填写标题、描述或补充要求' }, { status: 400 })
    }

    const result = await callDoubaoAPI([
      {
        role: 'system',
        content: '你是专业 Instagram Reels 内容运营，擅长写简洁、有吸引力、适合 caption 的视频描述。只输出可直接发布的描述正文，不要解释，不要 Markdown 代码块。',
      },
      {
        role: 'user',
        content: `请根据以下信息写一段中文 Instagram Reels 描述。\n\n${context}\n\n要求：\n1. 语气自然，适合 Instagram Reels。\n2. 突出视频核心看点，句子简洁。\n3. 如有标签，可放在描述末尾。\n4. 不要编造具体数据、品牌授权或链接。\n5. 最终标题、描述和标签合计不能超过 2200 个字符。`,
      },
    ], {
      maxTokens: 900,
      temperature: 0.7,
    })

    if (!result.success || !result.content) {
      return NextResponse.json({ success: false, error: result.error || '生成失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      description: cleanDescription(result.content, title, tags),
    })
  } catch (error) {
    console.error('[Instagram Generate Description] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '生成失败' },
      { status: 500 }
    )
  }
}
