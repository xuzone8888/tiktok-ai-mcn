/**
 * FFmpeg 视频超分模块
 * 
 * 用于 Seedance 2.0 标准版：480p → 1080p 超分
 * 使用 lanczos 缩放 + unsharp 锐化补偿
 * 
 * 部署在阿里云 ECS 服务器上
 * 包含并发控制（MAX_CONCURRENT=3）防止 CPU 过载
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

// ============================================================================
// 配置
// ============================================================================

/** 最大并发 FFmpeg 任务数 */
const MAX_CONCURRENT = 3;

/** 当前运行中的 FFmpeg 任务数 */
let runningCount = 0;

/** 等待队列 */
const waitQueue: Array<{
  resolve: () => void;
  reject: (err: Error) => void;
}> = [];

// ============================================================================
// 类型定义
// ============================================================================

export interface UpscaleOptions {
  /** 输入视频的 Buffer */
  inputBuffer: Buffer;
  /** 目标宽度 */
  targetWidth: number;
  /** 目标高度 */
  targetHeight: number;
  /** 任务 ID（用于文件命名和日志） */
  taskId: string;
}

export interface UpscaleResult {
  /** 超分后的视频 Buffer */
  outputBuffer: Buffer;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
}

// ============================================================================
// 并发控制
// ============================================================================

/**
 * 获取执行槽位，如果满了则排队等待
 */
async function acquireSlot(): Promise<void> {
  if (runningCount < MAX_CONCURRENT) {
    runningCount++;
    return;
  }

  // 队列等待
  return new Promise<void>((resolve, reject) => {
    // 5分钟超时
    const timeout = setTimeout(() => {
      const idx = waitQueue.findIndex(item => item.resolve === resolve);
      if (idx !== -1) waitQueue.splice(idx, 1);
      reject(new Error('[FFmpeg] Queue timeout: waited too long for a slot'));
    }, 5 * 60 * 1000);

    waitQueue.push({
      resolve: () => {
        clearTimeout(timeout);
        runningCount++;
        resolve();
      },
      reject,
    });
  });
}

/**
 * 释放执行槽位
 */
function releaseSlot(): void {
  runningCount--;
  if (waitQueue.length > 0) {
    const next = waitQueue.shift()!;
    next.resolve();
  }
}

// ============================================================================
// 核心逻辑
// ============================================================================

/**
 * 获取超分目标分辨率
 * 
 * @param ratio - 视频比例
 * @returns { width, height }
 */
export function getUpscaleTarget(ratio: '9:16' | '16:9'): { width: number; height: number } {
  switch (ratio) {
    case '9:16':
      return { width: 1080, height: 1920 };
    case '16:9':
      return { width: 1920, height: 1080 };
    default:
      return { width: 1080, height: 1920 };
  }
}

/**
 * FFmpeg 超分视频
 * 
 * 480p → 1080p：使用 lanczos 缩放 + unsharp 锐化
 * 并发控制：最多同时运行 MAX_CONCURRENT 个 FFmpeg 进程
 * 
 * @param options - 超分选项
 * @returns 超分结果（包含 Buffer 或错误）
 */
export async function upscaleVideo(options: UpscaleOptions): Promise<UpscaleResult> {
  const { inputBuffer, targetWidth, targetHeight, taskId } = options;

  // 临时文件路径
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `seedance_${taskId}_input.mp4`);
  const outputPath = path.join(tmpDir, `seedance_${taskId}_1080p.mp4`);

  try {
    // 获取并发槽位
    console.log(`[FFmpeg] Task ${taskId}: waiting for slot (running: ${runningCount}/${MAX_CONCURRENT}, queued: ${waitQueue.length})`);
    await acquireSlot();
    console.log(`[FFmpeg] Task ${taskId}: slot acquired, starting upscale`);

    // 写入临时文件
    fs.writeFileSync(inputPath, inputBuffer);

    // FFmpeg 超分命令
    // - lanczos: 高质量缩放算法
    // - unsharp: 锐化补偿（3:3:0.5 亮度锐化，3:3:0.3 色度锐化）
    // - libx264 CRF 17: 高质量编码
    // - preset medium: 质量/速度平衡
    const cmd = [
      'ffmpeg',
      '-y',                                    // 覆盖输出
      '-i', `"${inputPath}"`,                  // 输入
      '-vf', `"scale=${targetWidth}:${targetHeight}:flags=lanczos,unsharp=3:3:0.5:3:3:0.3"`,
      '-c:v', 'libx264',                       // H.264 编码
      '-crf', '17',                            // 高质量
      '-preset', 'medium',                     // 质量/速度平衡
      '-pix_fmt', 'yuv420p',                   // 兼容性
      '-c:a', 'copy',                          // 音频直接拷贝
      `"${outputPath}"`,
    ].join(' ');

    console.log(`[FFmpeg] Task ${taskId}: executing (${targetWidth}x${targetHeight})`);

    const startTime = Date.now();
    await execAsync(cmd, { timeout: 120000 }); // 2分钟超时
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[FFmpeg] Task ${taskId}: completed in ${elapsed}s`);

    // 读取输出文件
    if (!fs.existsSync(outputPath)) {
      throw new Error('FFmpeg output file not found');
    }

    const outputBuffer = fs.readFileSync(outputPath);

    return {
      outputBuffer,
      success: true,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown FFmpeg error';
    console.error(`[FFmpeg] Task ${taskId}: failed -`, errMsg);

    return {
      outputBuffer: inputBuffer, // 降级：返回原始 480p
      success: false,
      error: errMsg,
    };
  } finally {
    // 清理临时文件
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch {
      // 忽略清理错误
    }

    // 释放槽位
    releaseSlot();
    console.log(`[FFmpeg] Task ${taskId}: slot released (running: ${runningCount}/${MAX_CONCURRENT})`);
  }
}
