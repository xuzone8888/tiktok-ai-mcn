export type ImagePromptComplexity = "normal" | "complex";
export type ImageQueueLane = "standard" | "slow";

export const NORMAL_IMAGE_MAX_WAIT_MS = 5 * 60 * 1000;
export const COMPLEX_IMAGE_MAX_WAIT_MS = 15 * 60 * 1000;
export const FOUR_K_IMAGE_MAX_WAIT_MS = 15 * 60 * 1000;
export const COMPLEX_FOUR_K_IMAGE_MAX_WAIT_MS = 20 * 60 * 1000;

const COMPLEX_PROMPT_LENGTH_THRESHOLD = 180;
const COMPLEX_REFERENCE_COUNT_THRESHOLD = 2;
const COMPLEX_PROMPT_KEYWORDS = [
  "路线",
  "地图",
  "行程",
  "攻略",
  "日程",
  "表格",
  "信息图",
  "海报",
  "菜单",
  "流程",
  "对比",
  "时间轴",
  "城市",
  "景点",
  "地点",
  "多步骤",
  "多区域",
  "多天",
  "day",
] as const;

function getReferenceCount(sourceImageUrls?: unknown): number {
  return Array.isArray(sourceImageUrls)
    ? sourceImageUrls.filter(Boolean).length
    : 0;
}

export function classifyImagePromptComplexity(
  prompt?: string | null,
  sourceImageUrls?: unknown
): ImagePromptComplexity {
  const normalizedPrompt = (prompt || "").trim();
  const promptForKeywordMatch = normalizedPrompt.toLowerCase();

  if (normalizedPrompt.length > COMPLEX_PROMPT_LENGTH_THRESHOLD) {
    return "complex";
  }

  if (COMPLEX_PROMPT_KEYWORDS.some(keyword => promptForKeywordMatch.includes(keyword.toLowerCase()))) {
    return "complex";
  }

  if (getReferenceCount(sourceImageUrls) >= COMPLEX_REFERENCE_COUNT_THRESHOLD) {
    return "complex";
  }

  return "normal";
}

export function getImageQueueMetadata(
  prompt?: string | null,
  sourceImageUrls?: unknown,
  resolution?: string | null
): {
  complexityProfile: ImagePromptComplexity;
  queueLane: ImageQueueLane;
  maxWaitMs: number;
} {
  const complexityProfile = classifyImagePromptComplexity(prompt, sourceImageUrls);
  const isComplex = complexityProfile === "complex";
  const isFourK = typeof resolution === "string" && resolution.toLowerCase() === "4k";

  return {
    complexityProfile,
    queueLane: isComplex ? "slow" : "standard",
    maxWaitMs: isFourK
      ? (isComplex ? COMPLEX_FOUR_K_IMAGE_MAX_WAIT_MS : FOUR_K_IMAGE_MAX_WAIT_MS)
      : (isComplex ? COMPLEX_IMAGE_MAX_WAIT_MS : NORMAL_IMAGE_MAX_WAIT_MS),
  };
}
