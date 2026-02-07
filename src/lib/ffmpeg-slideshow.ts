/**
 * FFmpeg 轮播视频生成封装
 * 调用 Python 脚本生成视频并上传到 OSS
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import crypto from 'crypto';
import os from 'os';

const PYTHON_SCRIPT = path.join(process.cwd(), 'scripts', 'ffmpeg-slideshow.py');
// 使用项目目录下的 .temp 文件夹，避免 Windows 用户目录含中文导致的路径问题
const TEMP_DIR = path.join(process.cwd(), '.temp', 'slideshow');
const OUTPUT_DIR = path.join(process.cwd(), '.temp', 'slideshow', 'output');

// 预设音乐目录 (使用新的 public/music/ 目录)
const PRESET_MUSIC_DIR = path.join(process.cwd(), 'public', 'music');

// 字幕风格预设类型
export type SubtitleStyle = 'classic' | 'trending' | 'cinema' | 'neon' | 'minimal';

// 色调类型
export type SubtitleTone = 'warm' | 'cool' | 'neutral';

// 图文字幕 - 单个文本叠加层
export interface TextOverlay {
    id: string;                     // 唯一标识
    text: string;                   // 文本内容

    // 时间模式
    timingMode: 'image' | 'custom'; // 图片绑定 vs 自由时间

    // 模式A: 图片绑定 (timingMode='image')
    imageIndex?: number;            // 绑定图片序号 (0-based)

    // 模式B: 自由时间 (timingMode='custom', 百分比 0-100)
    startPercent?: number;          // 开始位置 (视频时长百分比)
    endPercent?: number;            // 结束位置 (视频时长百分比)

    // 定位 (百分比 0-100)
    boxX: number;
    boxY: number;
    boxWidth: number;
    boxHeight?: number;             // 可选高度 (仅前端预览用)

    // ⭐ 新增：位置模式 (默认 'fixed')
    positionMode?: 'fixed' | 'random';

    // ⭐ 新增：样式模式 (默认 'custom')
    styleMode?: 'custom' | 'inherit' | 'random';

    // 样式（保持必填，兼容旧代码）
    style: SubtitleStyle;
    tone: SubtitleTone;
    color: string;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: string;
    borderWidth?: number;
    borderColor?: string;
    shadow?: boolean;
}

// ⭐ 新增：视频模板接口 (用于批量生成)
export interface VideoTemplate {
    voiceSubtitle: {
        boxY: number;
        style: SubtitleStyle;
        tone: SubtitleTone;
        color: string;
    };
    textOverlays: Array<{
        boxWidth: number;
        positionMode: 'fixed' | 'random';
        styleMode: 'inherit' | 'custom' | 'random';
        fixedPosition?: { boxX: number; boxY: number };
    }>;
    aiSubtitle?: {
        prompt: string;
        style: string;
        language: 'en' | 'zh';
        mode: 'fixed' | 'random';
    };
    aiVoice?: {
        voiceId: string;
        mode: 'fixed' | 'random' | 'balanced';
    };
}

// 增强型字幕配置 - 支持可视化编辑
export interface SubtitleConfig {
    text: string;                  // 字幕文本

    // 方框定位 (百分比 0-100)
    boxX: number;                  // 左边距
    boxY: number;                  // 上边距
    boxWidth: number;              // 宽度

    // 风格预设
    style: SubtitleStyle;          // 预设风格
    tone: SubtitleTone;            // 色调
    color: string;                 // 具体颜色 #FFFFFF

    // 兼容旧版本（由风格预设自动填充）
    position?: number;             // Y轴位置 (旧版)
    fontSize?: number;             // 字体大小 (旧版)
    fontColor?: string;            // 字体颜色 (旧版)
    fontFamily?: string;           // 字体文件名
    borderWidth?: number;          // 描边宽度
    borderColor?: string;          // 描边颜色
    shadow?: boolean;              // 是否开启阴影
    fontWeight?: string;           // 字体粗细 ('400', '600', '700' 等)
    voiceDuration?: number;        // 配音时长(秒)
    wordTimestamps?: Array<{ word: string; start: number; end: number }>; // 词级时间戳

    // 新增：图文字幕
    textOverlays?: TextOverlay[];
}

export interface SlideshowOptions {
    images: string[];              // 本地图片路径列表
    aspectRatio: '9:16' | '16:9';
    durationPerImage: number;      // 每张图片时长(秒)
    transition: string;            // 转场效果 (支持 xfade 所有效果)
    musicPath?: string;            // 音乐文件路径
    subtitle?: SubtitleConfig | null;  // 字幕配置 (可选)
    originalImageIndices?: number[];   // 批量生成时的原始图片索引 (用于 textOverlay 重映射)
}

export interface SlideshowResult {
    success: boolean;
    videoPath?: string;
    error?: string;
}

/**
 * 获取预设音乐列表
 */
