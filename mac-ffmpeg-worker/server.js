/**
 * Mac Studio FFmpeg Worker 服务
 * 
 * 职责：接收阿里云 ECS 的渲染任务，调用 FFmpeg 生成视频，上传 OSS 后返回 URL。
 * 只处理 CPU 密集的 FFmpeg 渲染 + 音频合成，其余逻辑（AI文案、TTS、鉴权）留在 ECS。
 */

require('dotenv').config();

const express = require('express');
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { mergeVoiceover } = require('./merge-audio');
const { uploadToOSS } = require('./oss-upload');

const app = express();
app.use(express.json({ limit: '50mb' })); // 配音 base64 约 160KB/个，50MB 绰绰有余

// ========================================
// 配置
// ========================================
const PORT = process.env.WORKER_PORT || 9090;
const AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN || '';
const PROJECT_ROOT = path.resolve(__dirname, '..'); // 项目根目录 (tiktok-ai-mcn/)
const PYTHON_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'ffmpeg-slideshow.py');
const MUSIC_DIR = path.join(PROJECT_ROOT, 'public', 'music');
const TEMP_DIR = path.join(PROJECT_ROOT, '.temp', 'worker');

// 确保临时目录存在
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Python 命令检测
const PYTHON_CMD = (() => {
    const { execSync } = require('child_process');
    for (const cmd of ['python3', 'python']) {
        try { execSync(`${cmd} --version`, { stdio: 'ignore' }); return cmd; } catch {}
    }
    return 'python3';
})();
console.log(`[Worker] Python: ${PYTHON_CMD}, Script: ${PYTHON_SCRIPT}`);

// ========================================
// 鉴权中间件
// ========================================
function authMiddleware(req, res, next) {
    if (!AUTH_TOKEN) return next(); // 开发模式无 Token 时跳过
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token !== AUTH_TOKEN) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}
app.use('/api', authMiddleware);

// ========================================
// GET /health — 健康检查
// ========================================
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        python: PYTHON_CMD,
        scriptExists: fs.existsSync(PYTHON_SCRIPT),
        musicCount: fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith('.mp3')).length,
        uptime: process.uptime(),
    });
});

