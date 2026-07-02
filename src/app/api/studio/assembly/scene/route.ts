import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateSlideshow, type SubtitleConfig } from "@/lib/ffmpeg-slideshow";
import { fileExistsStrict, getPublicUrl, isOSSUrl, uploadBuffer } from "@/lib/oss";
import { adjustProfileCredits, insertCreditTransaction } from "@/lib/video-models/credits";
import { textToSpeechWithTimestamps, type WordTimestamp } from "@/lib/elevenlabs-api";
import { doubaoTextToSpeechWithTimestamps } from "@/lib/doubao-tts-api";
import { PRESET_VOICES } from "@/lib/voice-data";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * 拼装口播腿·单镜渲染(S3.1,经对抗审查重构)
 *
 * POST {
 *   jobId: 'asm-*', sceneIdx: 0-29,
 *   line: 台词(TTS 口播,1-500 字),
 *   imageUrl: 该镜素材图(强制自有 OSS 域,闸 SSRF),
 *   aspectRatio: '9:16'|'16:9', durationSec: 每镜基准秒数(1-15),
 *   kenburns?: boolean, voiceId: PRESET_VOICES 白名单 id
 * } → { success, data: { videoUrl, fromCache?, durationSec? } }
 *
 * 计费(审查裁决:先渲后扣,镜像幻灯片腿纪律):余额预检 → 渲染 → 上传成功
 * 才扣 1 积分。失败/超时/进程崩溃一律零扣费,不存在退款路径;扣费本身失败
 * 响亮记录人工对账(成片已交付,不因扣费失败拒付)。流水 task_id =
 * `${jobId}-s${idx}`;不写 generations(成片只在 stitch 落一行)。
 *
 * 幂等:内容寻址——OSS 对象路径含 (jobId|idx|参数|台词|图) 哈希,渲染成功即
 * 落该路径;重放先查 OSS head(strict:404 之外的异常上抛失败,绝不把存储
 * 抖动当 miss 重跑收费活),命中直接返回零扣费。
 *
 * 音画对齐(审查实锤 H2):两通道(worker/本地 python)一律只出「无声+字幕」
 * 段,配音统一由本端点 ffmpeg adelay=1000 合入——与 python ASS 字幕的
 * VOICE_DELAY=1.0s 对齐;不再把 voiceover 交给 worker(其无音轨 fallback
 * 缺 adelay,会音画字幕错位 1 秒且被幂等缓存永久固化)。
 *
 * 预算:航班全程 280s(低于客户端 310s 超时),各长阶段 race 硬截——超时
 * 友好失败且零扣费,不让僵尸航班长期占满并发闸(闸 3 路,占满时新请求在
 * 一切收费动作前 fail-fast 429)。
 */

const MAX_SCENE_IDX = 29;
const CREDITS_PER_SCENE = 1;
const FLIGHT_BUDGET_MS = 280_000;
const WORKER_SEGMENT_MAX_BYTES = 150 * 1024 * 1024;

// 进程内渲染并发闸(pm2 单实例;超时弃单的航班底层活最长再跑数分钟即被
// 各自内部超时终止,闸位随航班 settle 释放,属有界乐观)
const RENDER_CONCURRENCY_LIMIT = 3;
let activeRenders = 0;

// 同 (user,jobId,idx) 在途单飞:渲染+上传+扣费整体一个航班
const inflightScenes = new Map<
  string,
  Promise<{ videoUrl: string; durationSec?: number; fromCache?: boolean }>
>();

/** emoji 过滤(TTS 安全,幻灯片腿同款范围;适配器侧有镜像消毒) */
function stripEmoji(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.codePointAt(0) || 0;
    const isEmoji =
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf) ||
      (code >= 0x1f1e0 && code <= 0x1f1ff);
    if (!isEmoji) result += char;
  }
  return result.replace(/\s+/g, " ").trim();
}

