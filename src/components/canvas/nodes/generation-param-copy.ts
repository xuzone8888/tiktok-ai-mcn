/**
 * 生成器参数的「人话」文案(CHECKLIST #187「所有模式/参数名一句话人话+悬停示例」)。
 *
 * 单独成模块的两个理由:
 *  ① 文案是产品资产,散在 JSX 里没人能一眼看全「我们一共向用户解释了几个参数」;
 *  ② verifier 可以按 key 集合断言「面板渲染的每个参数都有人话」,漏一个就红。
 *
 * 写作纪律(照做,别退化成参数名的同义反复):
 *  - **先说这个参数决定什么**,再给一个用户真会遇到的例子;
 *  - **不写死积分数字与具体模型能力** —— 价目由 `generation-pricing.ts` 决定、能力档位由
 *    `VIDEO_MODEL_CATALOG` 决定,两者都会变;写死等于埋一条迟早说谎的文案。要具体数字,
 *    面板下方的「预计 N 积分 · 余额 M」是实时的,比静态文案可靠;
 *  - 一句话说完,悬停能读完,不写成段落。
 */

/** 参数 key → 一句话人话。key 与面板里 `SelectField` 的 `hintKey` 一一对应。 */
export const GENERATION_PARAM_HINTS = {
  "image.resolution":
    "出图的精细程度。越高越清楚、也越贵；本次实际花多少以下方「预计 N 积分」为准。",
  "image.aspectRatio":
    "出图的长宽形状。例：竖版 9:16 适合做短视频封面，方形 1:1 适合商品主图，横版 16:9 适合横幅。",
  "video.model":
    "用哪个模型出片。换模型后，下面的时长／质量／画幅会跟着这个模型的能力重新列——选项变少不是出错。",
  "video.mode":
    "从什么起步生成。「文生视频」只凭文字；「图生视频」会拿上游连线过来的图当画面起点，所以得先连一张图。",
  "video.duration":
    "成片多长。档位由模型决定：多数模型只支持一两个固定时长，所以这里是下拉而不是滑杆。",
  "video.quality":
    "画面档位。标准够日常用，高清更细腻也更贵；具体有哪几档由所选模型决定。",
  "video.aspectRatio":
    "成片的长宽形状。例：竖版 9:16 发抖音／TikTok，横版 16:9 发 YouTube。",
} as const satisfies Record<string, string>;

export type GenerationParamHintKey = keyof typeof GENERATION_PARAM_HINTS;

/** 取人话文案;未登记的 key 返回 undefined(不编造,让 verifier 抓出来)。 */
export function generationParamHint(
  key: GenerationParamHintKey
): string | undefined {
  return GENERATION_PARAM_HINTS[key];
}
