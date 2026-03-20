import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/content-templates
 * 获取系统预设模板列表（公开，不需要登录）
 * 
 * Query params:
 *   ?category=ecommerce  — 按分类筛选
 *   ?search=穿搭        — 模糊搜索 name + description
 *   ?featured=true       — 仅精选
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const url = new URL(request.url)
    const category = url.searchParams.get('category')
    const search = url.searchParams.get('search')
    const featured = url.searchParams.get('featured')

    let query = supabase
      // @ts-expect-error — content_templates 表将在迁移后添加到 database.ts 类型定义
      .from('content_templates')
      .select('*')
      .order('sort_order', { ascending: true })

    if (category) {
      query = query.eq('category', category)
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`)
    }

    if (featured === 'true') {
      query = query.eq('is_featured', true)
    }

    const { data, error } = await query

    if (error) {
      console.error('Fetch content templates error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('Internal server error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
