/**
 * JobSpec — Studio 统一任务规格(S0.7)
 *
 * omnibox 把任何输入(文字/链接/拖图/@角色/参数 chips)编译成 JobSpec,
 * 再经适配器写入现有 store,由 background-task-manager(BTM)原样执行:
 *
 *   JobSpec ──toVideoBatchTask──▶ video-batch store ──▶ BTM ──▶ /api/video-batch/models/submit
 *   JobSpec ──toQuickGenImageTask──▶ quick-gen store ──▶ BTM ──▶ /api/generate/image
 *
 * 字段与两个服务端入口的 DTO 对齐(扣积分/退款均在服务端,此处不涉及)。
 *
 * 已知差异(S0.7 侦查,详见 docs/EXECUTION_TRACKER.md):
 * video-batch 页面内联提交会传 characterId/characterName/characterReferenceImages/
 * characterAsset,而 BTM 提交路径不传这四个字段(角色元数据丢失)。适配器在 store
 * 任务上补全全部角色字段;BTM 提交侧的缺失在 S1 收编时修复。
 */

import type { CharacterAssetSnapshot } from "@/lib/character-assets";
import type { ImageModel } from "@/types/generation";
import type {
  TaskImageInfo,
  VideoAspectRatio,
  VideoBatchTask,
  VideoBatchTaskMode,
  VideoDuration,
  VideoModelType,
  VideoQuality,
} from "@/types/video-batch";
import type { QuickGenImageTask } from "@/stores/quick-gen-store";
import type { SlideshowTask } from "@/stores/slideshow-store";

// ============================================================================
// 规格类型
// ============================================================================

interface JobSpecBase {
  /** 主提示词(视频 prompt 模式 / 图片 generate 模式必填语义,由调用方校验非空) */
  prompt: string;
  /** @角色(character-picker 输出的快照,原样携带) */
  character?: CharacterAssetSnapshot;
  /** 任务组(video-batch Tab 分组;缺省与网关一致为「默认」) */
  groupName?: string;
  /** 数量 stepper:一次提交展开为 N 个任务(1-100,展开用 toXxxTasks) */
  count?: number;
  /** Studio 批次 ID(S1:随任务透传到提交体,服务端落 generations.batch_id) */
  batchId?: string;
  /** 蓝图管线预留(S2+):spec 快照随 generations.spec 落库时携带 */
  blueprintId?: string;
}

export interface VideoJobSpec extends JobSpecBase {
  kind: "video";
  modelType: VideoModelType;
  aspectRatio: VideoAspectRatio;
  durationSeconds: VideoDuration;
  quality?: VideoQuality; // 缺省 "standard"(与网关一致)
  /** 缺省按 imageUrls 是否非空推导(与网关 route 行为一致) */
  mode?: VideoBatchTaskMode;
  /** 素材图(image_to_video 的输入图;第一张按现有惯例标记为主图) */
  imageUrls?: string[];
  /** 参考图组(HappyHorse R2V 等) */
  referenceImageUrls?: string[];
  /** VEO 首尾帧(已上传 OSS 的 URL) */
  firstFrameUrl?: string;
  lastFrameUrl?: string;
}

export interface ImageJobSpec extends JobSpecBase {
  kind: "image";
  imageModel: ImageModel;
  action?: "generate" | "upscale" | "nine_grid"; // 缺省 "generate"
  aspectRatio?: string; // 缺省 "auto"(与 /api/generate/image 一致)
  resolution?: "1k" | "2k" | "4k"; // 缺省 "1k"
  /** 参考图/待处理图(upscale、nine_grid 至少需要一张,由调用方校验) */
  sourceImageUrls?: string[];
  /** 展示用预估积分(权威扣费在服务端);缺省 0 */
  creditCost?: number;
}

export interface SlideshowJobSpec extends JobSpecBase {
  kind: "slideshow";
  /** 轮播素材图(OSS URL,调用方校验 ≥2 张) */
  imageUrls: string[];
  aspectRatio: "9:16" | "16:9";
  /** 每张图停留秒数 */
  durationPerImage: number;
  /** xfade 转场效果名("none"=硬切) */
  transition: string;
  /** ken-burns 运镜(S0.4 已在 worker/python 就位) */
  kenburns?: boolean;
  /** AI 配音(智能选声;需 prompt 非空作文案主题) */
  voiceEnabled?: boolean;
  /** 预设库随机 BGM */
  bgmEnabled?: boolean;
}

