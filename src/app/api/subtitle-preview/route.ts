/**
 * 字幕真实预览 API
 * 调用 FFmpeg 生成单帧带字幕的预览图，与最终视频输出像素级一致
 * 
 * 支持两种请求方式：
 * 1. JSON body: { imagePath, subtitle, aspectRatio } — 适用于 URL 图片
 * 2. FormData: imageFile + subtitleJson + aspectRatio — 适用于本地上传文件
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'ffmpeg-slideshow.py');
const PREVIEW_DIR = path.join(process.cwd(), '.temp', 'preview');

// 跨平台 Python 命令检测：Linux 优先 python3，Windows 优先 python
const PYTHON_CMD = (() => {
    for (const cmd of ['python3', 'python']) {
        try {
            execSync(`${cmd} --version`, { stdio: 'ignore' });
            return cmd;
        } catch { /* 忽略 */ }
    }
    return 'python3'; // 兜底
})();

// 确保预览目录存在
if (!fs.existsSync(PREVIEW_DIR)) {
    fs.mkdirSync(PREVIEW_DIR, { recursive: true });
}

export async function POST(request: NextRequest) {
    try {
        let localImagePath = '';
        let subtitle: any = null;
        let aspectRatio = '9:16';
        let cacheKey = '';
        let originalImageUrl = '';  // 原始图片 URL（Worker 用）

        const contentType = request.headers.get('content-type') || '';

        if (contentType.includes('multipart/form-data')) {
            // === FormData 模式：本地文件上传 ===
            const formData = await request.formData();
            const imageFile = formData.get('imageFile') as File | null;
            const subtitleJson = formData.get('subtitle') as string | null;
            aspectRatio = (formData.get('aspectRatio') as string) || '9:16';

            if (!imageFile || !subtitleJson) {
                return NextResponse.json({ error: 'Missing imageFile or subtitle' }, { status: 400 });
            }

            subtitle = JSON.parse(subtitleJson);

            // 保存上传的文件到临时目录
            const buffer = Buffer.from(await imageFile.arrayBuffer());
            const fileHash = crypto.createHash('md5').update(buffer).digest('hex').slice(0, 8);
            const ext = imageFile.name?.split('.').pop() || 'jpg';
            localImagePath = path.join(PREVIEW_DIR, `input_${fileHash}.${ext}`);
            if (!fs.existsSync(localImagePath)) {
                fs.writeFileSync(localImagePath, buffer);
            }

            cacheKey = crypto.createHash('md5')
                .update(JSON.stringify({ fileHash, subtitle, aspectRatio }))
                .digest('hex').slice(0, 12);
        } else {
            // === JSON 模式：URL 图片 ===
            const body = await request.json();
            const { imagePath } = body;
            subtitle = body.subtitle;
            aspectRatio = body.aspectRatio || '9:16';

            if (!imagePath || !subtitle) {
                return NextResponse.json({ error: 'Missing imagePath or subtitle' }, { status: 400 });
            }

            localImagePath = imagePath;

            // 处理各种路径格式
            if (imagePath.startsWith('/uploads/')) {
                localImagePath = path.join(process.cwd(), 'public', imagePath);
            } else if (imagePath.startsWith('http')) {
                originalImageUrl = imagePath;  // 保留原始 URL 给 Worker
                try {
                    const tmpPath = path.join(PREVIEW_DIR, `input_${Date.now()}.jpg`);
                    const response = await fetch(imagePath);
                    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
                    const buf = Buffer.from(await response.arrayBuffer());
                    fs.writeFileSync(tmpPath, buf);
                    localImagePath = tmpPath;
                } catch (e) {
                    console.error('[Preview API] Failed to download image:', e);
                    return NextResponse.json({ error: 'Failed to download image' }, { status: 400 });
                }
            }

            cacheKey = crypto.createHash('md5')
                .update(JSON.stringify({ imagePath, subtitle, aspectRatio }))
                .digest('hex').slice(0, 12);
        }

        // 检查图片是否存在
        if (!fs.existsSync(localImagePath)) {
            return NextResponse.json({ error: `Image not found: ${localImagePath}` }, { status: 404 });
        }

        const outputPath = path.join(PREVIEW_DIR, `preview_${cacheKey}.jpg`);

        // 缓存命中（5 分钟内）
        if (fs.existsSync(outputPath)) {
            const stat = fs.statSync(outputPath);
            if (Date.now() - stat.mtimeMs < 5 * 60 * 1000) {
                const imageBuffer = fs.readFileSync(outputPath);
                return new NextResponse(imageBuffer, {
                    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' },
                });
            }
        }

        // === Mac Studio Worker 预览（优先） ===
        const MAC_WORKER_URL = process.env.MAC_WORKER_URL || 'http://127.0.0.1:9091';
        const MAC_WORKER_TOKEN = process.env.MAC_WORKER_TOKEN || '';

        // 只对有原始 HTTP URL 的请求使用 Worker（本地上传文件无法传远程）
        if (originalImageUrl) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 10000);

                const workerResp = await fetch(`${MAC_WORKER_URL}/api/preview`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(MAC_WORKER_TOKEN ? { 'Authorization': `Bearer ${MAC_WORKER_TOKEN}` } : {}),
                    },
                    body: JSON.stringify({ imageUrl: originalImageUrl, subtitle, aspectRatio }),
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (workerResp.ok) {
                    const workerBuffer = Buffer.from(await workerResp.arrayBuffer());
                    // 写入本地缓存
                    fs.writeFileSync(outputPath, workerBuffer);
                    console.log('[Preview API] ✅ Worker preview success');
                    return new NextResponse(workerBuffer, {
                        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' },
                    });
                }
                console.warn(`[Preview API] Worker failed: ${workerResp.status}, falling back to local`);
            } catch (e: any) {
                console.warn(`[Preview API] Worker unavailable: ${e.message}, falling back to local`);
            }
        }

        // 调用本地 Python 脚本生成预览帧（回退方案）
        const subtitleJson = JSON.stringify(subtitle);
        const imagesJson = JSON.stringify([localImagePath]);

        const result = await new Promise<boolean>((resolve) => {
            const child = spawn(PYTHON_CMD, [
                SCRIPT_PATH,
                '--mode', 'preview',
                '--images', imagesJson,
                '--subtitle', subtitleJson,
                '--aspect', aspectRatio,
                '--output', outputPath,
            ], { cwd: process.cwd(), timeout: 15000 });

            let stderr = '';
            child.stderr?.on('data', (data) => { stderr += data.toString(); });
            child.stdout?.on('data', (data) => { console.log('[Preview]', data.toString().trim()); });

            child.on('close', (code) => {
                if (code === 0 && fs.existsSync(outputPath)) {
                    resolve(true);
                } else {
                    console.error('[Preview API] FFmpeg failed:', stderr.slice(-500));
                    resolve(false);
                }
            });
            child.on('error', (err) => { console.error('[Preview API] Spawn error:', err); resolve(false); });
        });

        if (!result) {
            return NextResponse.json({ error: 'Preview generation failed' }, { status: 500 });
        }

        const imageBuffer = fs.readFileSync(outputPath);
        return new NextResponse(imageBuffer, {
            headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' },
        });

    } catch (error) {
        console.error('[Preview API] Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
