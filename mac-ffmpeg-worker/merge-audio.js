/**
 * 音频合成模块 — 将配音叠加到视频的 BGM 音轨上
 * 
 * 从 generate-slideshow/route.ts 的 mergeVoiceover() 提取，
 * 保持完全一致的 FFmpeg 滤镜参数。
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/**
 * 获取媒体文件时长（秒）
 */
function getMediaDuration(filePath) {
    try {
        const output = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
            { encoding: 'utf-8', timeout: 10000 }
        );
        const duration = parseFloat(output.trim());
        return isNaN(duration) ? 0 : duration;
    } catch {
        console.warn('[MergeAudio] ffprobe failed, using fallback duration');
        return 0;
    }
}

/**
 * 将配音合成到视频中（混合 BGM 和配音）
 * 
 * @param {string} videoPath - 原视频路径（可能已含BGM）
 * @param {Buffer} audioBuffer - 配音音频 Buffer
 * @param {number} voiceDuration - 配音时长（秒）
 * @param {string} workDir - 工作目录
 * @returns {Promise<string>} 合成后的视频路径
 */
async function mergeVoiceover(videoPath, audioBuffer, voiceDuration, workDir) {
    const voiceoverPath = path.join(workDir, `voiceover_${Date.now()}.mp3`);
    const outputPath = path.join(workDir, `final_${Date.now()}.mp4`);

    // 保存配音文件
    await fsp.writeFile(voiceoverPath, audioBuffer);

    // 获取视频时长
    const videoDuration = getMediaDuration(videoPath);
    // 如果配音稍长于视频，延长输出而非截断（保护内容完整性）
    const voiceEndTime = voiceDuration + 1.5;
    const outputDuration = voiceEndTime > videoDuration
        ? Math.min(voiceEndTime, videoDuration * 1.2)
        : videoDuration;

    console.log(`[MergeAudio] Video: ${videoDuration.toFixed(1)}s, Voice: ${voiceDuration.toFixed(1)}s, Output: ${outputDuration.toFixed(1)}s`);

    return new Promise((resolve, reject) => {
        // 音频混合参数 — 与 ECS route.ts 完全一致
        const VOICE_DELAY_MS = 1000;
        const VOICE_DELAY_S = VOICE_DELAY_MS / 1000;
        const VOICE_FADE_IN = 0.5;
        const VOICE_FADE_OUT = 0.3;
        const BGM_VOLUME = 0.2;
        const BGM_FADE_IN = 1.5;
        const BGM_FADE_OUT = 2.0;

        // BGM 滤镜链
        let bgmFilter = `[0:a]volume=${BGM_VOLUME}`;
        bgmFilter += `,afade=t=in:st=0:d=${BGM_FADE_IN}`;
        if (outputDuration > BGM_FADE_IN + BGM_FADE_OUT + 1) {
            const bgmFadeOutStart = Math.max(0, outputDuration - BGM_FADE_OUT);
            bgmFilter += `,afade=t=out:st=${bgmFadeOutStart.toFixed(2)}:d=${BGM_FADE_OUT}`;
        }
        bgmFilter += ',apad[bgm]';

        // 配音滤镜链
        let voiceFilter = `[1:a]adelay=${VOICE_DELAY_MS}|${VOICE_DELAY_MS}`;
        voiceFilter += `,afade=t=in:st=${VOICE_DELAY_S}:d=${VOICE_FADE_IN}`;
        if (voiceDuration > VOICE_FADE_IN + VOICE_FADE_OUT) {
            const voiceFadeOutStart = VOICE_DELAY_S + voiceDuration - VOICE_FADE_OUT;
            voiceFilter += `,afade=t=out:st=${voiceFadeOutStart.toFixed(2)}:d=${VOICE_FADE_OUT}`;
        }
        voiceFilter += `,volume=1.0,atrim=0:${outputDuration.toFixed(2)},asetpts=PTS-STARTPTS,apad[voice]`;

        const filterComplex = `${bgmFilter};${voiceFilter};[bgm][voice]amix=inputs=2:duration=first:dropout_transition=3[aout]`;

        const ffmpegArgs = [
            '-y',
            '-i', videoPath,
            '-i', voiceoverPath,
            '-filter_complex', filterComplex,
            '-map', '0:v:0',
            '-map', '[aout]',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-t', outputDuration.toFixed(2),
            outputPath,
        ];

        const proc = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', async (code) => {
            await fsp.unlink(voiceoverPath).catch(() => {});

            if (code === 0 && fs.existsSync(outputPath)) {
                await fsp.unlink(videoPath).catch(() => {});
                resolve(outputPath);
            } else {
                // 回退：仅添加配音（原视频可能没有音轨）
                console.warn('[MergeAudio] Mix failed, trying voiceover only...');
                await fsp.writeFile(voiceoverPath, audioBuffer);

                const fallbackArgs = [
                    '-y',
                    '-i', videoPath,
                    '-i', voiceoverPath,
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-map', '0:v:0',
                    '-map', '1:a:0',
                    '-t', outputDuration.toFixed(2),
                    outputPath,
                ];

                const fb = spawn('ffmpeg', fallbackArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
                fb.on('close', async (fbCode) => {
                    await fsp.unlink(voiceoverPath).catch(() => {});
                    if (fbCode === 0 && fs.existsSync(outputPath)) {
                        await fsp.unlink(videoPath).catch(() => {});
                        resolve(outputPath);
                    } else {
                        resolve(videoPath); // 最终兜底：返回原视频
                    }
                });
                fb.on('error', () => resolve(videoPath));
            }
        });

        proc.on('error', (err) => {
            console.error('[MergeAudio] proc spawn error:', err.message);
            fsp.unlink(voiceoverPath).catch(() => {});
            resolve(videoPath); // 与 ECS 行为一致：降级返回原视频
        });
    });
}

module.exports = { mergeVoiceover, getMediaDuration };