export type JobSpec = VideoJobSpec | ImageJobSpec | SlideshowJobSpec;

// ============================================================================
// 工具
// ============================================================================

/** 任务 id 生成,沿用现有惯例:video=vbt-*(video-batch store),image=qg-*(quick-gen),slideshow=ss-* */
export function createJobId(kind: JobSpec["kind"]): string {
  const rand = Math.random().toString(36).slice(2, 11);
  const prefix = kind === "video" ? "vbt" : kind === "image" ? "qg" : "ss";
  return `${prefix}-${Date.now()}-${rand}`;
}

/** Fisher-Yates 洗牌(幻灯片素材级去同质化:每个变体独立图序) */
function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function clampCount(count: number | undefined): number {
  if (!count || !Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(100, Math.floor(count)));
}

function buildTaskImages(taskId: string, imageUrls: string[] | undefined): TaskImageInfo[] {
  return (imageUrls ?? []).map((url, i) => ({
    id: `${taskId}-img-${i}`,
    url,
    name: `image-${i + 1}`,
    isMainGrid: i === 0, // 现有惯例:第一张为主图(mainGridImageUrl 取首图)
    order: i,
  }));
}

// ============================================================================
// 适配器:JobSpec → store 任务对象
// ============================================================================

export interface AdapterOptions {
  /** 指定任务 id(缺省自动生成);批量展开时由 toXxxTasks 自动生成互不相同的 id */
  id?: string;
  /** 指定创建时间(ISO),便于测试;缺省 now */
  now?: string;
}

/** VideoJobSpec → VideoBatchTask(写入 video-batch store,BTM 自动执行) */
export function toVideoBatchTask(spec: VideoJobSpec, opts: AdapterOptions = {}): VideoBatchTask {
  const id = opts.id ?? createJobId("video");
  const now = opts.now ?? new Date().toISOString();
  const images = buildTaskImages(id, spec.imageUrls);
  const mode: VideoBatchTaskMode =
    spec.mode ?? (images.length > 0 ? "image_to_video" : "prompt_to_video");

  return {
    id,
    images,
    aspectRatio: spec.aspectRatio,
    groupName: spec.groupName ?? "默认",
    batchId: spec.batchId,
    mode,
    // 用户文字只要非空就随任务携带:prompt 模式它是脚本源;image 模式它触发
    // BTM 的短路分支(跳过豆包看图管线,直接以用户文字为最终提示词)。
    // 纯拖图无文字时保持 undefined,走既有豆包看图生成脚本管线。
    customPrompt: spec.prompt.trim() ? spec.prompt.trim() : undefined,
    referenceImageUrl: spec.referenceImageUrls?.[0],
    referenceImageUrls: spec.referenceImageUrls,

    // 角色字段全量补齐(修复 BTM 路径丢角色元数据的差异,见文件头注释)
    characterId: spec.character?.id,
    characterName: spec.character?.name,
    characterRefUrl:
      spec.character?.reference_sheet_url ?? spec.character?.reference_images?.[0],
    characterReferenceImages: spec.character?.reference_images,
    characterAsset: spec.character,

    firstFrameUrl: spec.firstFrameUrl,
    lastFrameUrl: spec.lastFrameUrl,

    modelType: spec.modelType,
    duration: spec.durationSeconds,
    quality: spec.quality ?? "standard",

    doubaoTalkingScript: null,
    doubaoAiVideoPrompt: null,
    soraTaskId: null,
    soraVideoUrl: null,

    status: "pending",
    currentStep: 0,
    progress: 0,
    errorMessage: null,

    createdAt: now,
    updatedAt: now,
  };
}