export async function getPresetMusicList(): Promise<string[]> {
    try {
        const files = await fs.readdir(PRESET_MUSIC_DIR);
        return files
            .filter(f => f.endsWith('.mp3'))
            .map(f => path.join(PRESET_MUSIC_DIR, f));
    } catch {
        return [];
    }
}

/**
 * 随机选择一首预设音乐
 */
export async function getRandomPresetMusic(): Promise<string | null> {
    const musicList = await getPresetMusicList();
    if (musicList.length === 0) return null;
    return musicList[Math.floor(Math.random() * musicList.length)];
}

/**
 * 执行 Python 脚本 - 使用 spawn 避免 shell 解析问题
 */
async function runPythonScript(args: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

        console.log(`[Slideshow] Running: ${pythonCmd} ${PYTHON_SCRIPT}`);
        console.log(`[Slideshow] Full args array (${args.length} items):`);
        args.forEach((arg, i) => {
            console.log(`[Slideshow]   [${i}]: ${arg.substring(0, 200)}${arg.length > 200 ? '...' : ''}`);
        });

        const proc = spawn(pythonCmd, [PYTHON_SCRIPT, ...args], {
            stdio: ['ignore', 'pipe', 'pipe'],
            // 不使用 shell，直接传递参数
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
            console.log(`[Slideshow] Process exited with code ${code}`);
            if (stdout) console.log(`[Slideshow] stdout: ${stdout.substring(0, 2000)}`);
            if (stderr) console.log(`[Slideshow] stderr (full): ${stderr}`);
            resolve({
                success: code === 0,
                stdout,
                stderr,
            });
        });

        proc.on('error', (err) => {
            console.error(`[Slideshow] Spawn error: ${err.message}`);
            resolve({
                success: false,
                stdout: '',
                stderr: err.message,
            });
        });

        // 5 分钟超时
        setTimeout(() => {
            proc.kill();
            resolve({
                success: false,
                stdout,
                stderr: 'Process timeout after 5 minutes',
            });
        }, 300000);
    });
}

/**
 * 生成单个轮播视频
 */
