import { NextRequest, NextResponse } from 'next/server'

import { callDoubaoAPI } from '@/lib/doubao-api-client'
import { isLinkedInPublishEnabledServer } from '@/lib/feature-flags'
import { createClient } from '@/lib/supabase/server'
import {
  stripLinkedInDisallowedMetadataChars,
  truncateLinkedInText,
  LINKEDIN_DESCRIPTION_MAX_CHARACTERS,
} from '@/lib/linkedin/metadata-rules'

export const dynamic = 'force-dynamic'

function cleanDescription(value: string) {
  let text = value.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim()
  }
  return truncateLinkedInText(stripLinkedInDisallowedMetadataChars(text), LINKEDIN_DESCRIPTION_MAX_CHARACTERS)
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
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    const taskName = typeof body.taskName === 'string' ? body.taskName.trim() : ''
    const videoNames: string[] = Array.isArray(body.videoNames)
      ? body.videoNames.filter((item: unknown): item is string => typeof item === 'string').slice(0, 10)
      : []
    const tags: string[] = Array.isArray(body.tags)
      ? body.tags.filter((item: unknown): item is string => typeof item === 'string').slice(0, 20)
      : []

    const context = [
      title ? `视频标题：${title}` : '',
      description ? `已有描述：${description}` : '',
      taskName ? `任务组名称：${taskName}` : '',
      videoNames.length > 0 ? `视频文件/素材：${videoNames.join('、')}` : '',
      tags.length > 0 ? `标签：${tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}` : '',
      prompt ? `用户补充要求：${prompt}` : '',
    ].filter(Boolean).join('\n')

    if (!context) {
      return NextResponse.json({ success: false, error: '请先填写标题、描述或补充要求' }, { status: 400 })
    }

    const result = await callDoubaoAPI([
      {
        role: 'system',
        content: '你是专业 LinkedIn 内容运营，擅长为公开视频帖子撰写自然、可信、适合职业社交场景的视频描述。只输出可直接发布的正文，不要解释，不要 Markdown 代码块。',
      },
      {
        role: 'user',
        content: `请根据以下信息写一段中文 LinkedIn 视频发布描述。\n\n${context}\n\n要求：\n1. 语气专业、自然，适合直接发布到 LinkedIn。\n2. 突出视频核心看点和业务价值，可适当加入行动引导。\n3. 如有标签，放在描述末尾。\n4. 不要编造具体数据、品牌授权、客户案例或链接。\n5. 总长度控制在 LinkedIn 描述限制以内。`,
      },
    ], {
      maxTokens: 1200,
      temperature: 0.7,
    })

    if (!result.success || !result.content) {
      return NextResponse.json({ success: false, error: result.error || '生成失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      description: cleanDescription(result.content),
    })
  } catch (error) {
    console.error('[LinkedIn Generate Description] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '生成失败' },
      { status: 500 }
    )
  }
}
