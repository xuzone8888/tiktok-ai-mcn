import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/content-templates/favorites
 * 获取当前用户的模板收藏列表
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ data: [] })
    }

    const { data, error } = await supabase
      // @ts-expect-error — user_template_favorites 迁移后更新类型定义
      .from('user_template_favorites')
      .select('template_id')
      .eq('user_id', user.id)

    if (error) {
      console.error('Fetch favorites error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 返回收藏的模板 ID 列表
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const favoriteIds = (data || []).map((f: any) => f.template_id)
    return NextResponse.json({ data: favoriteIds })
  } catch (error) {
    console.error('Internal server error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/content-templates/favorites
 * 添加收藏
 * Body: { template_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { template_id } = await request.json()

    if (!template_id) {
      return NextResponse.json({ error: 'Missing template_id' }, { status: 400 })
    }

    const { error } = await supabase
      // @ts-expect-error — user_template_favorites 迁移后更新类型定义
      .from('user_template_favorites')
      .insert({ user_id: user.id, template_id })

    if (error) {
      // 如果已存在（unique constraint），视为成功
      if (error.code === '23505') {
        return NextResponse.json({ success: true, message: 'Already favorited' })
      }
      console.error('Add favorite error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Internal server error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/content-templates/favorites
 * 取消收藏
 * Body: { template_id: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { template_id } = await request.json()

    if (!template_id) {
      return NextResponse.json({ error: 'Missing template_id' }, { status: 400 })
    }

    const { error } = await supabase
      // @ts-expect-error — user_template_favorites 迁移后更新类型定义
      .from('user_template_favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('template_id', template_id)

    if (error) {
      console.error('Remove favorite error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Internal server error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
