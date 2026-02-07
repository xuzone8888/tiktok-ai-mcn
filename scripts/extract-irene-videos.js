/**
 * 提取 irene 用户 (18271850054@139.com) 的视频下载链接
 * 时间范围: 2026-02-03 20:00 北京时间之后
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function extractVideos() {
    console.log('=== 提取 irene 用户视频 URL ===\n');

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const targetEmail = '18271850054@139.com';

    // 1. 查找用户
    console.log(`1. 查找用户: ${targetEmail}`);
    const { data: users, error: userError } = await supabase
        .from('profiles')
        .select('id, email, credits')
        .eq('email', targetEmail);

    if (userError || !users || users.length === 0) {
        console.error('❌ 未找到用户:', userError?.message);
        return;
    }

    const userId = users[0].id;
    console.log(`   用户 ID: ${userId}`);
    console.log(`   积分: ${users[0].credits}\n`);

    // 2. 时间范围: 2026-02-03 20:00 北京时间 = 2026-02-03 12:00 UTC
    const startTime = '2026-02-03T12:00:00Z';
    console.log(`2. 时间范围: ${startTime} 之后 (2月3日20点北京时间)\n`);

    // 3. 查询 generations 表
    console.log('3. 查询 generations 表...');
    const { data: generations, error: genError } = await supabase
        .from('generations')
        .select('id, result_url, video_url, type, source, status, created_at')
        .eq('user_id', userId)
        .gte('created_at', startTime)
        .eq('status', 'completed')
        .order('created_at', { ascending: true });

    if (genError) {
        console.error('   generations 错误:', genError.message);
    } else {
        console.log(`   找到 ${generations?.length || 0} 条 generations 记录`);
    }

    // 4. 查询 quick_gen_history 表
    console.log('4. 查询 quick_gen_history 表...');
    const { data: quickGens, error: qgError } = await supabase
        .from('quick_gen_history')
        .select('id, mode, output_url, status, created_at')
        .eq('user_id', userId)
        .gte('created_at', startTime)
        .eq('status', 'completed')
        .order('created_at', { ascending: true });

    if (qgError) {
        console.error('   quick_gen_history 错误:', qgError.message);
    } else {
        console.log(`   找到 ${quickGens?.length || 0} 条 quick_gen 记录`);
    }

    // 5. 合并 URL
    const urls = [];

    if (generations) {
        for (const gen of generations) {
            const url = gen.result_url || gen.video_url;
            if (url && (url.includes('.mp4') || gen.type === 'video')) {
                urls.push({
                    url,
                    time: gen.created_at,
                    source: gen.source || 'generations',
                });
            }
        }
    }

    if (quickGens) {
        for (const qg of quickGens) {
            if (qg.output_url && qg.mode === 'video') {
                urls.push({
                    url: qg.output_url,
                    time: qg.created_at,
                    source: 'quick_gen',
                });
            }
        }
    }

    console.log(`\n总共找到 ${urls.length} 个视频\n`);

    if (urls.length === 0) {
        console.log('没有找到符合条件的视频');
        return;
    }

    // 6. 保存到桌面
    const desktopPath = path.join(require('os').homedir(), 'Desktop', 'irene_videos.txt');
    const content = [
        '# irene 用户 (18271850054@139.com) 视频下载链接',
        '# 时间范围: 2026-02-03 20:00 北京时间 - 现在',
        `# 总计: ${urls.length} 个视频`,
        `# 生成时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`,
        '',
        ...urls.map((item, i) => {
            const time = new Date(item.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            return `# [${i + 1}] ${time} (${item.source})\n${item.url}`;
        }),
    ].join('\n');

    fs.writeFileSync(desktopPath, content, 'utf-8');
    console.log(`✅ 已保存到: ${desktopPath}`);

    // 预览
    console.log('\n=== 内容预览 ===');
    urls.forEach((item, i) => {
        const time = new Date(item.time).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        console.log(`[${i + 1}] ${time}`);
        console.log(`    ${item.url}`);
    });
}

extractVideos().catch(console.error);