/** ImageJobSpec → QuickGenImageTask(写入 quick-gen store 的 imageTasks,BTM 自动执行) */
export function toQuickGenImageTask(spec: ImageJobSpec, opts: AdapterOptions = {}): QuickGenImageTask {
  const id = opts.id ?? createJobId("image");
  const now = opts.now ?? new Date().toISOString();
  const resolution = spec.resolution ?? "1k";

  return {
    id,
    prompt: spec.prompt,
    model: spec.imageModel,
    action: spec.action ?? "generate",
    tier: resolution, // tier 的 "1k"|"2k"|"4k" 分支与 resolution 同值(fast/pro 为旧档遗留)
    aspectRatio: spec.aspectRatio ?? "auto",
    resolution,
    sourceImageUrls: spec.sourceImageUrls ?? [],
    characterAsset: spec.character,
    batchId: spec.batchId,

    status: "idle", // S0.6 生命周期:idle=已创建待执行,BTM 执行器自动拉起
    progress: 0,

    createdAt: now,

    creditCost: spec.creditCost ?? 0,
    creditsDeducted: false,
  };
}

/** SlideshowJobSpec → SlideshowTask(写入 slideshow store,BTM 幻灯片执行器自动拉起) */
export function toSlideshowTask(spec: SlideshowJobSpec, opts: AdapterOptions = {}): SlideshowTask {
  const id = opts.id ?? createJobId("slideshow");
  const now = opts.now ?? new Date().toISOString();
  // 素材级去同质化(BLUEPRINT §四):每个变体独立洗牌图序
  const images = shuffled(spec.imageUrls);
  const text = spec.prompt.trim();
  const language = /[一-鿿]/.test(text) ? "zh" : "en";
  const bgmEnabled = spec.bgmEnabled ?? false;
  const voiceEnabled = !!(text && spec.voiceEnabled);

  // POST /api/video-batch/generate-slideshow 的完整请求体快照,
  // imagesPerVideo=全部图片 → 一次调用产出一条成片
  const renderRequest: Record<string, unknown> = {
    mode: "random",
    images,
    imagesPerVideo: images.length,
    aspectRatio: spec.aspectRatio,
    durationPerImage: spec.durationPerImage,
    transition: spec.transition,
    kenburns: spec.kenburns ?? false,
    bgm: { enabled: bgmEnabled, mode: bgmEnabled ? "random" : "none" },
    ...(text
      ? {
          aiCaption: {
            enabled: true,
            mode: "diverse",
            keywords: text,
            style: "lively",
            language,
          },
        }
      : {}),
    ...(voiceEnabled ? { voice: { enabled: true, voiceId: "random", voiceName: "智能选声" } } : {}),
    clientTaskIds: [id],
    ...(spec.batchId ? { batchId: spec.batchId } : {}),
  };

  return {
    id,
    groupName: spec.groupName ?? "Studio",
    mode: "random",
    status: "pending",
    progress: 0,
    imageCount: images.length,
    duration: spec.durationPerImage,
    transition: spec.transition,
    aspectRatio: spec.aspectRatio,
    hasVoice: voiceEnabled,
    hasBgm: bgmEnabled,
    hasSubtitle: !!text,
    batchId: spec.batchId,
    renderRequest,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// 批量展开(数量 stepper)
// ============================================================================

/** 按 spec.count 展开为 N 个 VideoBatchTask(id 互不相同,内容相同) */
export function toVideoBatchTasks(spec: VideoJobSpec, opts: Omit<AdapterOptions, "id"> = {}): VideoBatchTask[] {
  return Array.from({ length: clampCount(spec.count) }, () => toVideoBatchTask(spec, opts));
}

/** 按 spec.count 展开为 N 个 QuickGenImageTask */
export function toQuickGenImageTasks(spec: ImageJobSpec, opts: Omit<AdapterOptions, "id"> = {}): QuickGenImageTask[] {
  return Array.from({ length: clampCount(spec.count) }, () => toQuickGenImageTask(spec, opts));
}

/** 按 spec.count 展开为 N 个 SlideshowTask(每个变体独立洗牌图序) */
export function toSlideshowTasks(spec: SlideshowJobSpec, opts: Omit<AdapterOptions, "id"> = {}): SlideshowTask[] {
  return Array.from({ length: clampCount(spec.count) }, () => toSlideshowTask(spec, opts));
}
