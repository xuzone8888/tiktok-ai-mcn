/**
 * TextOverlay 时间模式后端测试脚本
 * 测试内容：
 * 1. timingMode='image' 图片绑定模式
 * 2. timingMode='custom' 自由时间模式
 * 3. remapTextOverlays 批量视频映射
 */

import { generateSlideshow, type TextOverlay, type SubtitleConfig } from '../src/lib/ffmpeg-slideshow';
import * as fs from 'fs/promises';
import * as path from 'path';

// 测试图片路径 - 使用项目中的示例图片
const TEST_IMAGES_DIR = 'e:/TIKTOK-AI/public';

async function findTestImages(): Promise<string[]> {
    try {
        const files = await fs.readdir(TEST_IMAGES_DIR);
        const images = files
            .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
            .slice(0, 4)
            .map(f => path.join(TEST_IMAGES_DIR, f));

        if (images.length < 2) {
            console.log('⚠️ 没有足够的测试图片，使用占位符');
            return [];
        }
        return images;
    } catch {
        return [];
    }
}

// 测试1: 图片模式 TextOverlay
async function testImageMode() {
    console.log('\n========================================');
    console.log('🧪 测试1: 图片模式 (timingMode="image")');
    console.log('========================================\n');

    const images = await findTestImages();
    if (images.length < 2) {
        console.log('❌ 跳过：需要至少2张测试图片');
        return false;
    }

    const textOverlays: TextOverlay[] = [
        {
            id: 'overlay-1',
            text: '第一张图片的文案',
            timingMode: 'image',
            imageIndex: 0,
            boxX: 10,
            boxY: 20,
            boxWidth: 80,
            style: 'classic',
            tone: 'neutral',
            color: '#FFFFFF',
            fontSize: 14,
            fontFamily: 'Microsoft YaHei',
            fontWeight: '400',
            borderWidth: 2,
            borderColor: '#000000',
            shadow: true,
        },
        {
            id: 'overlay-2',
            text: '第二张图片的文案',
            timingMode: 'image',
            imageIndex: 1,
            boxX: 10,
            boxY: 20,
            boxWidth: 80,
            style: 'classic',
            tone: 'neutral',
            color: '#FFFF00',
            fontSize: 16,
            fontFamily: 'Microsoft YaHei',
            fontWeight: '700',
            borderWidth: 2,
            borderColor: '#000000',
            shadow: true,
        },
    ];

    const subtitle: SubtitleConfig = {
        text: '测试配音字幕',
        textOverlays,
    } as any;

    console.log('📝 TextOverlays:', JSON.stringify(textOverlays, null, 2));

    try {
        const result = await generateSlideshow({
            images: images.slice(0, 2),
            aspectRatio: '9:16',
            durationPerImage: 3,
            transition: 'fade',
            subtitle,
        });

        if (result.success) {
            console.log('✅ 图片模式测试通过！');
            console.log('📹 视频路径:', result.videoPath);
            return true;
        } else {
            console.log('❌ 图片模式测试失败:', result.error);
            return false;
        }
    } catch (error: any) {
        console.log('❌ 图片模式测试异常:', error.message);
        return false;
    }
}

// 测试2: 自由模式 TextOverlay
async function testCustomMode() {
    console.log('\n========================================');
    console.log('🧪 测试2: 自由模式 (timingMode="custom")');
    console.log('========================================\n');

    const images = await findTestImages();
    if (images.length < 2) {
        console.log('❌ 跳过：需要至少2张测试图片');
        return false;
    }

    const textOverlays: TextOverlay[] = [
        {
            id: 'custom-1',
            text: '全程显示的水印文字',
            timingMode: 'custom',
            startPercent: 0,
            endPercent: 100,
            boxX: 5,
            boxY: 5,
            boxWidth: 30,
            style: 'classic',
            tone: 'neutral',
            color: '#FFFFFF',
            fontSize: 12,
            fontFamily: 'Microsoft YaHei',
            fontWeight: '400',
            borderWidth: 1,
            borderColor: '#000000',
            shadow: true,
        },
        {
            id: 'custom-2',
            text: '后半段显示的促销文字',
            timingMode: 'custom',
            startPercent: 50,
            endPercent: 100,
            boxX: 10,
            boxY: 70,
            boxWidth: 80,
            style: 'neon',
            tone: 'warm',
            color: '#FF0000',
            fontSize: 18,
            fontFamily: 'Microsoft YaHei',
            fontWeight: '700',
            borderWidth: 2,
            borderColor: '#FFFF00',
            shadow: true,
        },
    ];

    const subtitle: SubtitleConfig = {
        text: '测试配音字幕',
        textOverlays,
    } as any;

    console.log('📝 TextOverlays:', JSON.stringify(textOverlays, null, 2));

    try {
        const result = await generateSlideshow({
            images: images.slice(0, 2),
            aspectRatio: '9:16',
            durationPerImage: 4,
            transition: 'fade',
            subtitle,
        });

        if (result.success) {
            console.log('✅ 自由模式测试通过！');
            console.log('📹 视频路径:', result.videoPath);
            return true;
        } else {
            console.log('❌ 自由模式测试失败:', result.error);
            return false;
        }
    } catch (error: any) {
        console.log('❌ 自由模式测试异常:', error.message);
        return false;
    }
}