/** 阶段级预算 race:超时抛友好文案(零扣费语义由先渲后扣保证) */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`单镜渲染超时(${label}),请重试(未扣费)`)),
      Math.max(ms, 1)
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** 配音合入无音轨的单镜段(adelay 1s 与 python ASS 字幕时轴对齐;apad+shortest 定长) */
async function mergeVoiceLocal(videoPath: string, audioBuffer: Buffer): Promise<string> {
  const tempDir = path.dirname(videoPath);
  const voicePath = path.join(tempDir, `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`);
  const outputPath = path.join(tempDir, `merged_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`);
  await fs.writeFile(voicePath, audioBuffer);
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        "ffmpeg",
        [
          "-y",
          "-i", videoPath,
          "-i", voicePath,
          "-filter_complex", "[1:a]adelay=1000|1000,apad[a]",
          "-map", "0:v:0",
          "-map", "[a]",
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "192k",
          "-shortest",
          outputPath,
        ],
        { stdio: ["ignore", "ignore", "pipe"] }
      );
      let stderr = "";
      let settled = false;
      const killTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill();
        reject(new Error("ffmpeg merge timeout"));
      }, 120_000);
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg merge exit ${code}: ${stderr.slice(-400)}`));
      });
      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        reject(err);
      });
    });
    return outputPath;
  } finally {
    fs.unlink(voicePath).catch(() => {});
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: "请先登录" }, { status: 401 });
    }

    const body = await request.json();
    const jobId = typeof body?.jobId === "string" ? body.jobId : "";
    if (!/^asm-[\w-]{5,80}$/.test(jobId)) {
      return NextResponse.json({ success: false, error: "jobId 非法" }, { status: 400 });
    }
    const sceneIdx = Number(body?.sceneIdx);
    if (!Number.isInteger(sceneIdx) || sceneIdx < 0 || sceneIdx > MAX_SCENE_IDX) {
      return NextResponse.json({ success: false, error: "sceneIdx 非法" }, { status: 400 });
    }
    const line = typeof body?.line === "string" ? stripEmoji(body.line).slice(0, 500) : "";
    if (!line) {
      return NextResponse.json({ success: false, error: "台词不能为空" }, { status: 400 });
    }
    const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";
    if (!isOSSUrl(imageUrl)) {
      return NextResponse.json(
        { success: false, error: "素材图必须是本站存储地址" },
        { status: 400 }
      );
    }
    const aspectRatio: "9:16" | "16:9" = body?.aspectRatio === "16:9" ? "16:9" : "9:16";
    const baseDuration =
      typeof body?.durationSec === "number" && Number.isFinite(body.durationSec)
        ? Math.min(Math.max(body.durationSec, 1), 15)
        : 3;
    const kenburns = body?.kenburns === true;
    const voiceId = typeof body?.voiceId === "string" ? body.voiceId : "";
    const voice = PRESET_VOICES.find((v) => v.id === voiceId);
    if (!voice) {
      return NextResponse.json({ success: false, error: "voiceId 非法" }, { status: 400 });
    }

    // 内容寻址幂等锚:同参重放命中同一 OSS 对象
    const contentHash = crypto
      .createHash("sha256")
      .update([jobId, sceneIdx, voiceId, aspectRatio, kenburns ? 1 : 0, baseDuration, line, imageUrl].join("|"))
      .digest("hex")
      .slice(0, 16);
    const objectPath = `videos/assembly/${user.id}/${jobId}-s${sceneIdx}-${contentHash}.mp4`;

    if (await fileExistsStrict(objectPath)) {
      return NextResponse.json({
        success: true,
        data: { videoUrl: getPublicUrl(objectPath), fromCache: true },
      });
    }

    const flightKey = `${user.id}:${jobId}:${sceneIdx}`;
    let flight = inflightScenes.get(flightKey);
    if (!flight) {
      // 并发闸在一切收费动作前 fail-fast:未扣费,重试免费
      if (activeRenders >= RENDER_CONCURRENCY_LIMIT) {
        return NextResponse.json(
          { success: false, error: "拼装渲染繁忙,请稍后重试(未扣费)" },
          { status: 429 }
        );
      }
      activeRenders++;
      const clientTaskId = `${jobId}-s${sceneIdx}`;
      const startedAt = Date.now();
      const remaining = () => FLIGHT_BUDGET_MS - (Date.now() - startedAt);
      flight = (async () => {
        const admin = createAdminClient();
        let tempDir: string | null = null;
        // 中间产物(python 出片/合成片)统一在 finally 回收,失败路径不漏
        const orphanFiles: string[] = [];
        try {
          // 双检:并发窗口内上一航班可能刚落对象(strict:存储抖动上抛,不当 miss)
          if (await fileExistsStrict(objectPath)) {
            return { videoUrl: getPublicUrl(objectPath), fromCache: true };
          }

          // ---------- 余额预检(不扣费;真正扣费在渲染成功后) ----------
          const { data: profile } = await admin
            .from("profiles")
            .select("credits")
            .eq("id", user.id)
            .single();
          const balance = (profile as { credits: number } | null)?.credits ?? 0;
          if (balance < CREDITS_PER_SCENE) {
            throw new Error(`积分不足,该镜未渲染(需要 ${CREDITS_PER_SCENE},余额 ${balance})`);
          }

          // ---------- TTS(豆包/ElevenLabs 按音色前缀分流,一次重试) ----------
          const isDoubao = voiceId.startsWith("zh_") || voiceId.startsWith("ICL_");
          let tts: { audio: Buffer; duration: number; timestamps: WordTimestamp[] } | null = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              tts = await withTimeout(
                isDoubao
                  ? doubaoTextToSpeechWithTimestamps(voiceId, line)
                  : textToSpeechWithTimestamps(voiceId, line, {
                      stability: 0.5,
                      similarity_boost: 0.75,
                    }),
                Math.min(remaining(), 90_000),
                "配音"
              );
              break;
            } catch (ttsError) {
              if (attempt === 1 || remaining() < 30_000) {
                throw new Error(
                  `配音生成失败:${ttsError instanceof Error ? ttsError.message : "TTS error"}`
                );
              }
              await new Promise((r) => setTimeout(r, 3000));
            }
          }
          if (!tts || tts.audio.length === 0) throw new Error("配音生成失败(空音频)");

          // 画面时长 = max(基准, 配音+1.6s):配音 1s 延迟起播+0.6s 收尾。
          // 不设人为上限——python 侧本就按配音时长延长,上限徒留元数据失真
          // (台词 500 字上限天然封顶 ≈2 分钟/镜)
          const durationSec = Math.max(baseDuration, Math.ceil((tts.duration + 1.6) * 10) / 10);

          // ---------- 素材图下载到本地(python 回退通道用) ----------
          tempDir = path.join(process.cwd(), ".temp", "assembly", crypto.randomUUID());
          await fs.mkdir(tempDir, { recursive: true });
          const localImagePath = path.join(tempDir, "0000.jpg");
          const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
          if (!imgRes.ok) throw new Error(`素材图下载失败 (HTTP ${imgRes.status})`);
          await fs.writeFile(localImagePath, Buffer.from(await imgRes.arrayBuffer()));

          // ---------- 无声单镜渲染(worker 优先/本地 python 回退) ----------
          // 刻意不传 voiceover/musicPath:配音统一在下方本地合入(音画对齐);
          // BGM 不进单镜段(拼接后每镜重启 BGM 会碎,整片 BGM 留 stitch 层后续做)
          const subtitle = {
            text: line,
            fontFamily: "NotoSansSC",
            voiceDuration: tts.duration,
            wordTimestamps: tts.timestamps ?? [],
          } as SubtitleConfig;
          if (remaining() < 40_000) throw new Error("单镜渲染超时(排队),请重试(未扣费)");
          const result = await withTimeout(
            generateSlideshow({
              images: [localImagePath],
              imageUrls: [imageUrl],
              aspectRatio,
              durationPerImage: durationSec,
              transition: "none",
              kenburns,
              subtitle,
            }),
            remaining() - 30_000, // 留 30s 给合成+上传
            "画面合成"
          );

          // 两通道统一收敛为本地文件,再统一合配音
          let silentPath: string;
          if (result.success && result.videoUrl) {
            // worker 通道:下载无声段回本地(段级文件 MB 量级)
            const segRes = await fetch(result.videoUrl, { signal: AbortSignal.timeout(60_000) });
            if (!segRes.ok) throw new Error(`worker 段下载失败 (HTTP ${segRes.status})`);
            const segBuffer = Buffer.from(await segRes.arrayBuffer());
            if (segBuffer.length > WORKER_SEGMENT_MAX_BYTES) {
              throw new Error("worker 段异常过大");
            }
            silentPath = path.join(tempDir, "segment.mp4");
            await fs.writeFile(silentPath, segBuffer);
          } else if (result.success && result.videoPath) {
            silentPath = result.videoPath;
            orphanFiles.push(result.videoPath);
          } else {
            throw new Error(result.error || "单镜渲染失败");
          }

          // ---------- 配音合入(adelay 1s 对齐字幕) + 上传幂等路径 ----------
          const mergedPath = await withTimeout(
            mergeVoiceLocal(silentPath, tts.audio),
            Math.max(remaining() - 15_000, 15_000),
            "配音合成"
          );
          orphanFiles.push(mergedPath);
          const buffer = await fs.readFile(mergedPath);
          const videoUrl = await uploadBuffer(buffer, objectPath, "video/mp4");

          // ---------- 扣费(成片已交付;扣费失败响亮记录,不拒付) ----------
          try {
            const { before, after } = await adjustProfileCredits({
              supabase: admin,
              userId: user.id,
              delta: -CREDITS_PER_SCENE,
            });
            await insertCreditTransaction(admin, {
              userId: user.id,
              type: "consume",
              amount: -CREDITS_PER_SCENE,
              balanceBefore: before,
              balanceAfter: after,
              taskId: clientTaskId,
              description: `拼装口播·单镜渲染 (${clientTaskId})`,
              metadata: { render_mode: "assembly", job_id: jobId, scene_idx: sceneIdx },
            });
          } catch (chargeError) {
            console.error(
              `[Studio Assembly] ❌ 扣费失败需人工对账 user=${user.id} task=${clientTaskId} amount=${CREDITS_PER_SCENE}:`,
              chargeError
            );
          }

          return { videoUrl, durationSec };
        } finally {
          activeRenders--;
          if (tempDir) fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
          for (const f of orphanFiles) fs.unlink(f).catch(() => {});
        }
      })();
      inflightScenes.set(flightKey, flight);
      flight.catch(() => {}).finally(() => inflightScenes.delete(flightKey));
    }

    const rendered = await flight;
    return NextResponse.json({ success: true, data: rendered });
  } catch (error) {
    console.error("[Studio Assembly] scene error:", error);
    const raw = error instanceof Error ? error.message : "";
    // 底层网络/系统错误不裸透传(同 stitch 纪律);业务文案原样放行
    const friendly =
      raw && !/fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(raw)
        ? raw
        : "单镜渲染失败,请重试(未扣费,重试免费补渲)";
    const status = /积分不足/.test(friendly) ? 400 : 500;
    return NextResponse.json({ success: false, error: friendly }, { status });
  }
}
