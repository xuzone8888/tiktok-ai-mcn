// Landing Page 静态数据
// V3.1 重设计 — 角色驱动优质内容创作

import {
    Users, Wand2, Rocket,
    // Hero 场景轮播
    Video, GraduationCap, Globe, ShoppingBag,
    // 角色引擎
    Palette, Mic, Store, Fingerprint,
    // 内容工坊
    Clapperboard, BookOpen, Target, Microscope,
    // 无限可能
    PenTool, Share2,
    // 合规保障
    BadgeCheck, ShieldCheck, FileCheck, Settings, Scan,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ============================================
// 类型定义
// ============================================

export interface WorkflowStep {
    step: string;
    title: string;
    desc: string;
    icon: LucideIcon;
}

export interface FaqItem {
    question: string;
    answer: string;
}

export interface ScenarioItem {
    icon: LucideIcon;
    text: string;
}

export interface CharacterCard {
    icon: LucideIcon;
    title: string;
    desc: string;
}

export interface ContentExample {
    icon: LucideIcon;
    label: string;
    text: string;
}

export interface PossibilityItem {
    icon: LucideIcon;
    title: string;
    desc: string;
    status: "ready" | "coming";
}

export interface ComplianceCard {
    icon: LucideIcon;
    title: string;
    desc: string;
    status: "ready" | "coming";
}

// ============================================
// Hero 区域数据
// ============================================

export const heroData = {
    badge: "AI 角色驱动 · 优质内容持续创作",
    headline: "你的专属 AI 角色，让创作从此不同",
    subheadline:
        "创建独一无二的 AI 角色 · 持续产出专业级短视频 · 释放你的创作力",
    ctaPrimary: "开始创作",
    ctaSecondary: "了解更多",
    inputPlaceholder: "描述你想创建的角色...",
};

// ============================================
// 场景轮播
// ============================================

export const scenarioCarousel: ScenarioItem[] = [
    {
        icon: Video,
        text: "固定人设日更频道，不出镜不剪辑",
    },
    {
        icon: GraduationCap,
        text: "AI 角色把课程变成系列短视频",
    },
    {
        icon: Globe,
        text: "内容很好但只有中文，角色用 10 种语言讲给全世界",
    },
    {
        icon: ShoppingBag,
        text: "200 个产品没达人，60 秒出带货视频",
    },
];

// ============================================
// 角色引擎 — 4 能力卡片
// ============================================

export const characterEngineCards: CharacterCard[] = [
    {
        icon: Palette,
        title: "外观定制",
        desc: "上传参考图，AI 生成专属形象，不担心达人解约",
    },
    {
        icon: Mic,
        title: "声线选配",
        desc: "30+ 种声线，中英日韩，角色用母语与观众对话",
    },
    {
        icon: Store,
        title: "角色市场",
        desc: "上千角色即选即用，按日/周/月灵活聘用",
    },
    {
        icon: Fingerprint,
        title: "人设一致",
        desc: "设定性格与风格，100 条视频同一人设",
    },
];

// ============================================
// 内容工坊 — 4 内容类型
// ============================================

export const contentWorkshopExamples: ContentExample[] = [
    {
        icon: Clapperboard,
        label: "剧情",
        text: "3 个闺蜜的租房日记，每天一集停不下来",
    },
    {
        icon: BookOpen,
        label: "知识",
        text: "3 分钟搞懂量子计算，小学生都能听懂",
    },
    {
        icon: Target,
        label: "种草",
        text: "这个包我背了一周，每天被问链接",
    },
    {
        icon: Microscope,
        label: "科普",
        text: "飞机窗户为什么是圆的？答案你想不到",
    },
];

// ============================================
// 工作流程步骤 (生成引擎)
// ============================================

export const workflowSteps: WorkflowStep[] = [
    {
        step: "01",
        title: "选角色",
        desc: "从角色库挑选，像选演员一样简单",
        icon: Users,
    },
    {
        step: "02",
        title: "定内容",
        desc: "告诉 AI 想表达什么，脚本分镜自动生成",
        icon: Wand2,
    },
    {
        step: "03",
        title: "出成品",
        desc: "多模型渲染 + 字幕配音，4K 即时交付",
        icon: Rocket,
    },
];

// ============================================
// 创作可能性 — 4 方向
// ============================================

export const possibilitiesData: PossibilityItem[] = [
    {
        icon: PenTool,
        title: "内容创作",
        desc: "日更、系列栏目、知识分享、创意表达",
        status: "ready",
    },
    {
        icon: Globe,
        title: "多语种触达",
        desc: "支持多语种内容创作",
        status: "ready",
    },
    {
        icon: Share2,
        title: "平台发布",
        desc: "发布工作台，合规工具一站式整合",
        status: "ready",
    },
    {
        icon: ShoppingBag,
        title: "商品带货",
        desc: "角色讲解产品，挂载商品链接",
        status: "coming",
    },
];

// ============================================
// 效率对比 (WhyUs)
// ============================================

export const comparisonData = {
    traditional: {
        label: "传统方式",
        steps: ["写脚本 (2天)", "约拍摄 (3天)", "拍摄剪辑 (2天)"],
        total: "7 天",
    },
    toryx: {
        label: "Star Gaze AI 角色",
        steps: ["输入想法 (10秒)", "选角色 (10秒)", "AI 生成 (60秒)"],
        total: "2 分钟",
    },
    improvement: "让 AI 角色替你完成重复劳动",
};

// ============================================
// 信任与合规 — 5 能力
// ============================================

export const complianceCards: ComplianceCard[] = [
    {
        icon: BadgeCheck,
        title: "AIGC 标注",
        desc: "AI 内容透明标注，符合平台合规要求",
        status: "ready",
    },
    {
        icon: ShieldCheck,
        title: "原创安全",
        desc: "AI 角色原创生成，无肖像权纠纷",
        status: "ready",
    },
    {
        icon: FileCheck,
        title: "审核适配",
        desc: "隐私、交互、品牌披露全部合规",
        status: "ready",
    },
    {
        icon: Settings,
        title: "用户掌控",
        desc: "所有设置由你决定，无默认勾选",
        status: "ready",
    },
    {
        icon: Scan,
        title: "发布预检",
        desc: "发布前一键合规检测",
        status: "coming",
    },
];

// ============================================
// FAQ 数据
// ============================================

export const faqItems: FaqItem[] = [
    {
        question: "角色能做哪些类型的内容？",
        answer: "短视频、知识科普、剧情演绎、产品种草、品牌故事等，几乎不限题材。AI 角色可以根据你设定的人设和风格，创作各种类型的内容。",
    },
    {
        question: "AI 角色的版权归谁？",
        answer: "归用户所有。AI 角色的形象为原创生成，不涉及真人肖像权，可安全用于商业场景。",
    },
    {
        question: "发布的内容会被标记为 AI 吗？",
        answer: "是的，我们主动标注 AIGC，这符合平台要求。合规标注有助于建立平台信任。",
    },
    {
        question: "支持哪些语言？",
        answer: "中英日韩等 30+ 种语言，同一角色可进行多语种创作，轻松触达全球观众。",
    },
    {
        question: "可以免费试用吗？",
        answer: "注册即送 100 积分，可充分体验核心功能，包括创建 AI 角色和生成视频。",
    },
];

// ============================================
// Footer 链接
// ============================================

export const footerLinks = {
    product: [
        { label: "角色市场", href: "/models" },
        { label: "单图生成", href: "/quick-gen" },
        { label: "创作工作台", href: "/studio" },
    ],
    support: [
        { label: "价格方案", href: "/pricing" },
        { label: "帮助中心", href: "/help" },
        { label: "联系我们", href: "/contact" },
        { label: "反馈建议", href: "/feedback" },
    ],
    legal: [
        { label: "服务条款", href: "/terms" },
        { label: "隐私政策", href: "/privacy" },
        { label: "法律声明", href: "/legal" },
    ],
};

// ============================================
// 角色展示墙
// ============================================

export type CharacterStyle = "realistic" | "anime" | "3d" | "illustration";

export interface CharacterShowcaseItem {
    id: number;
    name: string;
    nameEn: string;
    role: string;
    roleEn: string;
    style: CharacterStyle;
    src: string;
}

export const styleFilters: readonly { id: CharacterStyle | "all"; label: string }[] = [
    { id: "all",          label: "全部" },
    { id: "realistic",    label: "写实" },
    { id: "anime",        label: "动漫" },
    { id: "3d",           label: "3D" },
    { id: "illustration", label: "插画" },
];

export const characterShowcase: CharacterShowcaseItem[] = [
    // 写实 ×4
    { id: 1,  name: "Emily",  nameEn: "Emily",  role: "时尚博主", roleEn: "Fashion Blogger",     style: "realistic",    src: "/images/landing/char-realistic-1.png" },
    { id: 2,  name: "Marco",  nameEn: "Marco",  role: "美食探店", roleEn: "Food Explorer",       style: "realistic",    src: "/images/landing/char-realistic-2.png" },
    { id: 3,  name: "Sophie", nameEn: "Sophie", role: "旅行达人", roleEn: "Travel Vlogger",      style: "realistic",    src: "/images/landing/char-realistic-3.png" },
    { id: 4,  name: "James",  nameEn: "James",  role: "商务讲解", roleEn: "Business Host",        style: "realistic",    src: "/images/landing/char-realistic-4.png" },
    // 动漫 ×4
    { id: 5,  name: "小柚",   nameEn: "Yuzu",    role: "二次元科普", roleEn: "Anime Explainer",   style: "anime",      src: "/images/landing/char-anime-1.png" },
    { id: 6,  name: "星河",   nameEn: "Galaxy",  role: "虚拟偶像",   roleEn: "Virtual Idol",       style: "anime",      src: "/images/landing/char-anime-2.png" },
    { id: 7,  name: "零",     nameEn: "Zero",    role: "游戏解说",   roleEn: "Game Commentator",   style: "anime",      src: "/images/landing/char-anime-3.png" },
    { id: 8,  name: "樱",     nameEn: "Sakura",  role: "日语教学",   roleEn: "Japanese Tutor",     style: "anime",      src: "/images/landing/char-anime-4.png" },
    // 3D ×4
    { id: 9,  name: "Nova",   nameEn: "Nova",   role: "科技评测", roleEn: "Tech Reviewer",        style: "3d",           src: "/images/landing/char-3d-1.png" },
    { id: 10, name: "Luna",   nameEn: "Luna",   role: "品牌代言", roleEn: "Brand Ambassador",     style: "3d",           src: "/images/landing/char-3d-2.png" },
    { id: 11, name: "Bolt",   nameEn: "Bolt",   role: "体育解说", roleEn: "Sports Commentator",   style: "3d",           src: "/images/landing/char-3d-3.png" },
    { id: 12, name: "Aria",   nameEn: "Aria",   role: "音乐推荐", roleEn: "Music Curator",        style: "3d",           src: "/images/landing/char-3d-4.png" },
    // 插画 ×4
    { id: 13, name: "墨墨",   nameEn: "Momo",    role: "绘本故事", roleEn: "Storybook Host",       style: "illustration", src: "/images/landing/char-illust-1.png" },
    { id: 14, name: "圆圆",   nameEn: "Yoyo",    role: "儿童教育", roleEn: "Kids Educator",        style: "illustration", src: "/images/landing/char-illust-2.png" },
    { id: 15, name: "豆子",   nameEn: "Beans",   role: "生活Vlog", roleEn: "Lifestyle Vlogger",    style: "illustration", src: "/images/landing/char-illust-3.png" },
    { id: 16, name: "阿花",   nameEn: "Hana",    role: "手绘教程", roleEn: "Drawing Tutor",        style: "illustration", src: "/images/landing/char-illust-4.png" },
];

// ============================================
// ✦ ENGLISH TRANSLATIONS (parallel data)
// All original Chinese variables above are untouched.
// ============================================

export const heroDataEn = {
    badge: "AI Character-Driven · Premium Content Creation",
    headline: "Your Exclusive AI Character, Redefining Creation",
    subheadline:
        "Create a unique AI character · Produce professional short videos consistently · Unleash your creative potential",
    ctaPrimary: "Start Creating",
    ctaSecondary: "Learn More",
    inputPlaceholder: "Describe the character you want to create...",
};

export const scenarioCarouselEn: ScenarioItem[] = [
    { icon: Video,         text: "Daily channel with fixed persona — no on-camera, no editing" },
    { icon: GraduationCap, text: "AI character turns your course into a video series" },
    { icon: Globe,         text: "Great content but only in Chinese? Character speaks 10 languages to the world" },
    { icon: ShoppingBag,   text: "200 products, zero influencers — 60-second shoppable video, done" },
];

export const characterEngineCardsEn: CharacterCard[] = [
    { icon: Palette,     title: "Appearance",        desc: "Upload a reference image and AI generates your exclusive avatar — no influencer cancellation risk" },
    { icon: Mic,         title: "Voice",              desc: "30+ voice styles, Chinese/English/Japanese/Korean — your character speaks natively to any audience" },
    { icon: Store,       title: "Character Market",   desc: "Thousands of ready-to-use characters, bookable by day, week, or month" },
    { icon: Fingerprint, title: "Consistent Persona", desc: "Set personality and style once — 100 videos, one coherent character" },
];

export const contentWorkshopExamplesEn: ContentExample[] = [
    { icon: Clapperboard, label: "Drama",     text: "3 roommates' apartment diary — one episode a day, impossible to stop" },
    { icon: BookOpen,     label: "Knowledge", text: "Understand quantum computing in 3 minutes — even a 5th-grader gets it" },
    { icon: Target,       label: "Review",    text: "I carried this bag for a week and got asked for the link every day" },
    { icon: Microscope,   label: "Science",   text: "Why are airplane windows round? The answer will surprise you" },
];

export const workflowStepsEn: WorkflowStep[] = [
    { step: "01", title: "Pick a Character", desc: "Choose from the character library — as easy as casting an actor",     icon: Users },
    { step: "02", title: "Define Content",   desc: "Tell the AI what to express — script and storyboard auto-generated",  icon: Wand2 },
    { step: "03", title: "Get Your Video",   desc: "Multi-model rendering + subtitles & voice — 4K delivered instantly",  icon: Rocket },
];

export const possibilitiesDataEn: PossibilityItem[] = [
    { icon: PenTool,     title: "Content Creation",    desc: "Daily posts, series, knowledge-sharing, creative expression", status: "ready" },
    { icon: Globe,       title: "Multilingual Reach",  desc: "Supports multilingual content creation across 10+ languages",    status: "ready" },
    { icon: Share2,      title: "Platform Publishing", desc: "Publishing workspace with built-in compliance tools",         status: "ready" },
    { icon: ShoppingBag, title: "Commerce & Sales",    desc: "Character explains products and links to your store",          status: "coming" },
];

export const comparisonDataEn = {
    traditional: {
        label: "Traditional Workflow",
        steps: ["Write script (2 days)", "Book shoot (3 days)", "Film & edit (2 days)"],
        total: "7 days",
    },
    toryx: {
        label: "Star Gaze AI Character",
        steps: ["Enter idea (10 sec)", "Pick character (10 sec)", "AI generates (60 sec)"],
        total: "2 min",
    },
    improvement: "Let AI characters handle the repetitive work for you",
};

export const faqItemsEn: FaqItem[] = [
    {
        question: "What types of content can AI characters create?",
        answer: "Short videos, educational content, drama skits, product reviews, brand stories, and more — almost any topic. AI characters adapt to your chosen persona and style.",
    },
    {
        question: "Who owns the copyright to an AI character?",
        answer: "You do. AI character appearances are original creations without any real person's likeness, making them safe for commercial use.",
    },
    {
        question: "Will published content be labeled as AI-generated?",
        answer: "Yes — we proactively apply AIGC labels, which complies with platform requirements. Transparent labeling helps build trust with the platform.",
    },
    {
        question: "What languages are supported?",
        answer: "30+ languages including Chinese, English, Japanese, and Korean. One character can produce multilingual content to reach a global audience.",
    },
    {
        question: "Is there a free trial?",
        answer: "Yes — get 100 credits on sign-up to fully experience core features, including creating an AI character and generating videos.",
    },
];

export const footerLinksEn = {
    product: [
        { label: "Character Market",  href: "/models" },
        { label: "Single Image Gen",  href: "/quick-gen" },
        { label: "Creation Studio",   href: "/studio" },
    ],
    support: [
        { label: "Pricing",     href: "/pricing" },
        { label: "Help Center", href: "/help" },
        { label: "Contact Us",  href: "/contact" },
        { label: "Feedback",    href: "/feedback" },
    ],
    legal: [
        { label: "Terms of Service", href: "/terms" },
        { label: "Privacy Policy",   href: "/privacy" },
        { label: "Legal Notice",     href: "/legal" },
    ],
};

export const styleFiltersEn: readonly { id: CharacterStyle | "all"; label: string }[] = [
    { id: "all",          label: "All" },
    { id: "realistic",    label: "Realistic" },
    { id: "anime",        label: "Anime" },
    { id: "3d",           label: "3D" },
    { id: "illustration", label: "Illustration" },
];

export const complianceCardsEn: ComplianceCard[] = [
    { icon: BadgeCheck,  title: "AIGC Labeling",    desc: "AI content transparently labeled — fully aligned with platform compliance requirements", status: "ready" },
    { icon: ShieldCheck, title: "Original & Safe",  desc: "AI character appearances are original — zero portrait rights disputes",  status: "ready" },
    { icon: FileCheck,   title: "Review-Ready",     desc: "Privacy, interactions, and brand disclosures — all fully compliant",     status: "ready" },
    { icon: Settings,    title: "User Control",     desc: "Every setting is your choice — no hidden defaults or pre-checks",        status: "ready" },
    { icon: Scan,        title: "Pre-Publish Check", desc: "One-click compliance scan before publishing to meet platform standards",        status: "coming" },
];