export async function generateSlideshow(options: SlideshowOptions): Promise<SlideshowResult> {
    const { images, aspectRatio, durationPerImage, transition, musicPath, subtitle } = options;

    if (images.length === 0) {
        return { success: false, error: 'No images provided' };
    }

    try {
        // 确保输出目录存在
        await fs.mkdir(OUTPUT_DIR, { recursive: true });

        const outputPath = path.join(OUTPUT_DIR, `${crypto.randomUUID()}.mp4`);

        // 构建命令参数 - 使用 spawn 直接传递参数，避免 shell 解析
        const args: string[] = [
            '--images', JSON.stringify(images),
            '--output', outputPath,
            '--aspect', aspectRatio,
            '--duration', String(durationPerImage),
            '--transition', transition,
        ];

        if (musicPath) {
            args.push('--music', musicPath);
        }

        // 详细日志：追踪 subtitle 参数 - 同时写入文件确保不丢失
        const debugInfo = {
            timestamp: new Date().toISOString(),
            subtitle: subtitle,
            subtitleText: subtitle?.text,
            hasSubtitle: !!(subtitle && subtitle.text),
        };
        console.log(`[Slideshow] ===== SUBTITLE DEBUG START =====`);
        console.log(`[Slideshow] DEBUG subtitle object:`, JSON.stringify(subtitle, null, 2));
        console.log(`[Slideshow] DEBUG subtitle?.text:`, subtitle?.text);
        console.log(`[Slideshow] DEBUG check (subtitle && subtitle.text):`, !!(subtitle && subtitle.text));
        console.log(`[Slideshow] ===== SUBTITLE DEBUG END =====`);

        // 写入调试日志文件
        const debugLogPath = path.join(OUTPUT_DIR, 'subtitle_debug.log');
        await fs.appendFile(debugLogPath, JSON.stringify(debugInfo, null, 2) + '\n---\n');

        if (subtitle && subtitle.text) {
            // 计算视频总时长（考虑转场）
            const fadeTime = 0.5;  // 与 Python 保持一致
            const n = images.length;
            const totalDuration = transition === 'none'
                ? n * durationPerImage
                : n * durationPerImage - (n - 1) * fadeTime;

            // 重映射 textOverlays（批量生成时使用）
            let remappedOverlays = subtitle.textOverlays;
            if (subtitle.textOverlays && options.originalImageIndices) {
                const originalIndices = options.originalImageIndices;
                remappedOverlays = subtitle.textOverlays
                    .filter(o => {
                        // 自由模式不过滤
                        if ((o.timingMode ?? 'image') === 'custom') return true;
                        // 图片模式：只保留属于当前视频的 overlay
                        return originalIndices.includes(o.imageIndex ?? 0);
                    })
                    .map(o => {
                        // 自由模式不需要重映射
                        if ((o.timingMode ?? 'image') === 'custom') return o;
                        // 图片模式：重映射 imageIndex
                        return {
                            ...o,
                            imageIndex: originalIndices.indexOf(o.imageIndex ?? 0)
                        };
                    });
                console.log(`[Slideshow] Remapped ${remappedOverlays.length} textOverlays from originalIndices:`, originalIndices);
            }

            // 注入 durationPerImage 和 totalDuration 以便 Python 计算时间
            const subtitleWithDuration = {
                ...subtitle,
                textOverlays: remappedOverlays,  // 使用重映射后的 overlays
                durationPerImage: durationPerImage,
                totalDuration: totalDuration,    // 用于自由模式百分比计算
            };
            const subtitleJson = JSON.stringify(subtitleWithDuration);
            console.log(`[Slideshow] Subtitle JSON (full): ${subtitleJson}`);
            args.push('--subtitle', subtitleJson);
        } else {
            console.log(`[Slideshow] WARNING: No subtitle text, skipping subtitle parameter`);
        }

        console.log(`[Slideshow] Generating video...`);
        console.log(`[Slideshow] Images: ${images.length}, Aspect: ${aspectRatio}, Duration: ${durationPerImage}s`);
        console.log(`[Slideshow] Transition: ${transition}`);
        console.log(`[Slideshow] Subtitle enabled: ${!!subtitle?.text}`);
        console.log(`[Slideshow] Output: ${outputPath}`);

        const result = await runPythonScript(args);

        if (!result.success) {
            console.error('[Slideshow] Python script failed:', result.stderr);
            return { success: false, error: result.stderr || 'FFmpeg generation failed' };
        }

        // 检查输出文件是否存在
        try {
            await fs.access(outputPath);
        } catch {
            console.error('[Slideshow] Output file not found:', outputPath);
            return { success: false, error: 'Output file not created' };
        }

        console.log(`[Slideshow] Video generated: ${outputPath}`);
        return { success: true, videoPath: outputPath };

    } catch (error: any) {
        console.error('[Slideshow] Error:', error.message);
        console.error('[Slideshow] Stack:', error.stack);
        return { success: false, error: error.message };
    }
}

/**
 * 批量生成轮播视频
 * 
 * @param imageGroups 图片分组列表，每组生成一个视频
 * @param options 通用配置（不包含字幕，字幕由 subtitleConfigs 单独传递）
 * @param musicPool 音乐池，随机分配给每个视频
 * @param subtitleConfigs 字幕配置数组，每个视频使用对应索引的配置
 */
export async function generateSlideshowBatch(
    imageGroups: string[][],
    options: Omit<SlideshowOptions, 'images' | 'musicPath' | 'subtitle'>,
    musicPool: string[] = [],
    subtitleConfigs: (SubtitleConfig | null | undefined)[] = []
): Promise<SlideshowResult[]> {
    const results: SlideshowResult[] = [];

    for (let i = 0; i < imageGroups.length; i++) {
        const images = imageGroups[i];

        // 随机选择音乐
        let musicPath: string | undefined;
        if (musicPool.length > 0) {
            musicPath = musicPool[Math.floor(Math.random() * musicPool.length)];
        }

        // 使用对应索引的字幕配置
        const subtitle = subtitleConfigs[i] || undefined;

        console.log(`[Slideshow] Processing video ${i + 1}/${imageGroups.length}`);
        console.log(`[Slideshow] Video ${i + 1} subtitle text: ${subtitle?.text?.substring(0, 50)}...`);

        const result = await generateSlideshow({
            images,
            musicPath,
            subtitle,
            ...options,
        });

        results.push(result);
    }

    return results;
}

