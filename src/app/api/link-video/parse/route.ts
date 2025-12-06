/**
 * 链接解析 API
 * POST /api/link-video/parse
 * 
 * 解析商品链接，返回结构化的商品信息
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseProductLink, getMockParseResult, generateUrlHash } from '@/lib/link-parser';
import type { ProductPlatform, ParsedProductData } from '@/types/link-video';

export async function POST(request: NextRequest) {
  try {
    // 1. 验证用户身份
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: '请先登录' },
        { status: 401 }
      );
    }

    // 2. 解析请求体
    const body = await request.json();
    const { url, platform: forcePlatform } = body as {
      url: string;
      platform?: ProductPlatform;
    };

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { success: false, error: '请提供有效的商品链接' },
        { status: 400 }
      );
    }

    // 3. 尝试检查缓存（如果表存在）
    const urlHash = generateUrlHash(url);
    const adminSupabase = createAdminClient();
    let cachedLink = null;

    try {
      const { data, error } = await adminSupabase
        .from('product_link_cache')
        .select('*')
        .eq('url_hash', urlHash)
        .eq('parse_status', 'success')
        .single();

      if (!error && data && data.parsed_data) {
        console.log('[Parse API] Cache hit for URL hash:', urlHash);
        return NextResponse.json({
          success: true,
          data: {
            product_link_id: data.id,
            parsed_data: data.parsed_data as ParsedProductData,
            from_cache: true,
          },
        });
      }
      cachedLink = data;
    } catch (cacheError) {
      // 缓存表可能不存在，忽略错误继续
      console.log('[Parse API] Cache check skipped:', cacheError);
    }

    // 4. 解析链接
    console.log('[Parse API] Parsing URL:', url);

    // 开发环境使用 Mock 数据 (如果配置了)
    const useMock = process.env.LINK_PARSER_USE_MOCK === 'true';
    const parseResult = useMock 
      ? getMockParseResult(url)
      : await parseProductLink(url, forcePlatform);

    if (!parseResult.success || !parseResult.data) {
      // 解析失败，尝试保存记录（如果表存在）
      try {
        await adminSupabase.from('product_link_cache').upsert({
          url,
          url_hash: urlHash,
          platform: parseResult.platform,
          parse_status: 'failed',
          parse_error: parseResult.error || '解析失败',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'url_hash',
        });
      } catch {
        // 忽略缓存保存错误
      }

      return NextResponse.json({
        success: false,
        error: parseResult.error || '无法解析该链接，请尝试手动输入商品信息',
        platform: parseResult.platform,
      });
    }

    // 5. 尝试保存到缓存（如果表存在）
    let savedLinkId = null;
    try {
      const { data: savedLink, error: saveError } = await adminSupabase
        .from('product_link_cache')
        .upsert({
          url,
          url_hash: urlHash,
          platform: parseResult.platform,
          raw_title: parseResult.rawData?.title,
          raw_description: parseResult.rawData?.description,
          raw_price: parseResult.rawData?.price,
          raw_promo_info: parseResult.rawData?.promoInfo,
          raw_images: parseResult.rawData?.images || [],
          parsed_data: parseResult.data,
          parse_status: 'success',
          parse_error: null,
          last_fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'url_hash',
        })
        .select()
        .single();

      if (!saveError && savedLink) {
        savedLinkId = savedLink.id;
      } else if (saveError) {
        console.error('[Parse API] Save error:', saveError);
      }
    } catch {
      // 忽略缓存保存错误
    }

    return NextResponse.json({
      success: true,
      data: {
        product_link_id: savedLinkId,
        parsed_data: parseResult.data,
        from_cache: false,
      },
    });

  } catch (error) {
    console.error('[Parse API] Error:', error);
    return NextResponse.json(
      { success: false, error: '服务器错误，请稍后重试' },
      { status: 500 }
    );
  }
}

