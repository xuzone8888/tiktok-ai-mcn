/**
 * 快速测试字幕功能
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PYTHON_SCRIPT = path.join(__dirname, 'ffmpeg-slideshow.py');
const TEST_IMAGES = [
    path.join(__dirname, '..', 'public', 'images', 'toryx_logo_dark.png'),
    path.join(__dirname, '..', 'public', 'images', 'toryx_logo_final.png'),
];
const OUTPUT_PATH = path.join(__dirname, '..', '.temp', 'subtitle_test.mp4');

// 确保输出目录存在
const outputDir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// 简单字幕配置 (无自定义字体)
const subtitle = {
    text: 'Test Caption',
    position: 80,
    fontSize: 48,
    fontColor: 'white',  // 使用简单颜色名
    fontFamily: '',      // 不指定字体文件
    borderWidth: 0,
    borderColor: 'black',
    shadow: false,
};

const args = [
    '--images', JSON.stringify(TEST_IMAGES),
    '--output', OUTPUT_PATH,
    '--aspect', '9:16',
    '--duration', '2',
    '--transition', 'fade',
    '--subtitle', JSON.stringify(subtitle),
];

console.log('=== 字幕测试 ===');
console.log('Python 脚本:', PYTHON_SCRIPT);
console.log('输出路径:', OUTPUT_PATH);
console.log('字幕配置:', JSON.stringify(subtitle, null, 2));

console.log('\n命令参数:');
args.forEach((arg, i) => {
    console.log(`  [${i}]: ${arg.substring(0, 150)}${arg.length > 150 ? '...' : ''}`);
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
    process.stdout.write('[STDOUT] ' + text);
});

proc.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    process.stderr.write('[STDERR] ' + text);
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
        console.log(`❌ 进程失败`);
        console.log('\n完整 stderr:');
        console.log(stderr);
    }
});

proc.on('error', (err) => {
    console.error('Spawn 错误:', err.message);
});
