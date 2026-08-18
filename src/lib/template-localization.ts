import type { ContentTemplate } from "@/types/content-template";

type EnglishTemplateCopy = {
  name: string;
  description: string;
  outline: string[];
  scene: string;
};

const ENGLISH_TEMPLATE_COPY: Record<number, EnglishTemplateCopy> = {
  1: {
    name: "Best-Selling Product Showcase",
    description: "Highlight a hero product with energetic visuals, clear benefits, and a strong purchase call to action.",
    outline: ["Hook: rotating product close-up (0–3s)", "Benefit 1: core feature demo (3–6s)", "Benefit 2: real-use scenario (6–9s)", "Benefit 3: comparison or proof (9–12s)", "Close: offer and purchase CTA (12–15s)"],
    scene: "Product close-ups and real-use scenes",
  },
  2: {
    name: "Unboxing & Hands-On Review",
    description: "Walk viewers through packaging, accessories, first impressions, and an honest hands-on verdict.",
    outline: ["Unbox and reveal the package (0–4s)", "Show accessories and build quality (4–8s)", "Demonstrate the product in use (8–12s)", "Give a concise verdict (12–14s)", "Invite viewers to comment (14–15s)"],
    scene: "Unboxing and hands-on use",
  },
  3: {
    name: "Product Comparison Review",
    description: "Compare competing products across design, features, and price to help viewers make a purchase decision.",
    outline: ["Introduce the products being compared (0–2s)", "Compare design side by side (2–5s)", "Compare core features (5–9s)", "Compare price and value (9–12s)", "Recommend the best choice (12–15s)"],
    scene: "Side-by-side products and data graphics",
  },
  4: {
    name: "Limited-Time Flash Sale",
    description: "Create urgency for flash sales, major promotions, or clearance events with bold prices and a countdown.",
    outline: ["Open with a limited-time countdown (0–2s)", "Feature deal one and sale price (2–5s)", "Feature deal two and discount (5–8s)", "Feature deal three and stock warning (8–11s)", "Close with final-chance CTA (11–15s)"],
    scene: "Sale graphics, price tags, and countdowns",
  },
  5: {
    name: "Brand Story",
    description: "Build an emotional connection by presenting the brand origin, mission, people, and defining values.",
    outline: ["Introduce the brand origin (0–3s)", "Show a key growth milestone (3–7s)", "Express the brand mission (7–10s)", "Feature the people behind the work (10–13s)", "Close with the brand message (13–15s)"],
    scene: "Brand visuals and human stories",
  },
  6: {
    name: "Customer Testimonial",
    description: "Use authentic reviews, customer outcomes, and concrete proof to strengthen brand trust.",
    outline: ["Open with ratings or review volume (0–2s)", "Share customer result one (2–5s)", "Show customer result two with proof (5–8s)", "Add a third recommendation (8–11s)", "Close with overall satisfaction (11–15s)"],
    scene: "Customer feedback and supporting data",
  },
  7: {
    name: "Achievement Transformation",
    description: "Show progress from beginner to achievement with a motivating before-and-after transformation.",
    outline: ["Show the starting point (0–3s)", "Present key learning milestones (3–7s)", "Reveal the breakthrough moment (7–10s)", "Show the final result and data (10–13s)", "Close with an encouraging CTA (13–15s)"],
    scene: "Before-and-after visuals with progress data",
  },
  8: {
    name: "Practical Tips",
    description: "Deliver three to five useful, actionable tips in a concise format viewers will want to save and share.",
    outline: ["Preview the tips (0–2s)", "Demonstrate tip one (2–5s)", "Demonstrate tip two (5–8s)", "Demonstrate tip three (8–11s)", "Invite viewers to save and follow (11–15s)"],
    scene: "Screen capture and practical demonstrations",
  },
  9: {
    name: "Step-by-Step Tutorial",
    description: "Teach a skill or workflow through clearly labeled steps, demonstrations, and a concise recap.",
    outline: ["Introduce what viewers will learn (0–2s)", "Demonstrate step one (2–5s)", "Demonstrate step two (5–8s)", "Demonstrate step three (8–11s)", "Recap the process and result (11–15s)"],
    scene: "Guided demonstration with step labels",
  },
  10: {
    name: "Frequently Asked Questions",
    description: "Answer the audience’s most common questions with direct explanations, examples, and supporting visuals.",
    outline: ["Introduce the top questions (0–2s)", "Answer question one (2–5s)", "Answer question two with an example (5–8s)", "Answer question three clearly (8–11s)", "Invite more questions in comments (11–15s)"],
    scene: "Question cards and visual explanations",
  },
  11: {
    name: "Daily Lifestyle Vlog",
    description: "Capture memorable moments across a day with a warm, relaxed rhythm and a distinctive personal aesthetic.",
    outline: ["Morning routine and breakfast (0–3s)", "Work or study moment (3–6s)", "Afternoon break or coffee (6–9s)", "Evening activity or social moment (9–12s)", "Close with a reflective night scene (12–15s)"],
    scene: "Everyday moments and atmospheric lifestyle scenes",
  },
  12: {
    name: "Fitness Check-In",
    description: "Present a workout sequence, technique, and progress in an energetic format that motivates viewers to join in.",
    outline: ["Begin the workout and warm-up (0–2s)", "Demonstrate exercise one (2–5s)", "Demonstrate exercise two with form tips (5–8s)", "Show the final high-intensity set (8–11s)", "Close with progress and motivation (11–15s)"],
    scene: "Gym and active workout settings",
  },
  13: {
    name: "Food & Restaurant Review",
    description: "Showcase a restaurant or dish through appetizing close-ups, tasting reactions, prices, and a clear verdict.",
    outline: ["Establish the restaurant atmosphere (0–2s)", "Show and taste dish one (2–5s)", "Feature preparation or detail shots (5–8s)", "Reveal the signature dish (8–11s)", "Close with rating and recommendation (11–15s)"],
    scene: "Food close-ups and dining environments",
  },
  14: {
    name: "Fashion Lookbook",
    description: "Present outfit inspiration for multiple occasions using confident styling and quick-change transitions.",
    outline: ["Introduce today’s style theme (0–2s)", "Look one: casual outfit (2–5s)", "Look two: work outfit (5–8s)", "Look three: date-night outfit (8–11s)", "Ask viewers to choose a favorite (11–15s)"],
    scene: "Mirror transitions and street-style shots",
  },
  15: {
    name: "Creative Photo Slideshow",
    description: "Turn a curated image set into a polished, rhythmic video for portfolios or product collections.",
    outline: ["Open with a theme title card (0–2s)", "Animate images one to three (2–5s)", "Transition through images four to six (5–8s)", "Build momentum with images seven to nine (8–11s)", "Close with the collection name (11–15s)"],
    scene: "Curated images with animated motion effects",
  },
  16: {
    name: "Interactive Poll",
    description: "Spark comments with an engaging A-versus-B question, a clear comparison, and a direct voting prompt.",
    outline: ["Ask viewers to choose A or B (0–2s)", "Present option A (2–5s)", "Present option B (5–8s)", "Compare the key difference (8–11s)", "Invite votes in the comments (11–15s)"],
    scene: "Side-by-side options and voting prompts",
  },
};

