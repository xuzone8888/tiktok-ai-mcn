#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_OUTPUT = path.join(__dirname, "seed", "role-market-production-100-20260615.json");
const BATCH_ID = "role-market-production-100-20260615";
const CATEGORY_COUNT = 20;

const CATEGORY_PLANS = [
  {
    key: "global-real",
    category: "现代都市",
    characterType: "photorealistic",
    style: "photorealistic premium global contemporary character portrait",
    names: ["艾琳娜", "马库斯", "娜迪亚", "健太", "索菲亚", "阿米娜", "卢卡", "美咲", "迭戈", "伊莎贝尔", "诺拉", "泰勒", "萨米尔", "莉亚", "恩佐", "哈娜", "维克多", "周予安", "阿雅", "欧文"],
    genders: ["female", "male", "female", "male", "female", "female", "male", "female", "male", "female", "female", "male", "male", "female", "male", "female", "male", "male", "female", "male"],
    ageRanges: ["22-28", "30-38", "35-45", "24-32", "46-58", "27-36", "40-52", "20-27", "32-44", "55-68"],
    origins: ["Spanish", "African American", "Middle Eastern", "Japanese", "French", "Nigerian", "Italian", "Korean", "Brazilian", "Mexican", "Nordic", "Canadian", "Indian", "Thai", "Argentinian", "Vietnamese", "German", "Chinese", "Indonesian", "British"],
    roles: ["documentary host", "startup founder", "travel photographer", "streetwear stylist", "retired architect", "wellness coach", "coffee roaster", "music venue producer", "food market creator", "heritage craft curator"],
    looks: ["natural skin texture, clear expressive eyes, relaxed confident posture", "distinctive mature face, calm direct gaze, grounded presence", "short neat hair, warm smile, editorial body language", "soft shoulder length hair, thoughtful eyes, elegant hand pose", "athletic build, lively expression, cinematic profile"],
    outfits: ["linen overshirt, tailored dark trousers, simple leather shoes", "matte black bomber jacket, clean tee, tapered pants", "cream knit sweater, wide-leg denim, small canvas bag", "navy blazer, soft white shirt, cropped trousers", "minimal utility jacket, charcoal inner layer, clean sneakers"],
    settings: ["neutral studio with subtle city light atmosphere", "warm editorial studio with soft window shadows", "minimal concrete stage with refined side lighting", "modern apartment studio with premium lifestyle mood", "night city studio backdrop with controlled rim light"],
    tagSets: [["写实", "都市", "全球化"], ["通勤", "成熟", "职场"], ["街拍", "旅行", "纪实"], ["生活方式", "自然", "轻熟"], ["短剧", "现代", "质感"]],
  },
  {
    key: "xuanhuan-plus",
    category: "古风玄幻",
    characterType: "cinematic",
    style: "cinematic ancient fantasy xianxia character design",
    names: ["晏清", "楚微澜", "谢观雪", "洛千灯", "秦照白", "苏问棠", "沈折柳", "云无咎", "白闻笙", "陆归鸿", "花照影", "顾长宁", "宁明烛", "温素衣", "萧听雨", "孟云台", "叶青辞", "穆照川", "凌月白", "许扶光"],
    genders: ["male", "female", "male", "female", "male", "female", "male", "male", "female", "male", "female", "female", "male", "female", "male", "male", "female", "male", "female", "male"],
    ageRanges: ["22-30", "26-36", "30-46", "24-34"],
    roles: ["wandering sword cultivator", "river pavilion healer", "talisman archivist", "desert spirit envoy", "ancient court investigator", "moonlit assassin", "mountain monk", "phoenix clan strategist", "snowfield exorcist", "bamboo forest musician"],
    looks: ["long dark hair tied with jade, composed eyes, graceful stance", "silver streaked hair, quiet authority, noble posture", "soft face with focused eyes, flowing sleeves, restrained emotion", "sharp brows, weathered expression, strong silhouette", "serene smile, porcelain skin, elegant gesture"],
    outfits: ["layered white and blue hanfu with embroidered sash", "ink black robe with bronze talisman ornaments", "mist green robe with woven belt and jade pendant", "deep crimson court robe with subtle gold thread", "sand-toned traveling cloak over ancient linen"],
    settings: ["misty mountain studio with cinematic rim light", "ancient bamboo forest atmosphere with clear full-body lighting", "moonlit palace corridor mood, no text", "quiet river fog background with premium fantasy light", "warm temple courtyard concept art lighting"],
    tagSets: [["仙侠", "剑修", "白衣"], ["玄幻", "术士", "古风"], ["医师", "温柔", "山林"], ["权谋", "宫廷", "沉稳"], ["奇遇", "异兽", "旅人"]],
  },
  {
    key: "anime-plus",
    category: "漫剧动画",
    characterType: "anime",
    style: "high-end anime manhua character sheet",
    names: ["小凛", "曜介", "桃羽", "凌介", "小夏", "岚音", "星见", "悠斗", "铃叶", "千曜", "未央", "阿拓", "泉里", "青介", "洛洛", "遥香", "白川", "奈绪", "七濑", "风早"],
    genders: ["female", "male", "female", "male", "female", "female", "female", "male", "female", "male", "female", "male", "female", "male", "female", "female", "male", "female", "female", "male"],
    ageRanges: ["19-24", "20-28", "22-30", "18-23"],
    roles: ["slice-of-life lead", "action comic hero", "music club creator", "detective short-drama lead", "cafe assistant", "cyber street racer", "idol trainee", "fantasy academy mentor", "office comedy intern", "urban manga reporter"],
    looks: ["large expressive eyes, clean linework, lively smile", "messy dark hair, confident grin, dynamic stance", "soft twin-tail hairstyle, bright warm expression", "cool gaze, layered hair, athletic posture", "short bob hair, curious eyes, gentle pose"],
    outfits: ["modern cardigan, pleated skirt, small backpack", "black cropped jacket, white tee, slim pants, fingerless gloves", "pastel hoodie, denim shorts, bright sneakers", "cream apron over green dress", "loose shirt, tie, urban comic accessories"],
    settings: ["bright studio with warm animated lighting", "clean comic-style white stage with full-body layout", "sunlit cafe interior mood as controlled character sheet", "night city anime lighting with clear silhouette", "soft pastel room background, premium animation design"],
    tagSets: [["漫剧", "元气", "日常"], ["热血", "少年", "动作"], ["偶像", "音乐", "青春"], ["侦探", "短剧", "悬疑"], ["咖啡店", "治愈", "动画"]],
  },
  {
    key: "scifi-plus",
    category: "奇幻科幻",
    characterType: "cinematic",
    style: "cinematic fantasy science fiction concept character",
    names: ["艾瑞斯", "诺瓦", "岚舟", "凯恩", "赛琳", "奥弥", "月港", "索恩", "青曜", "奈尔", "澄空", "维安", "陆弦", "海拉", "星弛", "雾河", "珀西", "铠南", "艾琳", "玄翼"],
    genders: ["female", "male", "female", "male", "female", "male", "female", "male", "female", "male", "female", "female", "male", "female", "male", "male", "male", "male", "female", "male"],
    ageRanges: ["24-34", "28-42", "22-32", "30-48"],
    roles: ["starship pilot", "desert exoplanet ranger", "mecha field engineer", "orbital medic", "cybernetic diplomat", "time archive keeper", "neon bounty hunter", "alien ecology researcher", "crystal reactor mage", "deep-space courier"],
    looks: ["focused eyes, sleek black hair, confident futuristic stance", "weathered face, practical survival posture, rugged charisma", "silver short hair, precise expression, technical gloves", "calm doctor-like presence, luminous visor detail", "elegant face, subtle cybernetic ear implant, poised hands"],
    outfits: ["black flight suit with teal light accents and utility belt", "sand-toned armored coat, scarf, worn boots", "white and graphite tech jacket, modular tool harness", "midnight bodysuit with soft blue glowing seams", "long asymmetric coat over reinforced tactical layers"],
    settings: ["dark spaceship hangar with controlled cinematic rim light", "alien desert horizon studio backdrop with realistic dust glow", "clean high-tech lab with premium concept art lighting", "rainy neon city background with strong silhouette", "crystal reactor chamber mood without logos or text"],
    tagSets: [["赛博", "飞行员", "未来"], ["探索者", "荒漠", "科幻"], ["机械", "工程师", "装备"], ["医疗", "太空", "冷静"], ["赏金猎人", "霓虹", "动作"]],
  },
  {
    key: "mascot-plus",
    category: "萌宠/IP",
    characterType: "mascot",
    style: "original cute mascot IP character design",
    names: ["草莓火龙", "雪团猫", "布丁企鹅", "星星小鹿", "薄荷鲸", "焦糖小熊", "云朵团", "桃桃狐", "奶霜羊", "栗子犬", "柚子鸟", "海盐水母", "软糖章鱼", "杏仁松鼠", "蜜瓜小虎", "月亮刺猬", "芝士团长", "可可飞鼠", "豆乳小象", "樱桃小豹"],
    genders: Array.from({ length: CATEGORY_COUNT }, () => "neutral"),
    ageRanges: Array.from({ length: CATEGORY_COUNT }, () => "IP"),
    roles: ["brand mascot", "storybook companion", "toy collectible hero", "cute streaming avatar", "children-safe fantasy creature", "snack shop mascot", "adventure game sidekick", "cozy room companion", "holiday campaign mascot", "soft plush character"],
    looks: ["round eyes, soft plush surface, tiny expressive paws", "glossy eyes, chubby cheeks, friendly smile", "small wings, gentle horns, rounded silhouette", "fluffy tail, oversized head, charming tiny bag", "squishy body, simple readable face, collectible proportions"],
    outfits: ["mini satchel and tiny scarf", "small chef hat and pastel apron", "star-shaped collar and little boots", "tiny explorer cape and button pouch", "soft knitted scarf and simple charm"],
    settings: ["bright toy photography studio with soft shadow", "pastel product design stage with premium plush texture", "warm tabletop studio with gentle rim light", "minimal fantasy nursery-style background without text", "clean collectible figure display lighting"],
    tagSets: [["原创IP", "可爱", "吉祥物"], ["萌宠", "毛绒", "治愈"], ["小龙", "奇幻", "玩具"], ["品牌形象", "圆润", "亲和"], ["童话", "伙伴", "软萌"]],
  },
];

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function genderPhrase(gender, origin) {
  if (gender === "female") return `an original adult ${origin ? `${origin} ` : ""}female character`;
  if (gender === "male") return `an original adult ${origin ? `${origin} ` : ""}male character`;
  return "an original non-human mascot character";
}

