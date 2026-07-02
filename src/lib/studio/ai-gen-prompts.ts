/**
 * AI 生成腿 Prompt 桥(S2.3)
 *
 * 蓝图 scenes(beat/line/visual)→ salvage prompt-compiler 的 SegmentPlan/StyleBible
 * → 逐镜英文提示词。修复旧 link-video 的断裂:脚本的逐镜结构贯穿到生成端
 * (旧实现把脚本截断 750 字符单次喂 Sora,镜头结构在生成侧全丢)。
 *
 * 纯函数、零 IO,客户端(job-spec 适配器)与服务端皆可用。
 */

import { compileSegmentPrompt } from "@/lib/blueprint/salvage/prompt-compiler";
import type {
  AspectRatio,
  SegmentPlan,
  SegmentRole,
  StyleBible,
} from "@/lib/blueprint/salvage/types";

export interface AiGenSceneInput {
  idx: number;
  /** 台词(蓝图编辑器可改;进 prompt 的口播指示) */
  line: string;
  /** 画面指令;幻灯片骨架里是图 URL,URL 不进 prompt(走默认画面目标) */
  visual: string;
  beat: "hook" | "point" | "demo" | "cta";
}

/** 蓝图 beat → prompt-compiler SegmentRole(point 是商品卖点陈述,对应 body) */
const BEAT_TO_ROLE: Record<AiGenSceneInput["beat"], SegmentRole> = {
  hook: "hook",
  point: "body",
  demo: "demo",
  cta: "cta",
};

/** 商品成片默认风格(无人物主体;后续配方库可替换) */
export function buildProductStyleBible(productTitle: string): StyleBible {
  return {
    subject: "",
    product: productTitle,
    color_temp: "warm",
    lighting: "soft natural lighting",
    camera: "smooth stabilized camera",
    pacing: "fast",
    mood: "energetic",
  };
}

function defaultVisualGoal(role: SegmentRole, line: string): string {
  switch (role) {
    case "hook":
      return "Eye-catching product reveal that stops the scroll";
    case "demo":
      return "Hands-on close-up showing the product in real use";
    case "cta":
      return "Final beauty shot of the product with a sense of urgency";
    default:
      return line
        ? `Visualize the benefit: ${line}`
        : "Clean product showcase with appealing detail";
  }
}

/**
 * 单镜编译:scene → 英文提示词(时长以模型档位为准,拼进 prompt 提示节奏)。
 */
export function compileScenePrompt(
  scene: AiGenSceneInput,
  productTitle: string,
  aspectRatio: AspectRatio,
  durationSeconds: number
): string {
  const role = BEAT_TO_ROLE[scene.beat] ?? "body";
  const visualGoal =
    scene.visual && !scene.visual.startsWith("http")
      ? scene.visual
      : defaultVisualGoal(role, scene.line);

  const plan: SegmentPlan = {
    spoken_text: scene.line?.trim() ?? "",
    visual_goal: visualGoal,
    role,
    target_seconds: durationSeconds,
    seam_hint: "",
    ref_images: [],
  };
  const { prompt_en } = compileSegmentPrompt(plan, buildProductStyleBible(productTitle), aspectRatio);
  return `${prompt_en} Target segment duration: ${durationSeconds} seconds.`;
}
