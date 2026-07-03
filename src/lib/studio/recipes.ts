/**
 * 配方库(S3.5,BLUEPRINT §三:配方 = Blueprint 去实例化)
 *
 * 配方 scenes/hooks 的台词是「槽位化」文本:{商品名} {卖点1}..{卖点N} {价格}。
 * 反向实例化 = 配方 + 商品卡 → 填槽出新蓝图 scenes(素材槽按商品图轮转补齐)。
 *
 * 本文件无 'use client':server 路由(blueprints POST 按 recipeId 实例化)与
 * 前端(配方选择浮层)共用。内置种子配方为纯常量,不依赖 recipes 表——
 * 迁移未执行时种子链路照常可用(salvage/seed-recipes 的 beat 结构转写)。
 */

// ============================================================================
// 类型
// ============================================================================

export interface RecipeScene {
  idx: number;
  /** 槽位化台词({商品名}/{卖点N}/{价格}) */
  line: string;
  /** 画面指令(槽位化;实例化后可被商品图覆盖) */
  visual: string;
  slot: { kind: "product_image" | "broll" | "avatar" | "ai_gen"; asset_ref: string };
  duration_ms: number;
  beat: "hook" | "point" | "demo" | "cta";
}

export interface RecipeHook {
  id: string;
  type: string;
  /** 槽位化 hook 文案 */
  text: string;
  selected: boolean;
}

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  hooks: RecipeHook[];
  scenes: RecipeScene[];
  globals: Record<string, unknown>;
  render_mode: "slideshow" | "assembly" | "ai_gen" | null;
  origin?: { viral_ref?: string; why_viral?: string; license?: string } | null;
  /** 内置种子(非 DB 行,id 以 seed- 开头) */
  builtin?: boolean;
  use_count?: number;
}

/** 实例化输入:商品卡的最小必要子集 */
export interface RecipeProductInput {
  title: string;
  price?: string;
  images: string[];
  selling_points: Array<{ text: string; selected: boolean }>;
}

// ============================================================================
// 槽位填充(配方 + 商品卡 → 蓝图 scenes/hooks)
// ============================================================================

/** 配方模板要求的最少勾选卖点数(台词/hook 中最大的 {卖点N} 序号) */
export function requiredPointCount(texts: string[]): number {
  let max = 0;
  for (const t of texts) {
    for (const m of t.matchAll(/\{卖点(\d+)\}/g)) {
      max = Math.max(max, parseInt(m[1], 10) || 0);
    }
  }
  return max;
}

/** 填槽:{商品名}/{价格}/{卖点N}(卖点不足时轮转勾选卖点;无勾选用标题兜底) */
export function fillSlots(template: string, product: RecipeProductInput): string {
  const points = product.selling_points.filter((p) => p.selected && p.text.trim());
  return template
    .replace(/\{商品名\}/g, product.title)
    .replace(/\{价格\}/g, product.price?.trim() || "超值价")
    .replace(/\{卖点(\d+)\}/g, (_m, n) => {
      const i = Math.max(parseInt(n, 10) - 1, 0);
      if (points.length === 0) return product.title;
      return points[i % points.length].text;
    });
}

/** 配方实例化:填槽 + 素材槽按商品图轮转补齐 → 蓝图 scenes/hooks */
export function instantiateRecipe(
  recipe: Pick<Recipe, "scenes" | "hooks">,
  product: RecipeProductInput
): { scenes: RecipeScene[]; hooks: RecipeHook[] } {
  const scenes = [...recipe.scenes]
    .sort((a, b) => a.idx - b.idx)
    .map((s, i) => {
      const image = product.images[i % Math.max(product.images.length, 1)] ?? "";
      // 素材槽为空时一律按商品图轮转补齐(不限 product_image:门B 配方的
      // ai_gen 槽不补图会让拼装腿全镜被滤空死链、AI 生成腿丢商品参考——审查实锤)
      const needsImage = !s.slot.asset_ref;
      return {
        ...s,
        idx: i,
        line: fillSlots(s.line, product),
        visual: s.visual.includes("{") ? fillSlots(s.visual, product) : s.visual || image,
        slot: needsImage ? { ...s.slot, asset_ref: image } : { ...s.slot },
      };
    });
  const hooks = recipe.hooks.map((h) => ({ ...h, text: fillSlots(h.text, product) }));
  return { scenes, hooks };
}