/**
 * 智能混剪模式: 随机打乱图片并分组
 */
export function shuffleAndGroup(images: string[], imagesPerVideo: number): string[][] {
    // Fisher-Yates 洗牌算法
    const shuffled = [...images];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // 分组
    const groups: string[][] = [];
    for (let i = 0; i < shuffled.length; i += imagesPerVideo) {
        const group = shuffled.slice(i, i + imagesPerVideo);
        // 允许最后一组图片数量少于 imagesPerVideo（至少1张）
        if (group.length > 0) {
            groups.push(group);
        }
    }

    return groups;
}

/**
 * 场景编排模式: 从每个位置随机抽取一张
 */
export function positionExtract(positions: string[][], count: number): string[][] {
    // 验证所有位置数量相等
    const positionCount = positions[0]?.length || 0;
    for (const pos of positions) {
        if (pos.length !== positionCount) {
            throw new Error('所有位置的图片数量必须相等');
        }
    }

    // 打乱每个位置的图片顺序
    const shuffledPositions = positions.map(pos => {
        const arr = [...pos];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    });

    // 提取视频组合
    const groups: string[][] = [];
    const maxVideos = Math.min(count, positionCount);

    for (let i = 0; i < maxVideos; i++) {
        const group = shuffledPositions.map(pos => pos[i]);
        groups.push(group);
    }

    return groups;
}

/**
 * 计算积分消耗
 */
export function calculateCredits(imagesPerVideo: number): number {
    if (imagesPerVideo <= 5) return 1;
    if (imagesPerVideo <= 10) return 2;
    return 3;
}

// ========================================
// ⭐ 新增：随机位置和样式生成工具函数
// ========================================

/** 矩形区域接口 */
interface Rect { x: number; y: number; width: number; height: number; }

/**
 * 碰撞检测：检查矩形是否与任何禁止区域重叠
 */
export function hasCollision(rect: Rect, zones: Rect[]): boolean {
    return zones.some(zone =>
        rect.x < zone.x + zone.width &&
        rect.x + rect.width > zone.x &&
        rect.y < zone.y + zone.height &&
        rect.y + rect.height > zone.y
    );
}

/**
 * 估算文本框高度（百分比）
 * @param text 文本内容
 * @param boxWidth 文本框宽度百分比
 * @param fontSize 字号
 */
export function estimateBoxHeight(
    text: string,
    boxWidth: number,
    fontSize: number
): number {
    const charsPerLine = Math.floor(boxWidth * 10.8 / fontSize);
    const lines = Math.ceil(text.length / Math.max(charsPerLine, 1));
    const lineHeightPercent = fontSize / 19.2 * 1.5;
    return Math.min(lines * lineHeightPercent, 30);
}

/**
 * 自适应字号计算（二分法）
 * 根据文本框尺寸自动计算最佳字号，使文字填充区域
 */
export function calculateAutoFillFontSize(
    text: string,
    boxWidthPercent: number,
    boxHeightPercent: number,
    videoWidth: number = 1080,
    videoHeight: number = 1920
): number {
    const boxWidthPx = videoWidth * boxWidthPercent / 100;
    const boxHeightPx = videoHeight * boxHeightPercent / 100;
    const isChinese = /[\u4e00-\u9fa5]/.test(text);
    const charWidth = isChinese ? 1.0 : 0.6;

    let minSize = 12, maxSize = 80;
    while (maxSize - minSize > 1) {
        const mid = Math.floor((minSize + maxSize) / 2);
        const charsPerLine = Math.floor(boxWidthPx / (mid * charWidth));
        const lines = Math.ceil(text.length / Math.max(charsPerLine, 1));
        const totalHeight = lines * mid * 1.3;

        if (totalHeight <= boxHeightPx && charsPerLine > 0) {
            minSize = mid;
        } else {
            maxSize = mid;
        }
    }
    return minSize;
}

/**
 * 安全随机位置生成
 * 生成不与禁止区域重叠的随机位置，带三重约束：边距安全、完整显示、不重叠
 */
