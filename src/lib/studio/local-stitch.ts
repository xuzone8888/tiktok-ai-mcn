/**
 * 服务器本地 ffmpeg 拼接(S2.11):Mac worker 不可达时 stitch 路由的回退通道。
 *
 * 参数与 mac-ffmpeg-worker/stitch.js 逐项对齐:逐段下载 → ffprobe 探测 →
 * scale+pad 统一分辨率 + fps30 + setsar + yuv420p、无音轨段 anullsrc 补静音 →
 * concat 硬切 → loudnorm → 上传 OSS。生产服务器有 ffmpeg 6.1.1 + ffprobe
 * (slideshow 本地回退长期在用,滤镜链全部为 ffmpeg 4.x 以来的稳定能力)。
 *
 * 下载采用整段缓冲(与 worker downloadVideo 同构):分镜为自有 OSS 域的短视频
 * (实际几 MB~几十 MB),逐段串行且 OSS 恒返 Content-Length,超限先拒后读。
 */
import { spawn } from "child_process";
import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import crypto from "crypto";
import { uploadBuffer, generateVideoPath } from "@/lib/oss";

const FFMPEG_CMD = process.env.FFMPEG_CMD || "ffmpeg";
const FFPROBE_CMD = process.env.FFPROBE_CMD || "ffprobe";
const TEMP_DIR = path.join(process.cwd(), ".temp", "stitch");
const MAX_SEGMENT_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 90_000;

const RESOLUTIONS: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
};

// 进程内并发闸(对齐 worker MAX_CONCURRENT_STITCHES=2):生产机内存 3.4G,
// 并发 ffmpeg 会 OOM。超限 fail-fast 而非排队——重试经 task_id 幂等零扣费,
// 排队反而占满路由预算(同 parse-reference 进程内频控思路)
const MAX_CONCURRENT_LOCAL_STITCHES = 2;
let activeLocalStitches = 0;

interface RunResult {
  success: boolean;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      proc.kill();
      resolve({ success: false, stdout, stderr: `Timeout after ${timeoutMs / 1000}s` });
    }, timeoutMs);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, stdout, stderr });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({ success: false, stdout: "", stderr: err.message });
    });
  });
}

interface ProbeResult {
  durationSec: number;
  hasAudio: boolean;
}

async function probeMedia(input: string, timeoutMs = 20_000): Promise<ProbeResult> {
  const result = await run(
    FFPROBE_CMD,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input],
    timeoutMs
  );
  if (!result.success) {
    throw new Error(`ffprobe 探测失败: ${result.stderr.slice(-200)}`);
  }
  const data = JSON.parse(result.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; duration?: string }>;
  };
  const video = (data.streams || []).find((s) => s.codec_type === "video");
  const audio = (data.streams || []).find((s) => s.codec_type === "audio");
  return {
    durationSec: parseFloat(data.format?.duration || video?.duration || "0") || 0,
    hasAudio: !!audio,
  };
}

async function downloadSegment(
  url: string,
  destPath: string,
  timeoutMs = DOWNLOAD_TIMEOUT_MS
): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    throw new Error(`分镜下载失败 (HTTP ${res.status})`);
  }
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_SEGMENT_BYTES) {
    throw new Error(`分镜文件过大(${Math.round(declared / 1024 / 1024)}MB)`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_SEGMENT_BYTES) {
    throw new Error(`分镜文件过大(${Math.round(buf.length / 1024 / 1024)}MB)`);
  }
  await fsp.writeFile(destPath, buf);
}

/**
 * 本地拼接 N 段自有 OSS 视频并上传 OSS,返回成片 URL 与总时长。
 * 调用方(stitch 路由)已校验 URL 均为自有 OSS 域;失败抛错由调用方兜底文案
 * (以「拼接」开头的友好文案会被原样放行给用户)。
 * budgetMs:总预算(下载+探测+ffmpeg+上传),由调用方按客户端剩余超时传入——
 * 没有总时限的话 N 段串行下载(每段 90s)最坏可跑出客户端预算一个量级
 * (对抗审查实锤),预算耗尽宁可失败:重试经 task_id 幂等零新增扣费。
 */