function descriptionFor(plan, role, tags) {
  if (plan.category === "萌宠/IP") {
    return `${role.name}是原创萌宠/IP角色，适合品牌吉祥物、轻剧情、商品短片和互动内容。`;
  }
  return `${role.name}是${plan.category}方向的原创角色，适合单图、多图和视频中保持一致形象的短内容创作。标签：${tags.join("、")}。`;
}

function promptFor(plan, index, roleName, gender, ageRange, role, look, outfit, setting) {
  if (plan.category === "萌宠/IP") {
    return `${plan.style}: ${roleName}, a fully original non-human cute mascot, ${role}, ${look}, wearing ${outfit}, ${setting}. Full-body character identity, charming expressive design, tactile material detail, clean readable silhouette, premium commercial IP design, suitable for consistent image and video generation.`;
  }

  const origin = plan.origins?.[index % plan.origins.length] || "";
  return `${plan.style}: ${genderPhrase(gender, origin)} named ${roleName}, age range ${ageRange}, ${role}, ${look}, wearing ${outfit}, ${setting}. Full-body identity, consistent facial features, natural hands, clear costume details, high quality production design, suitable for repeated image and video character reference.`;
}

function buildRoles() {
  const roles = [];

  for (const plan of CATEGORY_PLANS) {
    for (let index = 0; index < CATEGORY_COUNT; index += 1) {
      const role = plan.roles[index % plan.roles.length];
      const look = plan.looks[index % plan.looks.length];
      const outfit = plan.outfits[(index + Math.floor(index / plan.outfits.length)) % plan.outfits.length];
      const setting = plan.settings[index % plan.settings.length];
      const tags = plan.tagSets[index % plan.tagSets.length];
      const gender = plan.genders[index % plan.genders.length];
      const ageRange = plan.ageRanges[index % plan.ageRanges.length];
      const name = plan.names[index];
      const seedKey = `${plan.key}-${String(index + 1).padStart(3, "0")}-${slugify(role)}`;
      const prompt = promptFor(plan, index, name, gender, ageRange, role, look, outfit, setting);

      roles.push({
        seedKey,
        name,
        category: plan.category,
        tags,
        characterType: plan.characterType,
        gender,
        ageRange,
        description: descriptionFor(plan, { name }, tags),
        prompt,
      });
    }
  }

  return roles;
}

async function main() {
  const output = path.resolve(process.cwd(), getArg("output", DEFAULT_OUTPUT));
  const manifest = {
    batchId: BATCH_ID,
    boardSize: "2048x1360",
    publishPrice: 100,
    roles: buildRoles(),
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const counts = manifest.roles.reduce((acc, role) => {
    acc[role.category] = (acc[role.category] || 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({ output, total: manifest.roles.length, counts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
