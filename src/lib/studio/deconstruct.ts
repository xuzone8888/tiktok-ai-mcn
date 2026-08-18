/**
 * 门B 爆款拆解管线(S3.2,BLUEPRINT §五)
 *
 * 上传 mp4(自有 OSS URL)→ Qwen omni 一次多模态调用 → DeconstructReport
 * (逐字台词 utterances + 分镜 visual_beats + hook 识别 + CTA + why_viral)
 * → 蓝图 scenes(segmentByTimeline 切段)+ hooks。
 *
 * 器官复用:qwen-client.analyzeVideo(通用视频调用,自定义扩展 prompt——
 * 不动 analyzeVideoDeep 原 prompt)+ segmenter.segmentByTimeline(零 ASR
 * 依赖,时间戳来自 Qwen 近似标注,精度无保证——schema-notes 已备注,
 * 二期换真 ASR)。
 *
 * 版权纪律(§五裁决):原片像素与原声永不进入生成物;拆解产物只有文本结构;
 * 蓝图携带 origin.license='structure_only'。
 */

import { analyzeVideo } from "@/lib/blueprint/salvage/qwen-client";
import { segmentByTimeline } from "@/lib/blueprint/salvage/segmenter";
import type { AnalysisArtifactV2 } from "@/lib/blueprint/salvage/types";

// ============================================================================
// 类型
// ============================================================================

export type HookType = "痛点" | "悬念" | "对比" | "场景";

export interface DeconstructHook {
  type: HookType;
  /** hook 台词或画面描述(开头 1-3 秒抓注意力的内容) */
  text: string;
  approx_start_s: number;
  approx_end_s: number;
  /** 为什么这个开头能留住人 */
  rationale: string;
}

/** 解析质量信号(消毒过程的兜底/修复计数——基准打分要看原始质量,不能只看消毒后成品) */
export interface DeconstructQuality {
  /** 时间戳缺失被兜底合成的条数(utterances+beats) */
  missing_time_count: number;
  /** utterances 原始顺序乱序被重排 */
  reordered: boolean;
  /** 台词覆盖时长占建议总时长比例(0-1) */
  utterance_coverage: number;
  /** 不同起始时间的个数(全相同=时间线是垃圾) */
  distinct_start_count: number;
}

/** 结构报告 = 拆解产物(落 blueprints.origin.report,S3.3 报告视图数据源) */
export interface DeconstructReport {
  summary: string;
  transcript_full: string;
  utterances: AnalysisArtifactV2["utterances"];
  visual_beats: AnalysisArtifactV2["visual_beats"];
  key_claims: string[];
  hook: DeconstructHook;
  cta: { text: string; approx_start_s: number } | null;
  /** 「这条为什么火」要点(2-5 条) */
  why_viral: string[];
  language: "zh" | "en" | "mixed";
  video_type: string;
  suggested_segments: 2 | 3 | 4;
  suggested_duration: number;
  quality: DeconstructQuality;
}

/** 蓝图 scenes 元素(与 blueprints 表 JSONB 约定/PATCH 白名单对齐) */
export interface DeconstructScene {
  idx: number;
  line: string;
  visual: string;
  slot: { kind: "ai_gen"; asset_ref: string };
  duration_ms: number;
  beat: "hook" | "point" | "demo" | "cta";
}

/** 蓝图 hooks 元素([{type,text,selected}] 约定 + rationale 增补) */
export interface DeconstructBlueprintHook {
  id: string;
  type: HookType;
  text: string;
  selected: boolean;
  rationale?: string;
}

// ============================================================================
// 拆解调用(Qwen omni 一次调用)
// ============================================================================

const DECONSTRUCT_SYSTEM_PROMPT = `你是一个专业的短视频逆向分析师。你的任务是把给定的爆款视频完整还原成结构化数据,用于分析它的内容结构(hook/节奏/卖点/CTA)——只复用结构与创意,绝不复用原片素材。

你必须做到:
1. 完整逐字转录视频中所有的口播/对白/旁白内容,不遗漏任何一句话
2. 为每句话标注近似开始/结束时间(秒,精确到 0.5 秒即可)
3. 描述视频中每个画面阶段发生了什么(人物动作、产品展示、场景切换等)
4. 识别开头 hook:类型(痛点/悬念/对比/场景)、内容、为什么能留住人
5. 识别 CTA(行动号召)出现的位置与台词
6. 总结这条视频为什么能火(结构/节奏/情绪层面,2-5 条要点)

请严格按 JSON 格式返回,不要输出其他内容。`;

