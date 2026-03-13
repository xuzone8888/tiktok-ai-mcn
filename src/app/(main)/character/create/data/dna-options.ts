/**
 * DNA 选项数据 — 角色捏脸舱的特征选项配置
 *
 * 每个选项有 value（英文 key）和 label（中文显示）
 * 映射表 dnaPromptDict 以 value 为键查 prompt 片段
 * 
 * 按 species 动态联动不同的 baseDna/bodyType/hair/outfit 选项组
 */

// ============================================================================
// 选项类型
// ============================================================================

export interface DnaOption {
  value: string;
  label: string;
}

export interface DnaOptionGroup {
  key: string;
  label: string;
  options: DnaOption[];
}

// ============================================================================
// Species（大类与物种）— 不随其他选项变化
// ============================================================================

export const speciesOptions: DnaOption[] = [
  { value: "realistic", label: "写实真人" },
  { value: "anime", label: "二次元动漫" },
  { value: "mascot", label: "3D潮玩盲盒" },
  { value: "animal", label: "动物精灵" },
];

// ============================================================================
// Gender（性别）— 不随 species 变化
// ============================================================================

export const genderOptions: DnaOption[] = [
  { value: "female", label: "女性" },
  { value: "male", label: "男性" },
  { value: "neutral", label: "无性别(中性)" },
];

// ============================================================================
// Age Group（年龄阶段）— 不随 species 变化
// ============================================================================

export const ageGroupOptions: DnaOption[] = [
  { value: "child", label: "幼年体/正太" },
  { value: "teen", label: "少女/少年" },
  { value: "youth", label: "青年" },
  { value: "mature", label: "成熟体" },
];

// ============================================================================
// 按 species 动态联动的选项组
// ============================================================================

/** BaseDNA（基础特征风格） */
export const baseDnaBySpecies: Record<string, DnaOption[]> = {
  realistic: [
    { value: "chinese_cool", label: "中式清冷" },
    { value: "japanese_refined", label: "日韩精致" },
    { value: "pure_western", label: "纯正白人" },
    { value: "mixed_exotic", label: "混血异域" },
    { value: "southeast_asian", label: "东南亚风情" },
    { value: "african_beauty", label: "非裔美学" },
  ],
  anime: [
    { value: "ghibli", label: "吉卜力风" },
    { value: "cyberpunk", label: "赛博朋克" },
    { value: "mecha_girl", label: "机甲少女" },
    { value: "fantasy_rpg", label: "奇幻RPG" },
    { value: "chibi_cute", label: "Q版萌系" },
    { value: "dark_gothic", label: "暗黑哥特" },
  ],
  mascot: [
    { value: "vinyl_toy", label: "潮流盲盒" },
    { value: "plush_cute", label: "毛绒可爱" },
    { value: "pixel_retro", label: "像素复古" },
    { value: "minimalist_3d", label: "极简3D" },
  ],
  animal: [
    { value: "cute_cat", label: "灵动猫咪" },
    { value: "shiba_inu", label: "柴犬" },
    { value: "future_beast", label: "未来神兽" },
    { value: "forest_spirit", label: "森林精灵" },
    { value: "ocean_creature", label: "海洋生物" },
  ],
};

/** Body Type（身材比例） */
export const bodyTypeBySpecies: Record<string, DnaOption[]> = {
  realistic: [
    { value: "tall_model", label: "高挑超模" },
    { value: "slim", label: "纤细苗条" },
    { value: "athletic", label: "匀称健美" },
    { value: "curvy", label: "微胖丰满" },
    { value: "petite", label: "娇小玲珑" },
  ],
  anime: [
    { value: "tall_model", label: "高挑" },
    { value: "slim", label: "纤细" },
    { value: "athletic", label: "健美" },
    { value: "petite", label: "娇小" },
    { value: "chibi_body", label: "Q版比例" },
  ],
  mascot: [
    { value: "round_cute", label: "圆润可爱" },
    { value: "slim_mascot", label: "修长型" },
    { value: "chunky", label: "敦实型" },
  ],
  animal: [
    { value: "slim_animal", label: "修长灵活" },
    { value: "fluffy", label: "毛绒圆润" },
    { value: "muscular_beast", label: "强壮威猛" },
    { value: "tiny", label: "迷你小巧" },
  ],
};

