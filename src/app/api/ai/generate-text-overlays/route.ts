/**
 * AI 图文字幕生成 API
 * POST /api/ai/generate-text-overlays
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateTextOverlays, TextOverlayMode, CaptionLanguage } from '@/lib/deepseek-api';

interface RequestBody {
    prompt: string;
    mode: TextOverlayMode;
    count: number;
    imageDescriptions?: string[];
    language?: CaptionLanguage;  // 语言选项
}

export async function POST(request: NextRequest) {
    try {
        const body: RequestBody = await request.json();
        const { prompt, mode, count, imageDescriptions, language } = body;

        // 验证参数
        if (!prompt || typeof prompt !== 'string') {
            return NextResponse.json(
                { error: '请提供提示词' },
                { status: 400 }
            );
        }

        if (!mode || !['uniform', 'diverse'].includes(mode)) {
            return NextResponse.json(
                { error: '模式必须是 uniform 或 diverse' },
                { status: 400 }
            );
        }

        if (!count || typeof count !== 'number' || count < 1 || count > 50) {
            return NextResponse.json(
                { error: '数量必须在 1-50 之间' },
                { status: 400 }
            );
        }

        console.log(`[TextOverlay API] Generating ${count} texts, mode: ${mode}, language: ${language || 'en'}`);
        console.log(`[TextOverlay API] Prompt: ${prompt.slice(0, 100)}...`);

        const texts = await generateTextOverlays({
            prompt,
            mode,
            count,
            imageDescriptions: imageDescriptions || [],
            maxLength: 50,
            language: language || 'en',  // 默认英文
        });

        // 过滤空文本
        const filteredTexts = texts.filter(t => t && t.trim().length > 0);

        console.log(`[TextOverlay API] Generated ${filteredTexts.length} texts`);

        return NextResponse.json({
            success: true,
            texts: filteredTexts,
        });

    } catch (error: any) {
        console.error('[TextOverlay API Error]:', error);

        return NextResponse.json(
            {
                error: error.message || 'AI 生成失败',
                success: false,
            },
            { status: 500 }
        );
    }
}
