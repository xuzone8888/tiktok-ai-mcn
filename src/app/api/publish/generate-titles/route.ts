/**
 * AI 标题助手 - 生成标题 API
 * 
 * POST /api/publish/generate-titles
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateTitles, regenerateSingleTitle } from '@/lib/title-generator';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
    try {
        // 验证用户登录
        const supabase = await createClient();
        const { data: { user }, error: authError } = await supabase.auth.getUser();

        if (authError || !user) {
            return NextResponse.json(
                { success: false, error: '请先登录' },
                { status: 401 }
            );
        }

        // 解析请求
        const body = await request.json();
        const {
            description,
            count,
            language = 'en',
            regenerateIndex,      // 可选：只重新生成单条
            existingTitles = []   // 可选：已有标题(用于避免重复)
        } = body;

        // 验证参数
        if (!description || typeof description !== 'string' || description.trim().length === 0) {
            return NextResponse.json(
                { success: false, error: '请输入视频内容描述' },
                { status: 400 }
            );
        }

        if (!count || typeof count !== 'number' || count < 1 || count > 50) {
            return NextResponse.json(
                { success: false, error: '生成数量需在 1-50 之间' },
                { status: 400 }
            );
        }

        if (language !== 'zh' && language !== 'en') {
            return NextResponse.json(
                { success: false, error: '语言只支持 zh 或 en' },
                { status: 400 }
            );
        }

        console.log(`[Generate Titles API] User ${user.id} generating ${count} titles in ${language}`);

        // 判断是生成全部还是单条重生成
        if (typeof regenerateIndex === 'number') {
            // 单条重生成
            const result = await regenerateSingleTitle(
                description,
                language as 'zh' | 'en',
                existingTitles
            );

            if (!result.success) {
                return NextResponse.json(
                    { success: false, error: result.error },
                    { status: 500 }
                );
            }

            // 返回时附带原索引
            return NextResponse.json({
                success: true,
                titles: result.titles?.map(t => ({ ...t, index: regenerateIndex }))
            });
        }

        // 生成全部标题
        const result = await generateTitles(
            description.trim(),
            count,
            language as 'zh' | 'en'
        );

        if (!result.success) {
            return NextResponse.json(
                { success: false, error: result.error },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            titles: result.titles
        });

    } catch (error) {
        console.error('[Generate Titles API] Error:', error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : '生成失败' },
            { status: 500 }
        );
    }
}