export async function stitchVideosLocally(
  videoUrls: string[],
  aspectRatio: string,
  userId: string,
  budgetMs = 240_000
): Promise<{ videoUrl: string; durationSec: number }> {
  if (activeLocalStitches >= MAX_CONCURRENT_LOCAL_STITCHES) {
    throw new Error("拼接服务繁忙,请稍后重试(各镜成片已保留,重试不重复扣费)");
  }
  activeLocalStitches++;
  const startedAt = Date.now();
  const remaining = () => budgetMs - (Date.now() - startedAt);
  const budgetExhausted = () =>
    new Error("拼接超时,请重试(各镜成片已保留,重试不重复扣费)");
  const jobDir = path.join(TEMP_DIR, crypto.randomUUID());
  try {
    await fsp.mkdir(jobDir, { recursive: true });
    const localPaths: string[] = [];
    for (let i = 0; i < videoUrls.length; i++) {
      if (remaining() < 15_000) throw budgetExhausted();
      const p = path.join(jobDir, `seg-${i}.mp4`);
      await downloadSegment(videoUrls[i], p, Math.min(DOWNLOAD_TIMEOUT_MS, remaining()));
      localPaths.push(p);
    }

    const probes: ProbeResult[] = [];
    for (const p of localPaths) {
      if (remaining() < 10_000) throw budgetExhausted();
      probes.push(await probeMedia(p, Math.min(20_000, remaining())));
    }

    const [W, H] = RESOLUTIONS[aspectRatio] || RESOLUTIONS["9:16"];
    const n = localPaths.length;
    const inputs: string[] = [];
    for (const p of localPaths) inputs.push("-i", p);

    const filters: string[] = [];
    const pairLabels: string[] = [];
    for (let i = 0; i < n; i++) {
      const dur = Math.max(probes[i].durationSec, 0.1);
      filters.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1,format=yuv420p[v${i}]`
      );
      if (probes[i].hasAudio) {
        filters.push(
          `[${i}:a]aresample=async=1:first_pts=0,` +
          `aformat=sample_rates=44100:channel_layouts=stereo,` +
          `apad,atrim=duration=${dur.toFixed(3)}[a${i}]`
        );
      } else {
        filters.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100,` +
          `atrim=duration=${dur.toFixed(3)}[a${i}]`
        );
      }
      pairLabels.push(`[v${i}][a${i}]`);
    }
    filters.push(`${pairLabels.join("")}concat=n=${n}:v=1:a=1[vout][acat]`);
    filters.push(`[acat]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);

    const outputPath = path.join(jobDir, "out.mp4");
    const args = [
      "-y",
      ...inputs,
      "-filter_complex", filters.join(";"),
      "-map", "[vout]",
      "-map", "[aout]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-movflags", "+faststart",
      outputPath,
    ];

    const totalDur = probes.reduce((s, p) => s + p.durationSec, 0);
    // 每秒素材给 3 秒处理预算,下限 2 分钟、上限 4 分钟,再被剩余总预算
    // (扣 20s 上传余量)封顶——素材远超预算时宁可失败,重试零新增扣费
    const timeout = Math.min(
      Math.max(120_000, Math.min(totalDur * 3_000, 240_000)),
      remaining() - 20_000
    );
    if (timeout < 30_000) throw budgetExhausted();
    const result = await run(FFMPEG_CMD, args, timeout);
    if (!result.success || !fs.existsSync(outputPath)) {
      throw new Error(`本地 ffmpeg 拼接失败: ${result.stderr.slice(-300)}`);
    }

    const buf = await fsp.readFile(outputPath);
    const videoUrl = await uploadBuffer(
      buf,
      generateVideoPath(userId, "stitch.mp4"),
      "video/mp4"
    );
    return { videoUrl, durationSec: totalDur };
  } finally {
    activeLocalStitches--;
    await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
