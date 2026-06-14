/**
 * SMS Verification Code - Verify API
 * POST /api/sms/verify
 * 
 * 验证短信验证码并登录/注册用户
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 使用 service role key 来操作数据库
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
    try {
        const { phone, code } = await request.json();

        // 验证参数
        if (!phone || !code) {
            return NextResponse.json(
                { success: false, message: '请输入手机号和验证码' },
                { status: 400 }
            );
        }

        // 格式化手机号
        const formattedPhone = phone.replace(/^\+?86/, '').replace(/\s/g, '');

        // 查找有效的验证码
        const { data: smsCode, error: findError } = await supabase
            .from('sms_codes')
            .select('*')
            .eq('phone', formattedPhone)
            .eq('code', code)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (findError || !smsCode) {
            return NextResponse.json(
                { success: false, message: '验证码错误或已过期' },
                { status: 400 }
            );
        }

        // 标记验证码为已使用
        await supabase
            .from('sms_codes')
            .update({ used: true })
            .eq('id', smsCode.id);

        // 查找或创建用户
        // 使用手机号作为唯一标识，邮箱格式: phone@sms.toryxai.com
        const fakeEmail = `${formattedPhone}@sms.toryxai.com`;

        // 检查用户是否已存在
        const { data: existingUser } = await supabase.auth.admin.listUsers();
        const user = existingUser?.users?.find(u => u.email === fakeEmail);

        let userId: string;
        let isNewUser = false;

        if (user) {
            // 用户已存在，生成登录 session
            userId = user.id;
        } else {
            // 创建新用户
            const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
                email: fakeEmail,
                email_confirm: true, // 跳过邮箱验证
                user_metadata: {
                    phone: formattedPhone,
                    login_method: 'sms',
                },
            });

            if (createError || !newUser.user) {
                console.error('[SMS Verify] 创建用户失败:', createError);
                return NextResponse.json(
                    { success: false, message: '创建账号失败，请稍后重试' },
                    { status: 500 }
                );
            }

            userId = newUser.user.id;
            isNewUser = true;

            // 创建用户 profile
            const { error: profileError } = await supabase
                .from('profiles')
                .insert({
                    id: userId,
                    email: fakeEmail,
                    name: `用户${formattedPhone.slice(-4)}`,
                    role: 'user',
                    credits: 100, // 新用户赠送积分
                    phone: formattedPhone,
                });

            if (profileError) {
                console.error('[SMS Verify] 创建profile失败:', profileError);
            }
        }

        // 直接生成 session（不用 magic link，更直接可靠）
        const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
            type: 'magiclink',
            email: fakeEmail,
            options: {
                redirectTo: '/models',
            }
        });

        if (sessionError || !sessionData) {
            console.error('[SMS Verify] 生成session失败:', sessionError);
            return NextResponse.json(
                { success: false, message: '登录失败，请稍后重试' },
                { status: 500 }
            );
        }

        // 从 action_link 中提取 token
        const actionUrl = new URL(sessionData.properties.action_link);
        const token = actionUrl.searchParams.get('token');
        const tokenType = actionUrl.searchParams.get('type') || 'magiclink';

        return NextResponse.json({
            success: true,
            message: isNewUser ? '注册成功' : '登录成功',
            isNewUser,
            token,
            tokenType,
            email: fakeEmail,
            // 返回完整的 action_link 用于备选跳转
            actionLink: sessionData.properties.action_link,
        });

    } catch (error: any) {
        console.error('[SMS Verify API] Error:', error);
        return NextResponse.json(
            { success: false, message: '服务器错误，请稍后重试' },
            { status: 500 }
        );
    }
}