// ========================================
// POST /api/render — 完整视频渲染
// ========================================
app.post('/api/render', async (req, res) => {
    const startTime = Date.now();
    const taskId = crypto.randomUUID().slice(0, 8);
    const log = (msg) => console.log(`[Render ${taskId}] ${msg}`);

    try {
        const {
            images,            // string[] — OSS 图片 URL 列表
            subtitle,          // object — 字幕配置 JSON
            bgm = 'random',   // 'random' | 'none'
            aspectRatio = '9:16',
            durationPerImage = 2,
            transition = 'fade',
            voiceover = null,  // { base64, duration, timestamps } | null
        } = req.body;

        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).json({ error: 'images is required' });
        }

        log(`Start: ${images.length} images, ${aspectRatio}, ${transition}, bgm=${bgm}, voice=${!!voiceover}`);

        // 1. 下载图片到本地
        const workDir = path.join(TEMP_DIR, taskId);
        fs.mkdirSync(workDir, { recursive: true });

        const localImages = [];
        for (let i = 0; i < images.length; i++) {
            const imgPath = path.join(workDir, `${String(i).padStart(4, '0')}.jpg`);
            try {
                const resp = await fetch(images[i]);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const buf = Buffer.from(await resp.arrayBuffer());
                await fsp.writeFile(imgPath, buf);
                localImages.push(imgPath);
            } catch (e) {
                log(`Image ${i} download failed: ${e.message}`);
            }
        }

        if (localImages.length === 0) {
            cleanup(workDir);
            return res.status(400).json({ error: 'All images failed to download' });
        }
        log(`Downloaded ${localImages.length}/${images.length} images`);

        // 2. 选择 BGM
        let musicPath = null;
        if (bgm === 'random') {
            const musicFiles = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith('.mp3'));
            if (musicFiles.length > 0) {
                musicPath = path.join(MUSIC_DIR, musicFiles[Math.floor(Math.random() * musicFiles.length)]);
                log(`BGM: ${path.basename(musicPath)}`);
            }
        }

        // 3. 调用 Python FFmpeg 渲染
        const outputPath = path.join(workDir, 'output.mp4');
        const args = [
            PYTHON_SCRIPT,
            '--images', JSON.stringify(localImages),
            '--output', outputPath,
            '--aspect', aspectRatio,
            '--duration', String(durationPerImage),
            '--transition', transition,
        ];

        if (musicPath) args.push('--music', musicPath);
        if (subtitle && subtitle.text) args.push('--subtitle', JSON.stringify(subtitle));

        log(`Running FFmpeg...`);
        const ffmpegResult = await runPython(args);
        if (!ffmpegResult.success || !fs.existsSync(outputPath)) {
            log(`FFmpeg failed: ${ffmpegResult.stderr.slice(-300)}`);
            cleanup(workDir);
            return res.status(500).json({ error: 'FFmpeg render failed', detail: ffmpegResult.stderr.slice(-500) });
        }
        log(`FFmpeg done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

        // 4. 合成配音（如果有）
        let finalVideoPath = outputPath;
        if (voiceover && voiceover.base64) {
            try {
                const audioBuffer = Buffer.from(voiceover.base64, 'base64');
                log(`Merging voiceover: ${audioBuffer.length} bytes, ${voiceover.duration}s`);
                finalVideoPath = await mergeVoiceover(outputPath, audioBuffer, voiceover.duration, workDir);
                log(`Audio merge done`);
            } catch (e) {
                log(`Audio merge failed: ${e.message}, using video without voiceover`);
                finalVideoPath = outputPath;
            }
        }

        // 5. 上传到 OSS
        const videoBuffer = await fsp.readFile(finalVideoPath);
        const ossKey = `videos/slideshow/worker/${taskId}-${Date.now()}.mp4`;
        log(`Uploading to OSS: ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`);
        const videoUrl = await uploadToOSS(videoBuffer, ossKey, 'video/mp4');
        log(`Upload done: ${videoUrl}`);

        // 6. 清理临时文件
        cleanup(workDir);

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        log(`Complete in ${elapsed}s`);

        res.json({
            success: true,
            videoUrl,
            elapsed: parseFloat(elapsed),
        });

    } catch (error) {
        console.error(`[Render ${taskId}] Error:`, error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// POST /api/preview — 字幕预览
// ========================================
app.post('/api/preview', async (req, res) => {
    const taskId = crypto.randomUUID().slice(0, 8);

    try {
        const { imageUrl, subtitle, aspectRatio = '9:16' } = req.body;
        if (!imageUrl || !subtitle) {
            return res.status(400).json({ error: 'imageUrl and subtitle required' });
        }

        const workDir = path.join(TEMP_DIR, `preview_${taskId}`);
        fs.mkdirSync(workDir, { recursive: true });

        // 下载图片
        const imgPath = path.join(workDir, 'input.jpg');
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`Image download failed: ${resp.status}`);
        await fsp.writeFile(imgPath, Buffer.from(await resp.arrayBuffer()));

        // 调用 Python 预览模式
        const outputPath = path.join(workDir, 'preview.jpg');
        const args = [
            PYTHON_SCRIPT,
            '--mode', 'preview',
            '--images', JSON.stringify([imgPath]),
            '--subtitle', JSON.stringify(subtitle),
            '--aspect', aspectRatio,
            '--output', outputPath,
        ];

        const result = await runPython(args, 15000);
        if (!result.success || !fs.existsSync(outputPath)) {
            cleanup(workDir);
            return res.status(500).json({ error: 'Preview generation failed' });
        }

        const imageBuffer = await fsp.readFile(outputPath);
        cleanup(workDir);

        res.set('Content-Type', 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=300');
        res.send(imageBuffer);

    } catch (error) {
        console.error(`[Preview ${taskId}] Error:`, error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// 工具函数
// ========================================

/** 运行 Python 脚本 */
function runPython(args, timeout = 300000) {
    return new Promise((resolve) => {
        const proc = spawn(PYTHON_CMD, args, {
            cwd: PROJECT_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
            proc.kill();
            resolve({ success: false, stdout, stderr: 'Timeout after ' + (timeout / 1000) + 's' });
        }, timeout);

        proc.on('close', (code) => {
            clearTimeout(timer);
            resolve({ success: code === 0, stdout, stderr });
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            resolve({ success: false, stdout: '', stderr: err.message });
        });
    });
}

/** 清理临时目录 */
function cleanup(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ========================================
// 启动
// ========================================
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  FFmpeg Worker running on port ${PORT}`);
    console.log(`  Python: ${PYTHON_CMD}`);
    console.log(`  Script: ${PYTHON_SCRIPT}`);
    console.log(`  Music:  ${MUSIC_DIR}`);
    console.log(`  Auth:   ${AUTH_TOKEN ? 'ENABLED' : 'DISABLED (dev mode)'}`);
    console.log(`========================================\n`);
});
