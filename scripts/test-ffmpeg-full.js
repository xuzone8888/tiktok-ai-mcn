/**
 * 综合测试 FFmpeg 轮播视频生成
 * 测试所有功能：视频生成、字幕、BGM、转场效果
 * 
 * 运行: node scripts/test-ffmpeg-full.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PYTHON_SCRIPT = path.join(__dirname, 'ffmpeg-slideshow.py');
const TEST_IMAGES_DIR = path.join(__dirname, '..', 'public', 'images');
const MUSIC_DIR = path.join(__dirname, '..', 'public', 'music');
const OUTPUT_DIR = path.join(__dirname, '..', '.temp', 'test-output');

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// 获取测试图片
function getTestImages(count = 2) {
    const allImages = fs.readdirSync(TEST_IMAGES_DIR)
        .filter(f => f.endsWith('.png') || f.endsWith('.jpg'))
        .map(f => path.join(TEST_IMAGES_DIR, f));

    if (allImages.length < count) {
        console.error(`需要至少 ${count} 张测试图片，只找到 ${allImages.length} 张`);
        process.exit(1);
    }

    return allImages.slice(0, count);
}

// 获取测试音乐
function getTestMusic() {
    if (!fs.existsSync(MUSIC_DIR)) {
        console.warn('音乐目录不存在:', MUSIC_DIR);
        return null;
    }
    const musicFiles = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith('.mp3'));
    if (musicFiles.length === 0) {
        console.warn('未找到 MP3 音乐文件');
        return null;
    }
    return path.join(MUSIC_DIR, musicFiles[0]);
}

// 运行 Python 脚本
function runPythonScript(args, testName) {
    return new Promise((resolve) => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`测试: ${testName}`);
        console.log('='.repeat(60));

        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        console.log(`命令: ${pythonCmd} ${path.basename(PYTHON_SCRIPT)}`);
        console.log('参数:');
        for (let i = 0; i < args.length; i += 2) {
            const value = args[i + 1] || '';
            console.log(`  ${args[i]}: ${value.substring(0, 100)}${value.length > 100 ? '...' : ''}`);
        }

        const startTime = Date.now();
        const proc = spawn(pythonCmd, [PYTHON_SCRIPT, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`\n耗时: ${duration}s, 退出码: ${code}`);

            if (code === 0) {
                const outputPath = args[args.indexOf('--output') + 1];
                if (fs.existsSync(outputPath)) {
                    const stats = fs.statSync(outputPath);
                    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
                    console.log(`✅ 成功! 视频大小: ${sizeMB} MB`);
                    console.log(`   路径: ${outputPath}`);
                    resolve({ success: true, path: outputPath, size: stats.size });
                } else {
                    console.log('❌ 进程成功但视频文件未创建');
                    resolve({ success: false, error: 'Output file not found' });
                }
            } else {
                console.log(`❌ 失败!`);
                if (stderr) {
                    console.log('错误信息:');
                    console.log(stderr.substring(0, 500));
                }
                resolve({ success: false, error: stderr });
            }
        });

        proc.on('error', (err) => {
            console.log(`❌ Spawn 错误: ${err.message}`);
            resolve({ success: false, error: err.message });
        });
    });
}

// 测试用例
async function runAllTests() {
    console.log('\n' + '🎬'.repeat(30));
    console.log('    FFmpeg 轮播视频生成 - 综合测试');
    console.log('🎬'.repeat(30));

    const testImages = getTestImages(3);
    const testMusic = getTestMusic();
    const results = [];

    console.log(`\n测试图片: ${testImages.length} 张`);
    testImages.forEach((img, i) => console.log(`  [${i + 1}] ${path.basename(img)}`));
    console.log(`测试音乐: ${testMusic ? path.basename(testMusic) : '无'}`);

    // ========================================
    // 测试 1: 基础视频生成 (无特效)
    // ========================================
    const test1Output = path.join(OUTPUT_DIR, 'test1_basic.mp4');
    results.push(await runPythonScript([
        '--images', JSON.stringify(testImages.slice(0, 2)),
        '--output', test1Output,
        '--aspect', '9:16',
        '--duration', '2',
        '--transition', 'none',
    ], '基础视频生成 (无转场, 无音乐, 无字幕)'));

    // ========================================
    // 测试 2: 带转场效果
    // ========================================
    const test2Output = path.join(OUTPUT_DIR, 'test2_fade_transition.mp4');
    results.push(await runPythonScript([
        '--images', JSON.stringify(testImages.slice(0, 2)),
        '--output', test2Output,
        '--aspect', '9:16',
        '--duration', '3',
        '--transition', 'fade',
    ], '带 Fade 转场效果'));

    // ========================================
    // 测试 3: 带背景音乐
    // ========================================
    if (testMusic) {
        const test3Output = path.join(OUTPUT_DIR, 'test3_with_music.mp4');
        results.push(await runPythonScript([
            '--images', JSON.stringify(testImages.slice(0, 2)),
            '--output', test3Output,
            '--aspect', '9:16',
            '--duration', '3',
            '--transition', 'fade',
            '--music', testMusic,
        ], '带背景音乐 (BGM)'));
    } else {
        console.log('\n⚠️ 跳过音乐测试 - 未找到音乐文件');
        results.push({ success: false, error: 'No music file', skipped: true });
    }

    // ========================================
    // 测试 4: 带字幕 (基础样式)
    // ========================================
    const test4Output = path.join(OUTPUT_DIR, 'test4_with_subtitle.mp4');
    const basicSubtitle = {
        text: '测试字幕 - Hello World',
        position: 80,
        fontSize: 48,
        fontColor: '#FFFFFF',
        fontFamily: 'Cinzel-VariableFont_wght',
        borderWidth: 2,
        borderColor: '#000000',
        shadow: true,
    };
    results.push(await runPythonScript([
        '--images', JSON.stringify(testImages.slice(0, 2)),
        '--output', test4Output,
        '--aspect', '9:16',
        '--duration', '3',
        '--transition', 'fade',
        '--subtitle', JSON.stringify(basicSubtitle),
    ], '带字幕 (白色文字, 黑色描边, 阴影)'));

    // ========================================
    // 测试 5: 完整配置 (音乐 + 字幕 + 转场)
    // ========================================
    if (testMusic) {
        const test5Output = path.join(OUTPUT_DIR, 'test5_full_config.mp4');
        const fullSubtitle = {
            text: '完整测试 - 音乐+字幕+转场',
            position: 75,
            fontSize: 42,
            fontColor: '#FFD700',  // 金色
            fontFamily: 'Cinzel-VariableFont_wght',
            borderWidth: 3,
            borderColor: '#000000',
            shadow: true,
        };
        results.push(await runPythonScript([
            '--images', JSON.stringify(testImages),
            '--output', test5Output,
            '--aspect', '9:16',
            '--duration', '4',
            '--transition', 'dissolve',
            '--music', testMusic,
            '--subtitle', JSON.stringify(fullSubtitle),
        ], '完整配置 (3张图片 + 音乐 + 字幕 + Dissolve转场)'));
    } else {
        results.push({ success: false, error: 'No music file', skipped: true });
    }

    // ========================================
    // 测试 6: 16:9 横屏比例
    // ========================================
    const test6Output = path.join(OUTPUT_DIR, 'test6_landscape.mp4');
    results.push(await runPythonScript([
        '--images', JSON.stringify(testImages.slice(0, 2)),
        '--output', test6Output,
        '--aspect', '16:9',
        '--duration', '2',
        '--transition', 'wipeleft',
    ], '16:9 横屏比例 + WipeLeft 转场'));

    // ========================================
    // 测试总结
    // ========================================
    console.log('\n' + '='.repeat(60));
    console.log('📊 测试结果汇总');
    console.log('='.repeat(60));

    const testNames = [
        '基础视频生成',
        'Fade 转场',
        '背景音乐',
        '字幕效果',
        '完整配置',
        '16:9 横屏',
    ];

    let passed = 0;
    let failed = 0;
    let skipped = 0;

    results.forEach((result, i) => {
        if (result.skipped) {
            console.log(`  ⏭️ ${testNames[i]}: 跳过`);
            skipped++;
        } else if (result.success) {
            console.log(`  ✅ ${testNames[i]}: 通过`);
            passed++;
        } else {
            console.log(`  ❌ ${testNames[i]}: 失败`);
            failed++;
        }
    });

    console.log('\n' + '-'.repeat(60));
    console.log(`  总计: ${passed} 通过, ${failed} 失败, ${skipped} 跳过`);
    console.log(`  输出目录: ${OUTPUT_DIR}`);
    console.log('='.repeat(60));

    if (failed === 0) {
        console.log('\n🎉 所有测试通过！视频生成功能正常工作。\n');
    } else {
        console.log('\n⚠️ 部分测试失败，请检查上述错误信息。\n');
    }
}

// 运行测试
runAllTests().catch(console.error);
