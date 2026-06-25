/**
 * 导出用户图片下载地址脚本
 * 用于提取指定用户今天在批量制图中生成的所有图片 URL
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 配置
const USERNAME = 'Irene888';
const OUTPUT_PATH = path.join(os.homedir(), 'Desktop', `${USERNAME}_images_${new Date().toISOString().split('T')[0]}.txt`);

// 创建 Supabase 客户端
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function exportUserImages() {
    console.log(`\n🔍 正在查询用户 ${USERNAME} 的图片数据...\n`);

    // 用户 Irene888 的 ID (从管理后台获取)
    const userId = '00000000-0000-0000-0000-000000000000';
    const userEmail = 'user.com';

    console.log(`✅ 用户: ${USERNAME} (${userEmail})`);
    console.log(`   用户 ID: ${userId}\n`);

    // 2. 获取今天的日期范围 (东八区)
    const today = new Date();
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);

    // 转换为 UTC (减去8小时)
    const startOfDayUTC = new Date(startOfDay.getTime() - 8 * 60 * 60 * 1000);
    const endOfDayUTC = new Date(startOfDayUTC.getTime() + 24 * 60 * 60 * 1000);

    console.log(`📅 查询日期范围 (东八区):`);
    console.log(`   从: ${startOfDay.toLocaleString('zh-CN')}`);
    console.log(`   到: ${new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000).toLocaleString('zh-CN')}\n`);

    // 3. 查询该用户今天的所有图片任务
    const { data: tasks, error: tasksError } = await supabase
        .from('ecom_image_tasks')
        .select('id, mode, status, output_items, created_at')
        .eq('user_id', userId)
        .gte('created_at', startOfDayUTC.toISOString())
        .lt('created_at', endOfDayUTC.toISOString())
        .order('created_at', { ascending: true });

    if (tasksError) {
        console.error('❌ 查询任务失败:', tasksError.message);
        return;
    }

    if (!tasks || tasks.length === 0) {
        console.log('📭 今天没有找到任何图片任务');
        return;
    }

    console.log(`📦 找到 ${tasks.length} 个图片任务\n`);

    // 4. 提取所有图片 URL
    const allImageUrls = [];
    let totalImages = 0;

    for (const task of tasks) {
        const outputItems = task.output_items || [];
        const taskImages = [];

        for (const item of outputItems) {
            if (item.url && item.status === 'completed') {
                taskImages.push(item.url);
                totalImages++;
            }
        }

        if (taskImages.length > 0) {
            console.log(`   任务 ${task.id.substring(0, 8)}... (${task.mode}): ${taskImages.length} 张图片`);
            allImageUrls.push(...taskImages);
        }
    }

    if (allImageUrls.length === 0) {
        console.log('\n📭 没有找到已完成的图片');
        return;
    }

    console.log(`\n📊 统计:`);
    console.log(`   总任务数: ${tasks.length}`);
    console.log(`   总图片数: ${totalImages}`);

    // 5. 写入文件
    const fileContent = [
        `# ${USERNAME} 的图片下载地址`,
        `# 导出时间: ${new Date().toLocaleString('zh-CN')}`,
        `# 图片数量: ${allImageUrls.length}`,
        ``,
        ...allImageUrls,
        ``
    ].join('\n');

    fs.writeFileSync(OUTPUT_PATH, fileContent, 'utf-8');
    console.log(`\n✅ 文件已保存到: ${OUTPUT_PATH}`);
    console.log(`\n🎉 完成！共 ${allImageUrls.length} 个图片链接`);
}

// 执行
exportUserImages().catch(console.error);