const DECONSTRUCT_USER_PROMPT = `请深度分析这条视频,返回以下 JSON 结构:
{
  "summary": "一两句话概括视频内容和目的",
  "transcript_full": "完整的口播/旁白逐字转录,所有话连在一起",
  "utterances": [
    { "id": "utt_0", "approx_start_s": 0.0, "approx_end_s": 3.5, "text": "这句话的逐字内容" }
  ],
  "visual_beats": [
    {
      "id": "beat_0",
      "approx_start_s": 0.0,
      "approx_end_s": 3.5,
      "description": "详细描述这段时间内的画面内容,包括人物动作、产品展示、场景等",
      "key_elements": ["产品名/外观", "人物特征", "场景特征"],
      "camera": "镜头类型(如:中景正面、特写俯拍、手持跟拍)",
      "on_screen_text": ["画面上出现的文字"]
    }
  ],
  "key_claims": ["核心卖点1", "核心卖点2"],
  "hook": {
    "type": "痛点 或 悬念 或 对比 或 场景",
    "text": "开头抓注意力的台词或画面内容",
    "approx_start_s": 0.0,
    "approx_end_s": 2.5,
    "rationale": "为什么这个开头能留住人(一两句)"
  },
  "cta": { "text": "行动号召的台词", "approx_start_s": 21.0 },
  "why_viral": ["这条视频为什么火的要点1", "要点2", "要点3"],
  "suggested_segments": 3,
  "suggested_duration": 24,
  "language": "en 或 zh 或 mixed",
  "video_type": "product_review 或 ad_oral 或 tutorial 或 lifestyle 或 other"
}

注意:
- utterances 必须覆盖视频中所有口播内容,不能遗漏
- visual_beats 的 description 必须足够详细,让人仅凭文字就能想象出画面
- hook.rationale 和 why_viral 要落在结构/节奏/情绪机制上,不要空话
- 没有明显 CTA 时 cta 返回 null`;

const HOOK_TYPES: HookType[] = ["痛点", "悬念", "对比", "场景"];

function callDeconstructModel(videoUrl: string, maxRetries: number) {
  return analyzeVideo(videoUrl, DECONSTRUCT_SYSTEM_PROMPT, DECONSTRUCT_USER_PROMPT, {
    maxTokens: 8192,
    temperature: 0.3,
    maxRetries,
    // 长视频:下载+抽帧+完整转录输出远超默认 60s;但两次尝试+3s 退避的最坏
    // 总耗时必须压在路由 maxDuration/nginx 300s 之内(135×2+3≈273s,审查实锤:
    // 原 180s×2≈363s 会让响应被 300s 墙杀掉、客户端误判失败重试双开销)
    timeoutMs: 135_000,
  });
}

/** qwen-client 错误 → 用户可读文案(审核拒标记见 callQwen,基准 #20 实锤) */
function toUserFacingAnalysisError(rawError: string | undefined): Error {
  if (/data[_]?inspection[_]?failed/i.test(rawError ?? "")) {
    return new Error("该视频未通过内容安全检测(平台审核拒绝分析此内容),请换一条视频");
  }
  return new Error(`视频分析失败:${rawError || "模型无返回"}`);
}

/**
 * 拆解一条视频:Qwen omni 一次调用 + 解析校验。
 * 失败抛 Error(带用户可读文案);耗时分钟级(单次尝试 135s,最多 2 次;
 * 解析失败且预算充足时追加 1 次重生成)。
 *
 * opts.deadlineAtMs:调用方(路由)从请求入口起算的硬期限——auth/幂等锚/
 * ffprobe/落库 RTT 全部自动计价(审查实锤:原「函数内起算 150s」漏算路由
 * 前置耗时,最坏成功路径 ~297-300.5s 贴穿 nginx 300s 墙)。独立调用缺省时
 * 按本函数入口兜底。
 */