// 测试3: 批量视频映射
async function testBatchRemapping() {
    console.log('\n========================================');
    console.log('🧪 测试3: 批量视频映射 (originalImageIndices)');
    console.log('========================================\n');

    const images = await findTestImages();
    if (images.length < 4) {
        console.log('❌ 跳过：需要至少4张测试图片');
        return false;
    }

    // 模拟4张图片生成2个视频的场景
    // 原始 overlays 对应图片 0,1,2,3
    const allOverlays: TextOverlay[] = [
        { id: 'o0', text: '图片0的文案', timingMode: 'image', imageIndex: 0, boxX: 10, boxY: 20, boxWidth: 80, style: 'classic', tone: 'neutral', color: '#FFFFFF' } as TextOverlay,
        { id: 'o1', text: '图片1的文案', timingMode: 'image', imageIndex: 1, boxX: 10, boxY: 20, boxWidth: 80, style: 'classic', tone: 'neutral', color: '#FFFFFF' } as TextOverlay,
        { id: 'o2', text: '图片2的文案', timingMode: 'image', imageIndex: 2, boxX: 10, boxY: 20, boxWidth: 80, style: 'classic', tone: 'neutral', color: '#FFFFFF' } as TextOverlay,
        { id: 'o3', text: '图片3的文案', timingMode: 'image', imageIndex: 3, boxX: 10, boxY: 20, boxWidth: 80, style: 'classic', tone: 'neutral', color: '#FFFFFF' } as TextOverlay,
        { id: 'custom', text: '全程水印', timingMode: 'custom', startPercent: 0, endPercent: 100, boxX: 5, boxY: 5, boxWidth: 30, style: 'classic', tone: 'neutral', color: '#FFFF00' } as TextOverlay,
    ];

    console.log('📝 原始 Overlays (5个):', allOverlays.map(o => `${o.id}: imageIndex=${o.imageIndex ?? 'N/A'}`));

    // 视频2: 使用图片 2,3 (originalImageIndices = [2, 3])
    const subtitle: SubtitleConfig = {
        text: '测试配音字幕',
        textOverlays: allOverlays,
    } as any;

    console.log('\n📦 生成视频2（使用原始图片 2,3）:');
    console.log('   originalImageIndices = [2, 3]');
    console.log('   预期: o2 重映射为 0, o3 重映射为 1, custom 保留');

    try {
        const result = await generateSlideshow({
            images: [images[2], images[3]],
            aspectRatio: '9:16',
            durationPerImage: 3,
            transition: 'fade',
            subtitle,
            originalImageIndices: [2, 3],  // 关键参数
        });

        if (result.success) {
            console.log('✅ 批量映射测试通过！');
            console.log('📹 视频路径:', result.videoPath);
            return true;
        } else {
            console.log('❌ 批量映射测试失败:', result.error);
            return false;
        }
    } catch (error: any) {
        console.log('❌ 批量映射测试异常:', error.message);
        return false;
    }
}

// 主测试函数
async function runAllTests() {
    console.log('\n🚀 开始 TextOverlay 后端功能测试\n');
    console.log('测试项目:');
    console.log('  1. 图片模式 (timingMode="image")');
    console.log('  2. 自由模式 (timingMode="custom")');
    console.log('  3. 批量视频映射 (originalImageIndices)');

    const results = {
        imageMode: await testImageMode(),
        customMode: await testCustomMode(),
        batchRemapping: await testBatchRemapping(),
    };

    console.log('\n========================================');
    console.log('📊 测试结果汇总');
    console.log('========================================\n');
    console.log(`图片模式:     ${results.imageMode ? '✅ 通过' : '❌ 失败'}`);
    console.log(`自由模式:     ${results.customMode ? '✅ 通过' : '❌ 失败'}`);
    console.log(`批量映射:     ${results.batchRemapping ? '✅ 通过' : '❌ 失败'}`);
    console.log('');

    const allPassed = Object.values(results).every(r => r);
    if (allPassed) {
        console.log('🎉 所有测试通过！后端功能正常。');
    } else {
        console.log('⚠️ 部分测试失败，请检查日志。');
    }
}

// 运行测试
runAllTests().catch(console.error);
