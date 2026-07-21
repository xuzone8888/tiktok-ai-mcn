/**
 * 视频拼接与媒体探测(S0.4 补口)
 *
 * stitchVideos: 下载 N 段视频 → ffprobe 逐段探测 → 统一规格(分辨率/fps/SAR/像素格式)
 *               → concat(硬切)→ 音频 loudnorm → 输出单文件。
 *               无音轨的片段自动补静音,防止 concat 音画错位。
 * probeMedia:   ffprobe 直接探测远程 URL,返回时长/分辨率/编码/是否有音轨。
 *
 * MVP 边界:transition 仅支持 'cut'(硬切);'crossfade' 降级为 cut 并在结果里带 warning
 *          (xfade 链式偏移留二期,见 docs/BLUEPRINT_PIPELINE_PLAN.md)。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const FFMPEG_CMD = process.env.FFMPEG_CMD || 'ffmpeg';
const FFPROBE_CMD = process.env.FFPROBE_CMD || 'ffprobe';

const RESOLUTIONS = {
    '9:16': [1080, 1920],
    '16:9': [1920, 1080],
    '1:1': [1080, 1080],
};

function run(cmd, args, timeout = 300000) {
    return new Promise((resolve) => {
        const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        const timer = setTimeout(() => {
            proc.kill();
            resolve({ success: false, stdout, stderr: `Timeout after ${timeout / 1000}s` });
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

/** ffprobe 探测(本地路径或远程 URL 均可) */
async function probeMedia(input, timeout = 20000) {
    const args = [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format', '-show_streams',
        input,
    ];
    const result = await run(FFPROBE_CMD, args, timeout);
    if (!result.success) {
        throw new Error(`ffprobe failed: ${result.stderr.slice(-300)}`);
    }
    const data = JSON.parse(result.stdout);
    const video = (data.streams || []).find((s) => s.codec_type === 'video');
    const audio = (data.streams || []).find((s) => s.codec_type === 'audio');
    return {
        durationSec: parseFloat(data.format?.duration || video?.duration || 0) || 0,
        width: video?.width || 0,
        height: video?.height || 0,
        videoCodec: video?.codec_name || null,
        fps: video?.r_frame_rate || null,
        hasAudio: !!audio,
        audioCodec: audio?.codec_name || null,
        sizeBytes: parseInt(data.format?.size || 0, 10) || 0,
        raw: { format: data.format, streamCount: (data.streams || []).length },
    };
}

/**
 * 拼接视频
 * @param {string[]} localPaths 已下载到本地的视频路径(按顺序)
 * @param {string} outputPath 输出 mp4 路径
 * @param {object} opts { aspectRatio, loudnorm }
 * @returns {{ durationSec: number }}
 */
async function stitchVideos(localPaths, outputPath, opts = {}) {
    const { aspectRatio = '9:16', loudnorm = true } = opts;
    const [W, H] = RESOLUTIONS[aspectRatio] || RESOLUTIONS['9:16'];

    // 逐段探测:拿时长与音轨情况
    const probes = [];
    for (const p of localPaths) {
        probes.push(await probeMedia(p));
    }

    const n = localPaths.length;
    const inputs = [];
    for (const p of localPaths) inputs.push('-i', p);

    const filters = [];
    const pairLabels = [];
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

    filters.push(`${pairLabels.join('')}concat=n=${n}:v=1:a=1[vout][acat]`);
    if (loudnorm) {
        filters.push(`[acat]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
    }
    const audioLabel = loudnorm ? '[aout]' : '[acat]';

    const args = [
        '-y',
        ...inputs,
        '-filter_complex', filters.join(';'),
        '-map', '[vout]',
        '-map', audioLabel,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
        '-movflags', '+faststart',
        outputPath,
    ];

    const totalDur = probes.reduce((s, p) => s + p.durationSec, 0);
    // 超时按素材总时长放大:每分钟素材给 3 分钟处理时间,下限 5 分钟
    const timeout = Math.max(300000, totalDur * 3000 * 60 / 60);
    const result = await run(FFMPEG_CMD, args, timeout);
    if (!result.success || !fs.existsSync(outputPath)) {
        throw new Error(`ffmpeg stitch failed: ${result.stderr.slice(-500)}`);
    }
    return { durationSec: totalDur };
}

/** 下载远程视频到本地 */
async function downloadVideo(url, destPath, { timeoutMs = 120000, maxBytes = 500 * 1024 * 1024 } = {}) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const resp = await fetch(url, { signal: ac.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = Buffer.from(await resp.arrayBuffer());
        if (buf.length > maxBytes) {
            throw new Error(`Video too large: ${(buf.length / 1024 / 1024).toFixed(0)}MB > ${maxBytes / 1024 / 1024}MB`);
        }
        await fsp.writeFile(destPath, buf);
        return buf.length;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { stitchVideos, probeMedia, downloadVideo, RESOLUTIONS };