export async function deconstructVideo(
  videoUrl: string,
  opts?: { deadlineAtMs?: number }
): Promise<DeconstructReport> {
  const deadlineAtMs = opts?.deadlineAtMs ?? Date.now() + 295_000;
  const result = await callDeconstructModel(videoUrl, 2);
  if (!result.success || !result.content) {
    throw toUserFacingAnalysisError(result.error);
  }
  try {
    return parseDeconstructReport(result.content);
  } catch (parseError) {
    // 模型 200 返回但 JSON 坏掉是偶发(基准 #5 实锤:32s 快速返回坏 JSON,
    // 同视频直连重打一次即成功)。analyzeVideo 的重试圈只兜 HTTP/超时错误,
    // 解析失败在圈外——在此补一次重生成。预算纪律:重打全程上界 = 限流等待
    // 1.5s + 单次 135s + 落库余量 ≈ 140s,塞不进剩余预算就直接抛——
    // 基准 #5 的快速坏 JSON 形态(~35s)预算绰绰有余;「双尝试后才坏 JSON」
    // 的 ~150s 形态主动放弃重打,防越墙
    if (Date.now() + 140_000 > deadlineAtMs) throw parseError;
    console.warn(
      `[Deconstruct] 解析失败(剩余预算 ${Math.round((deadlineAtMs - Date.now()) / 1000)}s),触发重生成:`,
      parseError instanceof Error ? parseError.message : parseError
    );
    const retry = await callDeconstructModel(videoUrl, 1);
    if (!retry.success || !retry.content) {
      // 二轮调用本身失败时抛一轮的解析错误——那才是本次失败的真根因文案
      throw parseError;
    }
    return parseDeconstructReport(retry.content);
  }
}

// ============================================================================
// 解析 + 校验(Qwen 输出无 schema 保证——审查侦查确认的缺口,在此补齐)
// ============================================================================

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function asStringArray(v: unknown, maxItems: number, maxLen = 300): string[] {
  return Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, maxLen))
        .slice(0, maxItems)
    : [];
}

/**
 * 取最外层 JSON 对象(首 { 到末 })。markdown 围栏必然在花括号之外,
 * 天然被截掉——绝不做全局 ``` 替换,那会改写恰好含围栏文本的 JSON 字符串
 * 内容(如 on_screen_text/转录里出现代码块,审查实锤)
 */
function extractJson(content: string): unknown {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("拆解结果不是有效 JSON(模型输出格式异常),请重试");
  }
  try {
    return JSON.parse(content.slice(start, end + 1));
  } catch {
    throw new Error("拆解结果 JSON 解析失败(模型输出被截断或格式异常),请重试");
  }
}

