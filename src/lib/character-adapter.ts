/**
 * 角色适配层
 *
 * 将角色数据适配到不同的 AI 生成引擎
 * 自建角色没有 trigger_word，使用 description + reference_sheet_url 替代
 */

import {
  getCharacterAssetReferenceUrls,
  getPrimaryCharacterReferenceUrl,
  getSafeCharacterDescription,
  type CharacterAssetSnapshot,
} from "@/lib/character-assets";

export interface CharacterInput {
  id: string;
  name: string;
  description?: string | null;
  trigger_word?: string | null;
  reference_sheet_url?: string | null;
  reference_status?: string;
  source?: string;
  avatar_url?: string | null;
  reference_images?: string[];
  characterAsset?: CharacterAssetSnapshot;
}

interface AdaptedConfig {
  promptInjection: string;        // 注入到 prompt 中的外观描述
  sourceImageUrl?: string;        // 用于图生图的源图
  imageUrls?: string[];           // 用于多图参考
  characterId: string;
  characterName: string;
}

function getReferenceUrls(character: CharacterInput): string[] {
  if (character.characterAsset) return getCharacterAssetReferenceUrls(character.characterAsset);
  return [
    character.reference_sheet_url,
    ...(character.reference_images || []),
    character.avatar_url,
  ].filter((url, index, urls): url is string =>
    typeof url === "string" &&
    url.length > 0 &&
    urls.indexOf(url) === index
  );
}

function getPromptInjection(character: CharacterInput): string {
  if (character.trigger_word) return character.trigger_word;
  if (character.characterAsset) return getSafeCharacterDescription(character.characterAsset);
  return character.description || character.name;
}

/**
 * 适配 Sora2（文生视频）
 * Sora2 使用 prompt 描述角色外观
 * 官方角色用 trigger_word，自建角色用 description
 */
export function adaptForSora2(character: CharacterInput): AdaptedConfig {
  const promptInjection = getPromptInjection(character);

  return {
    promptInjection,
    characterId: character.id,
    characterName: character.name,
    // Sora2 如果有参考图，也可以作为 sourceImage
    sourceImageUrl: getPrimaryCharacterReferenceUrl(character.characterAsset) || character.reference_sheet_url || undefined,
  };
}

/**
 * 适配 Veo3（图生视频 / 文生视频）
 * Veo3 支持 imageUrls 作为角色参考
 */
export function adaptForVeo3(character: CharacterInput): AdaptedConfig {
  const promptInjection = getPromptInjection(character);
  const imageUrls = getReferenceUrls(character);

  return {
    promptInjection,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    characterId: character.id,
    characterName: character.name,
  };
}

/**
 * 适配 NanoBanana（图生图）
 * NanoBanana 使用 sourceImageUrl 作为角色参考图
 */
export function adaptForNanoBanana(character: CharacterInput): AdaptedConfig {
  const promptInjection = getPromptInjection(character);

  return {
    promptInjection,
    sourceImageUrl: getReferenceUrls(character)[0] || undefined,
    characterId: character.id,
    characterName: character.name,
  };
}

/**
 * 适配 Seedance（文生视频）
 * Seedance 使用 prompt 注入角色外观描述
 */
export function adaptForSeedance(character: CharacterInput): AdaptedConfig {
  const promptInjection = getPromptInjection(character);

  return {
    promptInjection,
    characterId: character.id,
    characterName: character.name,
  };
}

/**
 * 通用角色适配
 * 根据引擎名称自动选择适配器
 */
export function adaptCharacter(
  character: CharacterInput,
  engine: "sora2" | "veo3-fast" | "veo3-std" | "veo3-4k" | "nano_banana" | "seedance" | string
): AdaptedConfig {
  switch (engine) {
    case "sora2":
      return adaptForSora2(character);
    case "veo3-fast":
    case "veo3-std":
    case "veo3-4k":
      return adaptForVeo3(character);
    case "nano_banana":
      return adaptForNanoBanana(character);
    case "seedance":
      return adaptForSeedance(character);
    default:
      // 默认使用 Sora2 适配
      return adaptForSora2(character);
  }
}

/**
 * 获取角色的 prompt 注入文本
 * 兜底逻辑：trigger_word → description → name
 */
export function getCharacterPrompt(character: CharacterInput): string {
  return getPromptInjection(character);
}

/**
 * 判断角色是否可使用（参考图已就绪或不需要参考图）
 */
export function isCharacterReady(character: CharacterInput): boolean {
  // 官方角色始终可用
  if (character.source === "official" || !character.source) return true;
  // 自建角色：reference_status 为 completed 或 none 时可用
  const status = character.reference_status || "none";
  return status === "completed" || status === "none";
}
