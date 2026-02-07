/**
 * AI 文案生成 API
 * POST /api/ai/captions
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateCaptions } from '@/lib/deepseek-api';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { keywords, style, count, mode, language } = body;

        // 参数验证
        if (!keywords || typeof keywords !== 'string') {
            return NextResponse.json(
                { error: 'keywords is required' },
                { status: 400 }
            );
        }

        if (!['lively', 'professional', 'humorous', 'poetic', 'minimal'].includes(style)) {
            return NextResponse.json(
                { error: 'Invalid style' },
                { status: 400 }
            );
        }

        const videoCount = Math.min(Math.max(1, count || 1), 20);
        const captionMode = mode === 'diverse' ? 'diverse' : 'unified';
        const captionLanguage = language === 'zh' ? 'zh' : 'en'; // 默认英文

        const captions = await generateCaptions({
            keywords,
            style,
            count: videoCount,
            mode: captionMode,
            language: captionLanguage,
        });

        return NextResponse.json({
            success: true,
            captions,
            mode: captionMode,
            count: captions.length,
        });
    } catch (error) {
        console.error('[AI Captions API Error]:', error);

        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Generation failed',
            },
            { status: 500 }
        );
    }
}