// ============================================================================
// 内置种子配方(salvage/seed-recipes 的 beat 结构转写为可实例化骨架)
// ============================================================================

export const BUILTIN_RECIPES: Recipe[] = [
  {
    id: "seed-product-3beat",
    name: "三镜带货(钩子→卖点→转化)",
    description: "10 秒经典结构:强钩子开场→核心卖点演示→紧迫 CTA。幻灯片/拼装通用。",
    builtin: true,
    render_mode: "slideshow",
    hooks: [
      { id: "h0", type: "痛点", text: "还在为选{商品名}纠结?看完这条再决定!", selected: true },
      { id: "h1", type: "场景", text: "上班通勤也能用的{商品名},真的离不开了", selected: false },
    ],
    scenes: [
      {
        idx: 0,
        line: "还在为选{商品名}纠结?看完这条再决定!",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 2500,
        beat: "hook",
      },
      {
        idx: 1,
        line: "{卖点1},{卖点2},用过就回不去了。",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 3500,
        beat: "point",
      },
      {
        idx: 2,
        line: "现在下单还有优惠,点下方链接马上入手!",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 2500,
        beat: "cta",
      },
    ],
    globals: { aspect: "9:16", duration_per_image_ms: 2500 },
  },
  {
    id: "seed-oral-5beat",
    name: "口播种草(痛点→展开→演示→证明→转化)",
    description: "15 秒口播结构:痛点共鸣开场,两段卖点铺陈,CTA 收尾。拼装口播腿最佳。",
    builtin: true,
    render_mode: "assembly",
    hooks: [
      { id: "h0", type: "痛点", text: "我以前也觉得{商品名}都是智商税,直到用了这个。", selected: true },
      { id: "h1", type: "对比", text: "同样是{商品名},为什么这个能火?", selected: false },
    ],
    scenes: [
      {
        idx: 0,
        line: "我以前也觉得{商品名}都是智商税,直到用了这个。",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 3000,
        beat: "hook",
      },
      {
        idx: 1,
        line: "先说最打动我的:{卖点1}。",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 3000,
        beat: "point",
      },
      {
        idx: 2,
        line: "实际用下来,{卖点2},完全不是摆设。",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 3000,
        beat: "demo",
      },
      {
        idx: 3,
        line: "身边朋友看到都来问链接,这就是口碑。",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 3000,
        beat: "point",
      },
      {
        idx: 4,
        line: "想入手的别等,点下方链接,{价格}带回家!",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 3000,
        beat: "cta",
      },
    ],
    globals: { aspect: "9:16", duration_per_image_ms: 3000 },
  },
  {
    id: "seed-listicle",
    name: "清单体(3 个理由式)",
    description: "轮播清单结构:开场设问 + 三个理由逐条展开 + CTA。图文感强,适合幻灯片。",
    builtin: true,
    render_mode: "slideshow",
    hooks: [
      { id: "h0", type: "悬念", text: "买{商品名}前,这 3 件事没人告诉你。", selected: true },
    ],
    scenes: [
      {
        idx: 0,
        line: "买{商品名}前,这 3 件事没人告诉你。",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 2500,
        beat: "hook",
      },
      {
        idx: 1,
        line: "第一,{卖点1}。",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 2500,
        beat: "point",
      },
      {
        idx: 2,
        line: "第二,{卖点2}。",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 2500,
        beat: "point",
      },
      {
        idx: 3,
        line: "第三,{卖点3}。",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 2500,
        beat: "point",
      },
      {
        idx: 4,
        line: "全都想要?链接就在下面,自己去看!",
        visual: "",
        slot: { kind: "product_image", asset_ref: "" },
        duration_ms: 2500,
        beat: "cta",
      },
    ],
    globals: { aspect: "9:16", duration_per_image_ms: 2500 },
  },
];

export function getBuiltinRecipe(id: string): Recipe | undefined {
  return BUILTIN_RECIPES.find((r) => r.id === id);
}
