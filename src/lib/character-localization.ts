import { pinyin } from "pinyin-pro";

const ENGLISH_CHARACTER_TAGS: Record<string, string> = {
  "亲和": "Friendly", "仙侠": "Xianxia", "伙伴": "Companion", "使者": "Envoy",
  "侦探": "Detective", "偶像": "Idol", "元气": "Energetic", "全球化": "Global",
  "写实": "Photorealistic", "冷静": "Calm", "创业者": "Entrepreneur", "剑修": "Sword Cultivator",
  "动作": "Action", "动画": "Animation", "医师": "Healer", "医疗": "Medical",
  "原创IP": "Original IP", "古风": "Ancient Style", "可爱": "Cute", "吉祥物": "Mascot",
  "咖啡店": "Coffee Shop", "品牌形象": "Brand Character", "圆润": "Rounded", "夜景": "Night Scene",
  "太空": "Space", "奇幻": "Fantasy", "奇遇": "Adventure", "宫廷": "Royal Court",
  "导演感": "Cinematic", "小龙": "Little Dragon", "少年": "Young Hero", "山林": "Woodland",
  "工程师": "Engineer", "异兽": "Mythical Beast", "悬疑": "Mystery", "成熟": "Mature",
  "探索者": "Explorer", "旅人": "Traveler", "旅行": "Travel", "日常": "Everyday Life",
  "时尚": "Fashion", "未来": "Futuristic", "术士": "Mystic", "机械": "Mechanical",
  "权谋": "Court Intrigue", "毛绒": "Plush", "沉稳": "Composed", "治愈": "Comforting",
  "温暖": "Warm", "温柔": "Gentle", "漫剧": "Animated Drama", "热血": "Heroic",
  "玄幻": "Eastern Fantasy", "玩具": "Toy", "现代": "Modern", "生活方式": "Lifestyle",
  "白衣": "White Robes", "短剧": "Short Drama", "科幻": "Sci-Fi", "科技感": "Tech-inspired",
  "童话": "Fairy Tale", "纪实": "Documentary", "职场": "Workplace", "自然": "Natural",
  "荒漠": "Desert", "萌宠": "Cute Pet", "街拍": "Street Style", "装备": "Gear",
  "评测": "Review", "质感": "Premium", "赏金猎人": "Bounty Hunter", "赛博": "Cyberpunk",
  "软萌": "Soft & Cute", "轻熟": "Sophisticated", "通勤": "Urban Commute", "都市": "Urban",
  "都市白领": "Urban Professional", "霓虹": "Neon", "青春": "Youth", "音乐": "Music",
  "飞行员": "Pilot"
};

function romanizeChinese(text: string) {
  const syllables = pinyin(text, {
    toneType: "none",
    type: "array",
    nonZh: "consecutive",
    surname: "head",
  }) as string[];

  return syllables
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function localizeOfficialCharacterName(name: string, source: string, lang: "zh" | "en") {
  if (lang !== "en" || !/[\u3400-\u9fff]/.test(name)) return name;
  return romanizeChinese(name);
}

export function localizeOfficialCharacterTag(tag: string, source: string, lang: "zh" | "en") {
  if (lang !== "en") return tag;
  return ENGLISH_CHARACTER_TAGS[tag] || (/[\u3400-\u9fff]/.test(tag) ? romanizeChinese(tag) : tag);
}

export function localizeOfficialCharacterDescription(
  description: string | null | undefined,
  source: string,
  lang: "zh" | "en"
) {
  if (!description || lang !== "en" || !/[\u3400-\u9fff]/.test(description)) {
    return description || "";
  }

  return "An official character asset designed for consistent use across images and videos.";
}