/** Hair Style（发型） */
export const hairStyleBySpecies: Record<string, DnaOption[]> = {
  realistic: [
    { value: "long_straight", label: "黑长直" },
    { value: "french_curl", label: "法式微卷" },
    { value: "collarbone", label: "极简锁骨发" },
    { value: "high_ponytail", label: "活力高马尾" },
    { value: "pixie_cut", label: "精灵短发" },
    { value: "bob_cut", label: "利落波波头" },
  ],
  anime: [
    { value: "twin_tails", label: "双马尾" },
    { value: "long_flowing", label: "飘逸长发" },
    { value: "spiky", label: "刺猬头" },
    { value: "asymmetric", label: "不对称短发" },
    { value: "hime_cut", label: "姬发式" },
  ],
  mascot: [
    { value: "no_hair", label: "无发（光头造型）" },
    { value: "antenna", label: "天线/触角" },
    { value: "fluffy_top", label: "蓬松头顶" },
  ],
  animal: [
    { value: "fur_short", label: "短毛" },
    { value: "fur_long", label: "长毛蓬松" },
    { value: "scales", label: "鳞片" },
    { value: "feathers", label: "羽毛" },
    { value: "mane", label: "鬃毛" },
  ],
};

/** Hair Color（发色） */
export const hairColorBySpecies: Record<string, DnaOption[]> = {
  realistic: [
    { value: "natural_black", label: "自然黑" },
    { value: "tea_brown", label: "茶棕色" },
    { value: "ash_blonde", label: "混血亚麻" },
    { value: "silver_white", label: "银白" },
    { value: "dream_pink", label: "梦幻粉" },
    { value: "honey_brown", label: "蜂蜜棕" },
  ],
  anime: [
    { value: "cherry_red", label: "樱桃红" },
    { value: "ocean_blue", label: "海洋蓝" },
    { value: "sakura_pink", label: "樱花粉" },
    { value: "emerald_green", label: "翡翠绿" },
    { value: "silver_white", label: "银白" },
    { value: "gradient_rainbow", label: "渐变彩虹" },
  ],
  mascot: [
    { value: "solid_color", label: "纯色" },
    { value: "two_tone", label: "双色拼接" },
  ],
  animal: [
    { value: "natural_fur", label: "自然毛色" },
    { value: "orange_tabby", label: "橘色" },
    { value: "snow_white", label: "雪白" },
    { value: "midnight_black", label: "午夜黑" },
    { value: "golden", label: "金色" },
  ],
};

/** Outfit（默认穿搭） */
export const outfitBySpecies: Record<string, DnaOption[]> = {
  realistic: [
    { value: "white_tee_jeans", label: "极简白T牛仔" },
    { value: "ootd_casual", label: "OOTD日常休闲" },
    { value: "business_suit", label: "高级职场西装" },
    { value: "new_chinese", label: "新中式国风" },
    { value: "sport_yoga", label: "运动瑜伽服" },
    { value: "haute_couture", label: "高定时尚" },
    { value: "cheongsam", label: "旗袍" },
  ],
  anime: [
    { value: "school_uniform", label: "校服/制服" },
    { value: "combat_suit", label: "战斗服" },
    { value: "maid_dress", label: "女仆装" },
    { value: "casual_anime", label: "日常休闲" },
    { value: "magical_girl", label: "魔法少女" },
    { value: "kimono", label: "和服/浴衣" },
  ],
  mascot: [
    { value: "naked_mascot", label: "裸装（无衣服）" },
    { value: "scarf_only", label: "围巾/领带" },
    { value: "cape", label: "披风/斗篷" },
    { value: "hat_accessory", label: "帽子配饰" },
  ],
  animal: [
    { value: "collar", label: "项圈/铃铛" },
    { value: "pet_outfit", label: "宠物服装" },
    { value: "natural_fur_only", label: "自然毛发（无衣服）" },
    { value: "armor_fantasy", label: "幻想铠甲" },
    { value: "bow_ribbon", label: "蝴蝶结/丝带" },
  ],
};

// ============================================================================
// 获取特定 species 的选项组（6 行）
// ============================================================================

export function getDnaOptionGroups(species: string): DnaOptionGroup[] {
  return [
    {
      key: "species",
      label: "大类与物种",
      options: speciesOptions,
    },
    {
      key: "baseDna",
      label: "基础特征",
      options: baseDnaBySpecies[species] || baseDnaBySpecies.realistic,
    },
    {
      key: "genderAge",
      label: "性别与年龄",
      options: [...genderOptions, ...ageGroupOptions],
    },
    {
      key: "bodyType",
      label: "身材比例",
      options: bodyTypeBySpecies[species] || bodyTypeBySpecies.realistic,
    },
    {
      key: "hair",
      label: "发型与发色",
      options: [
        ...(hairStyleBySpecies[species] || hairStyleBySpecies.realistic),
        ...(hairColorBySpecies[species] || hairColorBySpecies.realistic),
      ],
    },
    {
      key: "outfit",
      label: "默认穿搭",
      options: outfitBySpecies[species] || outfitBySpecies.realistic,
    },
  ];
}

// ============================================================================
// DNA → Prompt 映射字典（value → 英文 prompt 片段）
// ============================================================================

