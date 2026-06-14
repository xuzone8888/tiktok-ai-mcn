/**
 * Shared character asset helpers.
 *
 * A character is treated as an asset bundle: market cover, reference sheet,
 * original references, optional preview video, ownership and pricing metadata.
 */

export const ROLE_ASSET_CATEGORIES = [
  "全部",
  "现代都市",
  "古风玄幻",
  "漫剧动画",
  "奇幻科幻",
  "萌宠/IP",
  "我的角色",
] as const;

export type RoleAssetCategory = typeof ROLE_ASSET_CATEGORIES[number];
export type CharacterAssetSource = "official" | "user_created";
export type CharacterAssetOwnership = "official" | "community" | "owned" | "licensed";

export interface CharacterAssetSnapshot {
  id: string;
  name: string;
  description?: string | null;
  avatar_url: string | null;
  reference_sheet_url: string | null;
  reference_images: string[];
  preview_video_url?: string | null;
  category: string;
  tags: string[];
  source: CharacterAssetSource;
  ownership: CharacterAssetOwnership;
  publish_price: number;
  reference_status?: string | null;
  trigger_word?: string | null;
  forge_type?: string | null;
}

export interface CharacterAssetLike {
  id: string;
  name: string;
  description?: string | null;
  avatar_url?: string | null;
  reference_sheet_url?: string | null;
  reference_images?: unknown;
  preview_video_url?: string | null;
  category?: string | null;
  tags?: unknown;
  style_tags?: unknown;
  source?: string | null;
  owner_id?: string | null;
  is_public?: boolean | null;
  publish_price?: number | null;
  reference_status?: string | null;
  trigger_word?: string | null;
  forge_type?: string | null;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }

  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return asStringArray(parsed);
    } catch {
      return [value.trim()];
    }
  }

  return [];
}

export function normalizeCharacterAssetImages(value: unknown): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of asStringArray(value)) {
    const url = item.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

export function normalizeCharacterTags(value: unknown): string[] {
  return asStringArray(value).slice(0, 8);
}

export function classifyCharacterAsset(input: {
  category?: string | null;
  character_type?: string | null;
  tags?: string[];
  description?: string | null;
  dna_config?: unknown;
}): Exclude<RoleAssetCategory, "全部" | "我的角色"> {
  const raw = [
    input.category,
    input.character_type,
    input.description,
    ...(input.tags || []),
    typeof input.dna_config === "object" && input.dna_config
      ? JSON.stringify(input.dna_config)
      : "",
  ].join(" ").toLowerCase();

  if (/(animal|pet|mascot|cute_cat|cute_dog|萌宠|宠物|ip|吉祥物|毛绒)/i.test(raw)) return "萌宠/IP";
  if (/(anime|comic|manga|cartoon|toon|漫|动画|二次元|ghibli|chibi)/i.test(raw)) return "漫剧动画";
  if (/(ancient|hanfu|wuxia|xianxia|fantasy|仙|古风|玄幻|武侠|汉服|神话)/i.test(raw)) return "古风玄幻";
  if (/(sci|cyber|future|robot|mecha|space|科幻|未来|机甲|赛博|奇幻)/i.test(raw)) return "奇幻科幻";
  return "现代都市";
}

export function getCharacterOwnership(params: {
  source?: string | null;
  ownerId?: string | null;
  currentUserId?: string | null;
  hasActiveContract?: boolean;
}): CharacterAssetOwnership {
  if (params.currentUserId && params.ownerId === params.currentUserId) return "owned";
  if (params.hasActiveContract) return "licensed";
  if (params.source === "user_created") return "community";
  return "official";
}

export function toCharacterAssetSnapshot(
  model: CharacterAssetLike,
  options: {
    currentUserId?: string | null;
    hasActiveContract?: boolean;
  } = {}
): CharacterAssetSnapshot {
  const tags = normalizeCharacterTags(model.tags || model.style_tags);
  const referenceImages = normalizeCharacterAssetImages(model.reference_images);
  const source: CharacterAssetSource = model.source === "user_created" ? "user_created" : "official";

  return {
    id: model.id,
    name: model.name,
    description: model.description || null,
    avatar_url: model.avatar_url || null,
    reference_sheet_url: model.reference_sheet_url || null,
    reference_images: referenceImages,
    preview_video_url: model.preview_video_url || null,
    category: model.category || classifyCharacterAsset({
      category: model.category,
      tags,
      description: model.description,
    }),
    tags,
    source,
    ownership: getCharacterOwnership({
      source,
      ownerId: model.owner_id || null,
      currentUserId: options.currentUserId || null,
      hasActiveContract: options.hasActiveContract,
    }),
    publish_price: typeof model.publish_price === "number" ? model.publish_price : 100,
    reference_status: model.reference_status || "none",
    trigger_word: model.trigger_word || null,
    forge_type: model.forge_type || null,
  };
}

export function getCharacterAssetReferenceUrls(asset: CharacterAssetSnapshot | null | undefined): string[] {
  if (!asset) return [];
  return normalizeCharacterAssetImages([
    asset.reference_sheet_url,
    ...asset.reference_images,
    asset.avatar_url,
  ].filter(Boolean));
}

export function getPrimaryCharacterReferenceUrl(asset: CharacterAssetSnapshot | null | undefined): string | null {
  return getCharacterAssetReferenceUrls(asset)[0] || null;
}

export function getSafeCharacterDescription(asset: Pick<CharacterAssetSnapshot, "name" | "description" | "tags">): string {
  const parts = [
    asset.name,
    asset.description,
    asset.tags.length ? `style tags: ${asset.tags.slice(0, 4).join(", ")}` : "",
  ]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(". ")
    .replace(/[<>]/g, "")
    .slice(0, 420);

  return parts || asset.name;
}

export function buildCharacterConsistencyPrompt(
  asset: CharacterAssetSnapshot | null | undefined,
  prompt: string
): string {
  if (!asset) return prompt;
  const safeDescription = getSafeCharacterDescription(asset);
  return [
    `Use the same character identity from the attached character reference sheet. Keep facial features, hair, body proportions, outfit language, and overall style consistent across this image. Character: ${safeDescription}.`,
    prompt,
  ].filter(Boolean).join("\n\n");
}

export function createCharacterAssetSnapshotFromSelection(
  character: Partial<Omit<CharacterAssetSnapshot, "publish_price">> & {
    id: string;
    name: string;
    avatar_url?: string | null;
    reference_sheet_url?: string | null;
    reference_images?: string[];
    preview_video_url?: string | null;
    tags?: string[];
    category?: string;
    source?: CharacterAssetSource;
    publish_price?: number | null;
    reference_status?: string | null;
    trigger_word?: string | null;
    forge_type?: string | null;
  }
): CharacterAssetSnapshot {
  return {
    id: character.id,
    name: character.name,
    description: character.description || null,
    avatar_url: character.avatar_url || null,
    reference_sheet_url: character.reference_sheet_url || null,
    reference_images: normalizeCharacterAssetImages(character.reference_images || []),
    preview_video_url: character.preview_video_url || null,
    category: character.category || "现代都市",
    tags: character.tags || [],
    source: character.source || "official",
    ownership: character.ownership || "licensed",
    publish_price: character.publish_price || 100,
    reference_status: character.reference_status || "none",
    trigger_word: character.trigger_word || null,
    forge_type: character.forge_type || null,
  };
}
