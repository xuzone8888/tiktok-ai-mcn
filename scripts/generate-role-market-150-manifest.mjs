#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_OUTPUT = path.join(__dirname, "seed", "role-market-production-150-20260615.json");
const BATCH_ID = "role-market-production-150-20260615";
const CATEGORY_COUNT = 30;

const CATEGORY_PLANS = [
  {
    key: "urban",
    category: "现代都市",
    characterType: "photorealistic",
    style: "photorealistic premium contemporary portrait",
    names: ["宁夏", "陆青", "许然", "沈知予", "程墨", "林悦", "周序", "顾安", "叶晴", "宋辰", "方梨", "何川", "苏望", "唐可", "许鸢", "韩序", "白栀", "纪南", "岑光", "梁澈", "乔安", "黎川", "温禾", "秦朗", "夏予", "顾南枝", "江屿", "陆微", "尹珂", "陈星野"],
    genders: ["female", "male", "female", "female", "male", "female", "male", "male", "female", "male", "female", "male", "male", "female", "female", "male", "female", "female", "male", "male", "female", "male", "female", "male", "female", "female", "male", "female", "female", "male"],
    ageRanges: ["24-30", "26-34", "25-32", "27-35"],
    roles: ["city lifestyle vlogger", "independent fashion editor", "tech product reviewer", "coffee shop founder", "documentary photographer", "creative agency producer", "fitness content coach", "night market food creator", "jazz bar singer", "urban travel host"],
    looks: ["clean confident face, natural skin texture, expressive eyes", "short neat hair, calm direct gaze, refined posture", "soft shoulder length hair, relaxed smile, balanced figure", "sharp jawline, warm eyes, effortless street style", "minimal makeup, elegant mature presence, poised hands"],
    outfits: ["ivory shirt, tailored dark trousers, leather loafers", "matte black trench coat, charcoal inner layer, slim boots", "cream knit top, high waist denim, simple canvas bag", "navy blazer, relaxed white tee, cropped trousers", "soft grey hoodie layered with a technical vest, clean sneakers"],
    settings: ["neutral studio background with a faint city light mood", "subtle concrete studio set, cinematic side lighting", "warm editorial studio, clean floor shadow", "minimal apartment studio with soft window light", "modern loft backdrop, premium lifestyle photography"],
    tagSets: [["都市白领", "通勤", "生活方式"], ["街拍", "时尚", "现代"], ["科技感", "评测", "都市"], ["咖啡店", "创业者", "温暖"], ["夜景", "导演感", "短剧"]],
  },
  {
    key: "xuanhuan",
    category: "古风玄幻",
    characterType: "cinematic",
    style: "cinematic xianxia fantasy character design",
    names: ["云祈", "沈砚秋", "洛白", "青棠", "玄照", "柳听雪", "谢无尘", "苏照夜", "白若衡", "温照", "闻溪", "顾青崖", "凌霜", "萧既明", "云蘅", "陆观澜", "楚夜白", "秦疏影", "谢知微", "姜云舟", "穆长风", "宁扶摇", "宋清辞", "花辞树", "叶长宁", "许灵均", "孟听澜", "沈不疑", "阿照", "南烛"],
    genders: ["female", "male", "male", "female", "male", "female", "male", "female", "male", "male", "female", "male", "female", "male", "female", "male", "male", "female", "female", "male", "male", "female", "female", "female", "female", "male", "female", "male", "female", "male"],
    ageRanges: ["22-30", "25-38", "28-45", "24-34"],
    roles: ["sword cultivator", "wandering talisman scholar", "mountain healer", "ancient court strategist", "spirit beast envoy", "white-robed immortal", "desert caravan mystic", "rain pavilion assassin", "bamboo forest monk", "moonlit river exorcist"],
    looks: ["long dark hair tied with a jade clasp, clear composed eyes", "silver-streaked hair, calm weathered expression, noble posture", "soft face, focused eyes, flowing sleeves", "sharp brows, quiet authority, graceful stance", "serene smile, porcelain skin, elegant hand gesture"],
    outfits: ["layered white and pale blue hanfu, embroidered sash, light fabric", "ink black robe with bronze talisman ornaments", "mist green healer robe, woven belt, simple jade pendant", "deep crimson court robe with subtle gold thread", "sand colored traveling cloak over ancient linen garments"],
    settings: ["misty mountain studio backdrop with soft rim light", "ancient bamboo forest atmosphere, clean full-body lighting", "moonlit palace corridor mood, no text or symbols", "quiet river fog background with cinematic fantasy lighting", "warm temple courtyard light, premium character concept art"],
    tagSets: [["仙侠", "白衣", "剑修"], ["玄幻", "术士", "古风"], ["医师", "温柔", "山林"], ["权谋", "宫廷", "沉稳"], ["异兽", "使者", "奇遇"]],
  },
  {
    key: "anime",
    category: "漫剧动画",
    characterType: "anime",
    style: "high-end anime manhua character sheet",
    names: ["晴奈", "陆燃", "夏桃", "北辰", "七月", "星野", "小澈", "南栀", "千寻", "岚一", "米娅", "阿洛", "若叶", "川音", "小满", "阿景", "铃夏", "青羽", "白鸟", "光希", "泉奈", "悠真", "小椿", "绪风", "柚里", "澪", "渡", "千夏", "遥", "森川"],
    genders: ["female", "male", "female", "male", "female", "male", "male", "female", "female", "male", "female", "male", "female", "female", "female", "male", "female", "male", "female", "male", "female", "male", "female", "male", "female", "female", "male", "female", "male", "male"],
    ageRanges: ["20-26", "21-28", "22-30", "19-25"],
    roles: ["slice-of-life heroine", "action comic protagonist", "music club creator", "detective short-drama lead", "bakery assistant", "cyber street racer", "idol trainee", "fantasy academy mentor", "comedy office intern", "urban manga reporter"],
    looks: ["large expressive eyes, clean linework, lively smile", "messy dark hair, confident grin, dynamic stance", "soft twin-tail hairstyle, bright warm expression", "cool gaze, layered hair, athletic posture", "short bob hair, curious eyes, gentle pose"],
    outfits: ["modern casual cardigan, pleated skirt, small backpack", "black cropped jacket, white tee, slim pants, fingerless gloves", "pastel hoodie, denim shorts, bright sneakers", "cream apron over green dress, cafe styling", "loose shirt, tie, urban comic accessories"],
    settings: ["bright studio backdrop with warm animated lighting", "clean comic-style white stage, full-body turntable layout", "sunlit cafe interior mood rendered as a controlled character sheet", "night city anime lighting with clear silhouette", "soft pastel room background, premium animation design"],
    tagSets: [["漫剧", "元气", "日常"], ["热血", "少年", "动作"], ["偶像", "音乐", "青春"], ["侦探", "短剧", "悬疑"], ["咖啡店", "治愈", "动画"]],
  },
  {
    key: "scifi",
    category: "奇幻科幻",
    characterType: "cinematic",
    style: "cinematic fantasy science fiction concept character",
    names: ["星澜", "诺亚辰", "银岚", "凯洛", "岑星", "洛塔", "伊芙", "阿湛", "赫然", "赛琳", "奥弥", "黎烁", "月港", "索恩", "青曜", "奈尔", "澄空", "维安", "陆弦", "海拉", "星弛", "岚舟", "雾河", "珀西", "铠南", "艾琳", "玄翼", "烁光", "塔林", "弥生"],
    genders: ["female", "male", "female", "male", "female", "male", "female", "male", "male", "female", "male", "male", "female", "male", "female", "male", "female", "female", "male", "female", "male", "female", "male", "male", "male", "female", "male", "female", "male", "female"],
    ageRanges: ["24-34", "28-42", "22-32", "30-48"],
    roles: ["starship pilot", "desert exoplanet ranger", "mecha field engineer", "orbital medic", "cybernetic diplomat", "time archive keeper", "neon bounty hunter", "alien ecology researcher", "crystal reactor mage", "deep-space courier"],
    looks: ["focused eyes, sleek black hair, confident futuristic stance", "weathered face, practical survival posture, rugged charisma", "silver short hair, precise expression, technical gloves", "calm doctor-like presence, luminous visor detail", "elegant face, subtle cybernetic ear implant, poised hands"],
    outfits: ["black flight suit with teal light accents and utility belt", "sand-toned armored coat, scarf, worn boots", "white and graphite tech jacket, modular tool harness", "midnight bodysuit with soft blue glowing seams", "long asymmetric coat over reinforced tactical layers"],
    settings: ["dark spaceship hangar with controlled cinematic rim light", "alien desert horizon studio backdrop, realistic dust glow", "clean high-tech lab environment, premium concept art lighting", "rainy neon city background, strong silhouette", "crystal reactor chamber mood, no logos or text"],
    tagSets: [["赛博", "飞行员", "未来"], ["探索者", "荒漠", "科幻"], ["机械", "工程师", "装备"], ["医疗", "太空", "冷静"], ["赏金猎人", "霓虹", "动作"]],
  },
  {
    key: "mascot",
    category: "萌宠/IP",
    characterType: "mascot",
    style: "original cute mascot IP character design",
    names: ["莓果龙仔", "棉花布丁", "泡泡鹿", "奶霜企鹅", "柚子团", "星糖狐", "栗子熊", "云朵猫", "薄荷小鲸", "芝士团长", "桃桃兔", "蓝莓咕咕", "糯米羊", "花卷犬", "焦糖鸭", "月亮刺猬", "雪糕熊猫", "小橘灯", "海盐水母", "杏仁松鼠", "蜜瓜恐龙", "豆乳小虎", "晴天蘑菇", "可可飞鼠", "软糖章鱼", "奶盖小狮", "葡萄星球", "布丁小象", "樱桃小豹", "铃铛云雀"],
    genders: Array.from({ length: CATEGORY_COUNT }, () => "neutral"),
    ageRanges: Array.from({ length: CATEGORY_COUNT }, () => "IP"),
    roles: ["brand mascot", "storybook companion", "toy collectible hero", "cute streaming avatar", "children-safe fantasy creature", "snack shop mascot", "adventure game sidekick", "cozy room companion", "holiday campaign mascot", "soft plush character"],
    looks: ["round eyes, soft plush surface, tiny expressive paws", "glossy eyes, chubby cheeks, friendly smile", "small wings, gentle horns, rounded silhouette", "fluffy tail, oversized head, charming tiny bag", "squishy body, simple readable face, collectible proportions"],
    outfits: ["mini satchel and tiny scarf", "small chef hat and pastel apron", "star-shaped collar and little boots", "tiny explorer cape and button pouch", "soft knitted scarf and simple charm"],
    settings: ["bright toy photography studio, soft shadow, clean background", "pastel product design stage, premium plush texture", "warm tabletop studio with gentle rim light", "minimal fantasy nursery-style background without text", "clean collectible figure display lighting"],
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

function genderPhrase(gender) {
  if (gender === "female") return "an original adult female character";
  if (gender === "male") return "an original adult male character";
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

  return `${plan.style}: ${genderPhrase(gender)} named ${roleName}, age range ${ageRange}, ${role}, ${look}, wearing ${outfit}, ${setting}. Full-body identity, consistent facial features, natural hands, clear costume details, high quality production design, suitable for repeated image and video character reference.`;
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
