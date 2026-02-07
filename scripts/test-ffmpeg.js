/**
 * 直接测试 FFmpeg 生成脚本
 * 运行: node scripts/test-ffmpeg.js
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PYTHON_SCRIPT = path.join(__dirname, 'ffmpeg-slideshow.py');
const TEST_IMAGE = path.join(__dirname, '..', 'public', 'images', 'toryx_logo_dark.png');
const OUTPUT_PATH = path.join(__dirname, '..', 'temp_test_video.mp4');

// 确保测试图片存在
if (!fs.existsSync(TEST_IMAGE)) {
    console.error('测试图片不存在:', TEST_IMAGE);
    process.exit(1);
}

console.log('=== FFmpeg 测试脚本 ===');
console.log('Python 脚本:', PYTHON_SCRIPT);
console.log('测试图片:', TEST_IMAGE);
console.log('输出路径:', OUTPUT_PATH);

// 构建参数 - 与 ffmpeg-slideshow.ts 相同的方式
const args = [
    '--images', JSON.stringify([TEST_IMAGE]),
    '--output', OUTPUT_PATH,
    '--aspect', '9:16',
    '--duration', '2',
    '--transition', 'fade',
];

console.log('\n命令参数:');
args.forEach((arg, i) => {
    console.log(`  [${i}]: ${arg}`);
});

console.log('\n正在执行...\n');

const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
const proc = spawn(pythonCmd, [PYTHON_SCRIPT, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

proc.stdout.on('data', (data) => {
    const text = data.toString();
    stdout += text;
    process.stdout.write(text);
});

proc.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    process.stderr.write(text);
});

proc.on('close', (code) => {
    console.log(`\n=== 进程退出 (code: ${code}) ===`);

    if (code === 0) {
        if (fs.existsSync(OUTPUT_PATH)) {
            const stats = fs.statSync(OUTPUT_PATH);
            console.log(`✅ 视频生成成功! 大小: ${stats.size} 字节`);
            console.log(`   路径: ${OUTPUT_PATH}`);
        } else {
            console.log('❌ 进程成功但视频文件未创建');
        }
    } else {
        console.log(`❌ 进程失败 (exit code: ${code})`);
        if (stderr) {
            console.log('\nStderr 输出:');
            console.log(stderr);
        }
    }
});

proc.on('error', (err) => {
    console.error('Spawn 错误:', err.message);
});
