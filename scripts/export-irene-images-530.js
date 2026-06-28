// 导出用户 Irene888 今天 17:30 之后生成的图片下载地址
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function exportImages() {
    console.log('\n🔍 正在查询 Irene888 用户 17:30 之后的图片数据...\n');

    // Irene888 用户 ID
    const userId = '00000000-0000-0000-0000-000000000000';

    // 今天 17:30 的时间戳 (北京时间 UTC+8)
    const today = new Date();
    today.setHours(17, 30, 0, 0);
    const startTime = new Date(today.getTime() - 8 * 60 * 60 * 1000).toISOString(); // 转换为 UTC

    console.log(`📅 查询时间范围: ${today.toLocaleString('zh-CN')} 之后`);
    console.log(`   UTC 时间: ${startTime}\n`);

    // 查询 generations 表
    const { data, error } = await supabase
        .from('generations')
        .select('id, type, status, result_url, image_url, created_at')
        .eq('user_id', userId)
        .eq('type', 'image')
        .eq('status', 'completed')
        .gte('created_at', startTime)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('❌ 查询失败:', error.message);
        process.exit(1);
    }

    console.log(`✅ 找到 ${data.length} 条图片记录\n`);

    if (data.length === 0) {
        console.log('⚠️ 没有找到符合条件的图片数据');
        process.exit(0);
    }

    // 提取下载 URL
    const urls = [];
    data.forEach((item, index) => {
        const url = item.result_url || item.image_url;
        if (url) {
            urls.push(url);
            console.log(`${index + 1}. ${url.substring(0, 80)}...`);
        }
    });

    console.log(`\n📊 共收集到 ${urls.length} 个有效下载地址`);

    // 保存到桌面
    const desktopPath = path.join('C:', 'Users', '少年之志', 'Desktop');
    const outputFile = path.join(desktopPath, 'Irene888_images_after_530.txt');

    fs.writeFileSync(outputFile, urls.join('\n'), 'utf-8');
    console.log(`\n✅ 已保存到: ${outputFile}`);
    console.log(`   共 ${urls.length} 个下载地址\n`);
}

exportImages().catch(console.error);
