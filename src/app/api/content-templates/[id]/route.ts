import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/content-templates/[id]
 * 获取单个模板详情
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    const { data, error } = await supabase
      // @ts-expect-error — content_templates 迁移后更新类型定义
      .from('content_templates')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      console.error('Fetch content template error:', error)
      return NextResponse.json({ error: error.message }, { status: 404 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('Internal server error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/content-templates/[id]
 * 递增 usage_count（用户点"复制 Prompt"时调用）
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = await createClient()

    // 使用 rpc 或先查后更新来递增计数
    const { data: current, error: fetchError } = await supabase
      // @ts-expect-error — content_templates 迁移后更新类型定义
      .from('content_templates')
      .select('usage_count')
      .eq('id', id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    const { error: updateError } = await supabase
      // @ts-expect-error — content_templates 迁移后更新类型定义
      .from('content_templates')
      // @ts-expect-error — usage_count 字段迁移后存在
      .update({ usage_count: current.usage_count + 1 })
      .eq('id', id)

    if (updateError) {
      console.error('Update usage_count error:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // @ts-expect-error — usage_count 字段迁移后存在
    return NextResponse.json({ success: true, usage_count: current.usage_count + 1 })
  } catch (error) {
    console.error('Internal server error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
