import { NextRequest, NextResponse } from 'next/server'

import { callDoubaoAPI } from '@/lib/doubao-api-client'
import { createClient } from '@/lib/supabase/server'
import {
  stripYouTubeDisallowedMetadataChars,
  truncateYouTubeTextByUtf8Bytes,
  YOUTUBE_DESCRIPTION_MAX_BYTES,
} from '@/lib/youtube/metadata-rules'

export const dynamic = 'force-dynamic'

function cleanDescription(value: string) {
  let text = value.trim()
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim()
  }
  return truncateYouTubeTextByUtf8Bytes(stripYouTubeDisallowedMetadataChars(text), YOUTUBE_DESCRIPTION_MAX_BYTES)
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
    const language = body.language === 'en' ? 'en' : 'zh'
    const videoNames: string[] = Array.isArray(body.videoNames)
      ? body.videoNames.filter((item: unknown): item is string => typeof item === 'string').slice(0, 10)
      : []
    const tags: string[] = Array.isArray(body.tags)
      ? body.tags.filter((item: unknown): item is string => typeof item === 'string').slice(0, 20)
      : []

    const labels = language === 'en'
      ? {
          title: 'Video title',
          description: 'Existing description',
          taskName: 'Task group name',
          videoNames: 'Video files/assets',
          tags: 'Tags',
          prompt: 'Extra user instructions',
          videoSeparator: ', ',
        }
      : {
          title: '视频标题',
          description: '已有描述',
          taskName: '任务组名称',
          videoNames: '视频文件/素材',
          tags: '标签',
          prompt: '用户补充要求',
          videoSeparator: '、',
        }

    const context = [
      title ? `${labels.title}: ${title}` : '',
      description ? `${labels.description}: ${description}` : '',
      taskName ? `${labels.taskName}: ${taskName}` : '',
      videoNames.length > 0 ? `${labels.videoNames}: ${videoNames.join(labels.videoSeparator)}` : '',
      tags.length > 0 ? `${labels.tags}: ${tags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}` : '',
      prompt ? `${labels.prompt}: ${prompt}` : '',
    ].filter(Boolean).join('\n')

    if (!context) {
      return NextResponse.json({ success: false, error: '请先填写标题、描述或补充要求' }, { status: 400 })
    }

    const messages = language === 'en'
      ? [
          {
            role: 'system' as const,
            content: 'You are a professional YouTube content strategist. Write natural, clear YouTube video descriptions suitable for publishing. Output only the description text. Do not explain. Do not use Markdown code fences.',
          },
          {
            role: 'user' as const,
            content: `Write an English YouTube video description based on the following information.\n\n${context}\n\nRequirements:\n1. Keep the tone natural and ready to publish on YouTube.\n2. Include the core highlights of the video and a reasonable call to action when useful.\n3. If tags are provided, place them at the end.\n4. Do not invent specific data, brand authorization, or links.\n5. Stay within YouTube description limits.`,
          },
        ]
      : [
          {
            role: 'system' as const,
            content: '你是专业 YouTube 内容运营，擅长为视频撰写自然、清晰、适合发布的视频描述。只输出可直接发布的描述正文，不要解释，不要 Markdown 代码块。',
          },
          {
            role: 'user' as const,
            content: `请根据以下信息写一段中文 YouTube 视频描述。\n\n${context}\n\n要求：\n1. 语气自然，适合直接发布到 YouTube。\n2. 内容包含视频核心看点，可适当加入行动引导。\n3. 如有标签，放在描述末尾。\n4. 不要编造具体数据、品牌授权或链接。\n5. 总长度控制在 YouTube 视频描述限制以内。`,
          },
        ]

    const result = await callDoubaoAPI(messages, {
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
    console.error('[YouTube Generate Description] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '生成失败' },
      { status: 500 }
    )
  }
}
