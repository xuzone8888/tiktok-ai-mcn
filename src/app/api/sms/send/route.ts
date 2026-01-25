/**
 * SMS Verification Code - Send API
 * POST /api/sms/send
 * 
 * 发送短信验证码到指定手机号
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendSmsVerificationCode, generateVerificationCode, isValidPhoneNumber } from '@/lib/aliyun-sms';

// 使用 service role key 来操作数据库
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 速率限制：每个手机号每分钟最多1次
const RATE_LIMIT_SECONDS = 60;

export async function POST(request: NextRequest) {
    try {
        const { phone } = await request.json();

        // 验证手机号
        if (!phone) {
            return NextResponse.json(
                { success: false, message: '请输入手机号' },
                { status: 400 }
            );
        }

        // 格式化手机号
        const formattedPhone = phone.replace(/^\+?86/, '').replace(/\s/g, '');

        if (!isValidPhoneNumber(formattedPhone)) {
            return NextResponse.json(
                { success: false, message: '手机号格式不正确' },
                { status: 400 }
            );
        }

        // 检查速率限制
        const { data: recentCode } = await supabase
            .from('sms_codes')
            .select('created_at')
            .eq('phone', formattedPhone)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (recentCode) {
            const lastSentAt = new Date(recentCode.created_at);
            const secondsSinceLastSend = (Date.now() - lastSentAt.getTime()) / 1000;

            if (secondsSinceLastSend < RATE_LIMIT_SECONDS) {
                const waitSeconds = Math.ceil(RATE_LIMIT_SECONDS - secondsSinceLastSend);
                return NextResponse.json(
                    { success: false, message: `请${waitSeconds}秒后再试` },
                    { status: 429 }
                );
            }
        }

        // 生成验证码
        const code = generateVerificationCode();

        // 发送短信
        const result = await sendSmsVerificationCode(formattedPhone, code);

        if (!result.success) {
            return NextResponse.json(
                { success: false, message: result.message },
                { status: 500 }
            );
        }

        // 存储验证码到数据库（5分钟有效期）
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const { error: insertError } = await supabase
            .from('sms_codes')
            .insert({
                phone: formattedPhone,
                code,
                expires_at: expiresAt.toISOString(),
                used: false,
            });

        if (insertError) {
            console.error('[SMS] 保存验证码失败:', insertError);
            // 不影响用户体验，继续返回成功
        }

        return NextResponse.json({
            success: true,
            message: '验证码已发送',
        });

    } catch (error: any) {
        console.error('[SMS Send API] Error:', error);
        return NextResponse.json(
            { success: false, message: '服务器错误，请稍后重试' },
            { status: 500 }
        );
    }
}