export const dnaPromptDict: Record<string, string> = {
  // Species
  realistic: "photorealistic human",
  anime: "anime character, 2D illustration style",
  mascot: "3D rendered toy figure, vinyl collectible style",
  animal: "anthropomorphic animal character",

  // Base DNA — Realistic
  chinese_cool: "Chinese cool elegant aesthetic",
  japanese_refined: "Japanese/Korean refined beauty",
  pure_western: "Western/Caucasian features",
  mixed_exotic: "mixed race exotic beauty",
  southeast_asian: "Southeast Asian beauty",
  african_beauty: "African beauty aesthetic",

  // Base DNA — Anime
  ghibli: "Studio Ghibli inspired style",
  cyberpunk: "cyberpunk futuristic style",
  mecha_girl: "mecha/robot girl style",
  fantasy_rpg: "fantasy RPG character style",
  chibi_cute: "chibi/super-deformed cute style",
  dark_gothic: "dark gothic anime style",

  // Base DNA — Mascot
  vinyl_toy: "trendy vinyl toy / blind box figure",
  plush_cute: "plush toy cute character",
  pixel_retro: "pixel art retro character",
  minimalist_3d: "minimalist 3D rendered character",

  // Base DNA — Animal
  cute_cat: "adorable cat character",
  shiba_inu: "cute Shiba Inu dog",
  future_beast: "futuristic mythical beast",
  forest_spirit: "forest spirit creature",
  ocean_creature: "ocean/marine creature",

  // Gender
  female: "female",
  male: "male",
  neutral: "androgynous gender-neutral",

  // Age Group
  child: "child/young body proportions",
  teen: "teenage young appearance",
  youth: "young adult",
  mature: "mature adult",

  // Body Type
  tall_model: "tall supermodel figure",
  slim: "slim slender build",
  athletic: "athletic fit build",
  curvy: "curvy full-figured build",
  petite: "petite small frame",
  chibi_body: "chibi/super-deformed proportions",
  round_cute: "round cute proportions",
  slim_mascot: "slim elongated proportions",
  chunky: "chunky sturdy proportions",
  slim_animal: "slim agile animal body",
  fluffy: "fluffy round animal body",
  muscular_beast: "muscular powerful beast body",
  tiny: "tiny miniature body",

  // Hair Style
  long_straight: "long straight black hair",
  french_curl: "French wave curly hair",
  collarbone: "minimalist collarbone-length hair",
  high_ponytail: "energetic high ponytail",
  pixie_cut: "pixie short haircut",
  bob_cut: "sleek bob haircut",
  twin_tails: "twin tails hairstyle",
  long_flowing: "long flowing hair",
  spiky: "spiky messy hair",
  asymmetric: "asymmetric short hair",
  hime_cut: "hime cut hairstyle",
  no_hair: "bald/smooth head",
  antenna: "antenna/antennae on head",
  fluffy_top: "fluffy fur on top",
  fur_short: "short smooth fur",
  fur_long: "long fluffy fur",
  scales: "scaled skin texture",
  feathers: "feathered plumage",
  mane: "flowing mane",

  // Hair Color
  natural_black: "natural black hair",
  tea_brown: "tea brown hair color",
  ash_blonde: "ash blonde hair color",
  silver_white: "silver white hair",
  dream_pink: "dreamy pink hair",
  honey_brown: "honey brown hair",
  cherry_red: "cherry red hair",
  ocean_blue: "ocean blue hair",
  sakura_pink: "sakura pink hair",
  emerald_green: "emerald green hair",
  gradient_rainbow: "rainbow gradient hair",
  solid_color: "solid single color",
  two_tone: "two-tone color split",
  natural_fur: "natural fur color",
  orange_tabby: "orange tabby coloring",
  snow_white: "snow white coloring",
  midnight_black: "midnight black coloring",
  golden: "golden coloring",

  // Outfit
  white_tee_jeans: "minimalist white t-shirt and blue jeans",
  ootd_casual: "casual everyday outfit, trendy OOTD style",
  business_suit: "professional business suit, executive style",
  new_chinese: "modern new Chinese style outfit",
  sport_yoga: "sporty athleisure/yoga wear",
  haute_couture: "haute couture high fashion",
  cheongsam: "elegant cheongsam/qipao dress",
  school_uniform: "Japanese school uniform",
  combat_suit: "tactical combat suit/armor",
  maid_dress: "classic maid outfit",
  casual_anime: "casual everyday outfit",
  magical_girl: "magical girl transformation outfit",
  kimono: "traditional Japanese kimono",
  naked_mascot: "no clothing, character design only",
  scarf_only: "wearing a scarf/necktie accessory",
  cape: "wearing a cape/cloak",
  hat_accessory: "wearing a hat/cap accessory",
  collar: "wearing a collar/bell",
  pet_outfit: "cute pet clothing",
  natural_fur_only: "natural fur/skin only, no clothing",
  armor_fantasy: "fantasy armor/equipment",
  bow_ribbon: "decorated with bow/ribbon",
};
