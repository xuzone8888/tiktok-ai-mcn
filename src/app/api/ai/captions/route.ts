/**
 * AI 文案生成 API
 * POST /api/ai/captions
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateCaptions } from '@/lib/deepseek-api';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { keywords, style, count, mode, language, videoDurationSeconds, maxLength } = body;

        // 参数验证
        if (!keywords || typeof keywords !== 'string') {
            return NextResponse.json(
                { error: 'keywords is required' },
                { status: 400 }
            );
        }

        // style 现在是可选的（AI 自动判断风格），但如果传了则验证合法性
        if (style && !['lively', 'professional', 'humorous', 'poetic', 'minimal'].includes(style)) {
            return NextResponse.json(
                { error: 'Invalid style' },
                { status: 400 }
            );
        }

        const videoCount = Math.min(Math.max(1, count || 1), 20);
        const captionMode = mode === 'diverse' ? 'diverse' : 'unified';
        const captionLanguage = language === 'zh' ? 'zh' : 'en';

        // Fix 4A: 前端传入视频时长和 maxLength，生成与视频匹配的文案
        const duration = typeof videoDurationSeconds === 'number' ? videoDurationSeconds : 8;
        // 🔧 中文倍数 5 匹配 TTS 4.5字/秒（13.5s×5=68字 → 68/4.5=15.1s ≈ 视频时长）
        const dynamicMaxLength = typeof maxLength === 'number'
            ? maxLength
            : Math.round(duration * (captionLanguage === 'zh' ? 5 : 3));

        const captions = await generateCaptions({
            keywords,
            style,
            count: videoCount,
            mode: captionMode,
            language: captionLanguage,
            videoDurationSeconds: duration,
            maxLength: Math.max(dynamicMaxLength, 30),
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
