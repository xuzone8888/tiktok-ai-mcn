/**
 * 导出指定用户的视频下载链接
 * 用户: 通过 EXPORT_USER_EMAIL / EXPORT_USER_ID 指定
 * 时间范围: 昨天下午13点 到 现在
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Supabase 配置
const SUPABASE_URL = 'https://hfabrifuvujpdzarlbky.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const TARGET_USER_EMAIL = process.env.EXPORT_USER_EMAIL || 'target-user@example.com';
const TARGET_USER_ID = process.env.EXPORT_USER_ID;

if (!SUPABASE_SERVICE_KEY || !TARGET_USER_ID) {
    console.error('Required: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY, plus EXPORT_USER_ID');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function main() {
    const userEmail = TARGET_USER_EMAIL;
    const userId = TARGET_USER_ID;

    // 昨天下午 13:00 (北京时间 = UTC+8)
    // 北京时间昨天 13:00 = UTC 昨天 05:00
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(5, 0, 0, 0);  // UTC 时间
    const startTime = yesterday.toISOString();

    // 现在
    const endTime = new Date().toISOString();

    console.log(`查询用户: ${userEmail}`);
    console.log(`用户 ID: ${userId}`);
    console.log(`时间范围: ${startTime} 到 ${endTime}`);
    console.log('(北京时间: 昨天 13:00 到现在)\n');

    // 查询 generations 表中该用户的视频 - 获取所有字段
    const { data: generations, error: genError } = await supabase
        .from('generations')
        .select('*')
        .eq('user_id', userId)
        .eq('type', 'video')
        .gte('created_at', startTime)
        .lte('created_at', endTime)
        .order('created_at', { ascending: true });

    if (genError) {
        console.error('查询生成记录失败:', genError);

        // 尝试不过滤 type，获取所有记录
        console.log('\n尝试查询所有记录...');
        const { data: allGen, error: allError } = await supabase
            .from('generations')
            .select('*')
            .eq('user_id', userId)
            .gte('created_at', startTime)
            .lte('created_at', endTime)
            .limit(5);

        if (allError) {
            console.error('仍然失败:', allError);
        } else if (allGen && allGen.length > 0) {
            console.log('样例记录字段:', Object.keys(allGen[0]));
            console.log('样例记录:', JSON.stringify(allGen[0], null, 2));
        }
        return;
    }

    console.log(`找到 ${generations?.length || 0} 条视频生成记录`);

    if (generations && generations.length > 0) {
        console.log('\n样例记录字段:', Object.keys(generations[0]));
    }

    // 收集所有视频 URL
    const videoUrls = [];

    for (const gen of generations || []) {
        // 尝试多种可能的字段名
        const possibleUrlFields = ['result_url', 'video_url', 'url', 'output', 'result', 'download_url', 'file_url', 'video_link'];

        // 首先检查 metadata 中是否有 video_url
        if (gen.metadata && typeof gen.metadata === 'object') {
            if (gen.metadata.video_url) {
                videoUrls.push({
                    url: gen.metadata.video_url,
                    time: gen.created_at,
                    status: gen.status
                });
                continue;
            }
            if (gen.metadata.result_url) {
                videoUrls.push({
                    url: gen.metadata.result_url,
                    time: gen.created_at,
                    status: gen.status
                });
                continue;
            }
            if (gen.metadata.url) {
                videoUrls.push({
                    url: gen.metadata.url,
                    time: gen.created_at,
                    status: gen.status
                });
                continue;
            }
        }

        // 检查直接字段
        for (const field of possibleUrlFields) {
            if (gen[field]) {
                videoUrls.push({
                    url: gen[field],
                    time: gen.created_at,
                    status: gen.status
                });
                break;
            }
        }
    }

    console.log(`共找到 ${videoUrls.length} 个视频链接\n`);

    // 如果没找到，打印第一条记录
    if (videoUrls.length === 0 && generations && generations.length > 0) {
        console.log('未找到视频链接，打印第一条记录用于调试:');
        console.log(JSON.stringify(generations[0], null, 2));
        return;
    }

    if (videoUrls.length === 0) {
        console.log('该时间段内没有视频链接');
        return;
    }

    // 写入桌面 TXT 文件
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const safeUserLabel = userEmail.replace(/[^a-zA-Z0-9_-]/g, '_');
    const outputFile = path.join(desktopPath, `视频下载链接_${safeUserLabel}_${timestamp}.txt`);

    const content = [
        `用户: ${userEmail}`,
        `用户ID: ${userId}`,
        `导出时间: ${new Date().toLocaleString('zh-CN')}`,
        `查询时间范围: 2026-02-04 13:00:00 到 ${new Date().toLocaleString('zh-CN')}`,
        `共 ${videoUrls.length} 个视频`,
        '',
        '='.repeat(80),
        '视频下载链接:',
        '='.repeat(80),
        '',
        ...videoUrls.map((v, i) => {
            const time = new Date(v.time).toLocaleString('zh-CN');
            return `${String(i + 1).padStart(3, ' ')}. [${v.status}] ${time}\n     ${v.url}`;
        }),
        '',
        '='.repeat(80),
        '纯链接列表 (方便批量下载):',
        '='.repeat(80),
        '',
        ...videoUrls.map(v => v.url),
        '',
    ].join('\n');

    fs.writeFileSync(outputFile, content, 'utf-8');
    console.log(`✅ 已导出到: ${outputFile}`);

    // 同时打印前几个链接
    console.log('\n前5个视频链接:');
    videoUrls.slice(0, 5).forEach((v, i) => {
        console.log(`  ${i + 1}. ${v.url}`);
    });
}

main().catch(console.error);