export function parseDeconstructReport(content: string): DeconstructReport {
  const raw = extractJson(content) as Record<string, unknown>;

  const transcript = asString(raw.transcript_full).slice(0, 8000);

  // 质量信号:消毒过程的兜底/修复计数(基准打分依据——不能只看消毒后成品)
  let missingTimeCount = 0;

  // utterances:逐项消毒,时间归一(start≥0,end>start),按 start 排序
  const unsorted = (Array.isArray(raw.utterances) ? raw.utterances : [])
    .map((u: Record<string, unknown>, i: number) => {
      const text = asString(u?.text).slice(0, 500);
      if (!text) return null;
      if (
        typeof u?.approx_start_s !== "number" ||
        !Number.isFinite(u.approx_start_s) ||
        typeof u?.approx_end_s !== "number" ||
        !Number.isFinite(u.approx_end_s)
      ) {
        missingTimeCount++;
      }
      const start = Math.max(asNumber(u?.approx_start_s, i * 3), 0);
      const endRaw = asNumber(u?.approx_end_s, start + 3);
      return {
        id: asString(u?.id) || `utt_${i}`,
        approx_start_s: Math.round(start * 10) / 10,
        approx_end_s: Math.round(Math.max(endRaw, start + 0.5) * 10) / 10,
        text,
      };
    })
    .filter((u): u is NonNullable<typeof u> => u !== null)
    .slice(0, 80);
  const reordered = unsorted.some(
    (u, i) => i > 0 && u.approx_start_s < unsorted[i - 1].approx_start_s
  );
  const utterances: DeconstructReport["utterances"] = [...unsorted].sort(
    (a, b) => a.approx_start_s - b.approx_start_s
  );

  if (utterances.length === 0 && !transcript) {
    throw new Error("拆解结果没有任何台词内容(视频可能无口播或分析失败),请换视频或重试");
  }

  const visualBeats: DeconstructReport["visual_beats"] = (Array.isArray(raw.visual_beats)
    ? raw.visual_beats
    : []
  )
    .map((b: Record<string, unknown>, i: number) => {
      const description = asString(b?.description).slice(0, 600);
      if (!description) return null;
      if (
        typeof b?.approx_start_s !== "number" ||
        !Number.isFinite(b.approx_start_s) ||
        typeof b?.approx_end_s !== "number" ||
        !Number.isFinite(b.approx_end_s)
      ) {
        missingTimeCount++;
      }
      const start = Math.max(asNumber(b?.approx_start_s, i * 3), 0);
      const endRaw = asNumber(b?.approx_end_s, start + 3);
      return {
        id: asString(b?.id) || `beat_${i}`,
        approx_start_s: Math.round(start * 10) / 10,
        approx_end_s: Math.round(Math.max(endRaw, start + 0.5) * 10) / 10,
        description,
        key_elements: asStringArray(b?.key_elements, 8, 120),
        ...(asString(b?.camera) ? { camera: asString(b?.camera).slice(0, 120) } : {}),
        ...(Array.isArray(b?.on_screen_text)
          ? { on_screen_text: asStringArray(b?.on_screen_text, 8, 120) }
          : {}),
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .sort((a, b) => a.approx_start_s - b.approx_start_s)
    .slice(0, 40);

  const lastEnd = Math.max(
    utterances[utterances.length - 1]?.approx_end_s ?? 0,
    visualBeats[visualBeats.length - 1]?.approx_end_s ?? 0
  );

  // hook:缺失/畸形时从首句合成(类型缺省"悬念",rationale 留空供人识别降级)
  const rawHook = (raw.hook ?? {}) as Record<string, unknown>;
  const hookType = HOOK_TYPES.includes(asString(rawHook.type) as HookType)
    ? (asString(rawHook.type) as HookType)
    : "悬念";
  const hookText =
    asString(rawHook.text).slice(0, 300) ||
    utterances[0]?.text ||
    asString(raw.summary).slice(0, 300);
  const hook: DeconstructHook = {
    type: hookType,
    text: hookText,
    approx_start_s: Math.max(asNumber(rawHook.approx_start_s, 0), 0),
    approx_end_s: Math.max(asNumber(rawHook.approx_end_s, 2.5), 0.5),
    rationale: asString(rawHook.rationale).slice(0, 500),
  };

  const rawCta = raw.cta as Record<string, unknown> | null | undefined;
  const ctaText = asString(rawCta?.text).slice(0, 300);
  const cta = ctaText
    ? { text: ctaText, approx_start_s: Math.max(asNumber(rawCta?.approx_start_s, lastEnd), 0) }
    : null;

  const segRaw = Math.round(asNumber(raw.suggested_segments, 3));
  const suggested_segments = (segRaw <= 2 ? 2 : segRaw >= 4 ? 4 : 3) as 2 | 3 | 4;

  const langRaw = asString(raw.language);
  const language: DeconstructReport["language"] =
    langRaw === "zh" || langRaw === "en" || langRaw === "mixed"
      ? langRaw
      : /[一-鿿]/.test(transcript || utterances[0]?.text || "")
        ? "zh"
        : "en";

  const suggested_duration = Math.min(
    Math.max(asNumber(raw.suggested_duration, lastEnd || 24), 5),
    180
  );
  const coveredSec = utterances.reduce(
    (sum, u) => sum + Math.max(u.approx_end_s - u.approx_start_s, 0),
    0
  );
  const quality: DeconstructQuality = {
    missing_time_count: missingTimeCount,
    reordered,
    utterance_coverage: Math.min(coveredSec / Math.max(suggested_duration, 1), 1),
    distinct_start_count: new Set(utterances.map((u) => u.approx_start_s)).size,
  };

  return {
    summary: asString(raw.summary).slice(0, 500),
    transcript_full: transcript || utterances.map((u) => u.text).join(" "),
    utterances,
    visual_beats: visualBeats,
    key_claims: asStringArray(raw.key_claims, 8, 200),
    hook,
    cta,
    why_viral: asStringArray(raw.why_viral, 5, 300),
    language,
    video_type: asString(raw.video_type, "other").slice(0, 40) || "other",
    suggested_segments,
    suggested_duration,
    quality,
  };
}

// ============================================================================
// 报告 → 蓝图(scenes + hooks)
// ============================================================================

/** SegmentBlueprintV2.role → 蓝图 beat(PATCH 白名单:hook/point/demo/cta) */
const ROLE_TO_BEAT: Record<string, DeconstructScene["beat"]> = {
  hook: "hook",
  demo: "demo",
  proof: "point",
  cta: "cta",
  b_roll: "demo",
};

export function buildDeconstructBlueprint(report: DeconstructReport): {
  scenes: DeconstructScene[];
  hooks: DeconstructBlueprintHook[];
} {
  // segmentByTimeline 消费 AnalysisArtifactV2 形状(report 是其超集的兄弟形状)
  const analysis: AnalysisArtifactV2 = {
    summary: report.summary,
    transcript_full: report.transcript_full,
    utterances: report.utterances.map((u) => ({ ...u })),
    visual_beats: report.visual_beats.map((b) => ({ ...b })),
    key_claims: report.key_claims,
    suggested_segments: report.suggested_segments,
    suggested_duration: report.suggested_duration,
    language: report.language,
    video_type: report.video_type,
  };
  const segments = segmentByTimeline(analysis, report.suggested_segments, []);
  const beatById = new Map(report.visual_beats.map((b) => [b.id, b]));

  // 口播稀疏时 distributeUtterances 会产出空组:空台词段直接剔除(审查实锤:
  // 空组还会把后续段时间范围回退到 0,cta 镜挂上开头画面),剔除后按新段数
  // 重排 idx 并重分配 beat(保证首镜 hook、末镜 cta)
  const nonEmpty = segments.filter((seg) => seg.spoken_text_exact.trim().length > 0);
  const kept = nonEmpty.length > 0 ? nonEmpty : segments.slice(0, 1);
  const BEAT_TEMPLATES: Record<number, DeconstructScene["beat"][]> = {
    1: ["hook"],
    2: ["hook", "cta"],
    3: ["hook", "demo", "cta"],
    4: ["hook", "demo", "point", "cta"],
  };
  const beats = BEAT_TEMPLATES[Math.min(kept.length, 4)] ?? BEAT_TEMPLATES[3];

  const scenes: DeconstructScene[] = kept.map((seg, i) => {
    const beatDescriptions = seg.beat_ids
      .map((id) => beatById.get(id)?.description)
      .filter((d): d is string => !!d);
    return {
      idx: i,
      line: (seg.spoken_text_exact.trim() || report.transcript_full).slice(0, 500),
      visual: (beatDescriptions.join(" / ") || report.summary).slice(0, 500),
      slot: { kind: "ai_gen", asset_ref: "" },
      duration_ms: Math.min(Math.max(Math.round(seg.source_span_seconds * 1000), 1000), 15_000),
      beat: beats[Math.min(i, beats.length - 1)] ?? ROLE_TO_BEAT[seg.role] ?? "point",
    };
  });

  // selected 恒 false:拆解 hook 是原片逐字台词,属报告信息项——绝不作为
  // 矩阵注入候选(注入=原片文本进成片,违 structure_only;审查 high 实锤)
  const hooks: DeconstructBlueprintHook[] = [
    {
      id: "hook-0",
      type: report.hook.type,
      text: report.hook.text,
      selected: false,
      ...(report.hook.rationale ? { rationale: report.hook.rationale } : {}),
    },
  ];

  return { scenes, hooks };
}