const ENGLISH_TAGS: Record<string, string> = {
  "产品展示": "Product Showcase", "电商": "E-commerce", "快节奏": "Fast-Paced", "高级感": "Premium",
  "开箱": "Unboxing", "测评": "Review", "第一人称": "First Person", "真实感": "Authentic",
  "对比": "Comparison", "横评": "Comparative Review", "专业": "Professional", "数据驱动": "Data-Driven",
  "秒杀": "Flash Sale", "促销": "Promotion", "紧迫感": "Urgency", "大促": "Major Sale",
  "品牌故事": "Brand Story", "叙事": "Storytelling", "情感连接": "Emotional", "用户评价": "Customer Reviews",
  "社会证明": "Social Proof", "口碑": "Word of Mouth", "真实": "Authentic", "成就": "Achievement",
  "励志": "Motivational", "蜕变": "Transformation", "技巧": "Tips", "干货": "Practical",
  "教程": "Tutorial", "收藏向": "Save-Worthy", "分步": "Step-by-Step", "手把手": "Guided",
  "技能": "Skills", "问答": "Q&A", "互动": "Interactive", "日常": "Daily Life",
  "治愈": "Comforting", "生活方式": "Lifestyle", "健身": "Fitness", "运动": "Workout",
  "打卡": "Check-In", "自律": "Discipline", "美食": "Food", "探店": "Restaurant Review",
  "试吃": "Tasting", "种草": "Recommendation", "穿搭": "Outfits", "时尚": "Fashion",
  "换装": "Quick Change", "图片": "Photography", "轮播": "Slideshow", "作品集": "Portfolio",
  "视觉": "Visual", "投票": "Poll", "话题": "Topic", "评论引导": "Comment Prompt"
};

function containsChinese(value: string | null | undefined) {
  return Boolean(value && /[\u3400-\u9fff]/.test(value));
}

export function localizeTemplate(template: ContentTemplate, lang: "zh" | "en"): ContentTemplate {
  if (lang === "zh") return template;

  const copy = ENGLISH_TEMPLATE_COPY[template.sort_order];
  const name = copy?.name || `Template ${template.sort_order || template.id.slice(0, 6)}`;
  const description = copy?.description || "A ready-to-use short-form content template for a clear, engaging production workflow.";

  return {
    ...template,
    name,
    description,
    style_tags: template.style_tags.map((tag, index) =>
      ENGLISH_TAGS[tag] || (containsChinese(tag) ? `Style ${index + 1}` : tag)
    ),
    recommended_config: {
      ...template.recommended_config,
      scene: copy?.scene || (containsChinese(template.recommended_config.scene) ? "Recommended production scene" : template.recommended_config.scene),
    },
  };
}