export function generateSafeRandomPosition(
    boxWidth: number,
    boxHeight: number,
    voiceSubtitleY: number,
    existingOverlays: Rect[],
    margin: number = 10
): { boxX: number; boxY: number; warning?: string } {
    // 参数边界验证
    boxWidth = Math.max(5, Math.min(90, boxWidth));
    boxHeight = Math.max(3, Math.min(50, boxHeight));

    // 构建禁止区域：配音字幕区 + 已有overlay
    const forbiddenZones: Rect[] = [
        { x: 0, y: voiceSubtitleY - 5, width: 100, height: 15 },
        ...existingOverlays
    ];

    // 策略1: 随机尝试50次
    for (let i = 0; i < 50; i++) {
        const x = margin + Math.random() * (100 - boxWidth - margin * 2);
        const y = margin + Math.random() * (100 - boxHeight - margin * 2);
        if (!hasCollision({ x, y, width: boxWidth, height: boxHeight }, forbiddenZones)) {
            return { boxX: Math.round(x), boxY: Math.round(y) };
        }
    }

    // 策略2: 网格扫描
    for (let gridY = margin; gridY <= 90 - boxHeight; gridY += 10) {
        for (let gridX = margin; gridX <= 90 - boxWidth; gridX += 10) {
            if (!hasCollision({ x: gridX, y: gridY, width: boxWidth, height: boxHeight }, forbiddenZones)) {
                return { boxX: gridX, boxY: gridY };
            }
        }
    }

    // 策略3: 强制放置（兜底）
    return { boxX: margin, boxY: margin + 20, warning: '无法完全避免重叠' };
}

/**
 * 随机样式生成（带对比度自动调整）
 * 返回随机的风格、色调、颜色和自适应描边色
 */
export function generateRandomStyle(): {
    style: SubtitleStyle;
    tone: SubtitleTone;
    color: string;
    borderColor: string;
} {
    const styles: SubtitleStyle[] = ['classic', 'trending', 'cinema', 'neon', 'minimal'];
    const tones: SubtitleTone[] = ['warm', 'cool', 'neutral'];
    const allColors = [
        '#FFD700', '#FFA500', '#FF69B4', // warm
        '#00F2EA', '#4DA6FF', '#8B5CF6', // cool
        '#FFFFFF', '#E0E0E0', '#FFFACD'  // neutral
    ];

    const style = styles[Math.floor(Math.random() * styles.length)];
    const tone = tones[Math.floor(Math.random() * tones.length)];
    const color = allColors[Math.floor(Math.random() * allColors.length)];

    // 对比度：浅色用黑描边，深色用白描边
    const isLight = ['#FFD700', '#FFFFFF', '#E0E0E0', '#FFFACD', '#FF69B4'].includes(color);
    const borderColor = isLight ? '#000000' : '#FFFFFF';

    return { style, tone, color, borderColor };
}

/**
 * 配音均衡分配
 * 为批量视频分配音色，支持纯随机或男女交替模式
 */
export function assignBalancedVoices(
    videoCount: number,
    mode: 'pure_random' | 'balanced'
): string[] {
    const maleVoices = ['Charlie', 'Bill', 'Brian'];
    const femaleVoices = ['Sarah', 'Charlotte'];
    const allVoices = [...maleVoices, ...femaleVoices];

    if (mode === 'pure_random') {
        return Array(videoCount).fill(0).map(() =>
            allVoices[Math.floor(Math.random() * allVoices.length)]
        );
    }

    // balanced: 男女交替
    return Array(videoCount).fill(0).map((_, i) => {
        const pool = i % 2 === 0 ? femaleVoices : maleVoices;
        return pool[Math.floor(Math.random() * pool.length)];
    });
}

/**
 * 模板验证
 * 检查视频模板配置是否完整有效
 */
export function validateTemplate(template: VideoTemplate): {
    valid: boolean;
    errors: string[]
} {
    const errors: string[] = [];

    if (!template.voiceSubtitle?.boxY && template.voiceSubtitle?.boxY !== 0) {
        errors.push('配音字幕位置未设置');
    }

    template.textOverlays?.forEach((overlay, i) => {
        if (!overlay.boxWidth) {
            errors.push(`图文字幕 ${i + 1} 宽度未设置`);
        }
        if (overlay.positionMode === 'fixed' && !overlay.fixedPosition) {
            errors.push(`图文字幕 ${i + 1} 固定位置未设置`);
        }
    });

    return { valid: errors.length === 0, errors };
}

