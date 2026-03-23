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
        desc: "同一内容自动 10+ 语言版本",
        status: "ready",
    },
    {
        icon: Share2,
        title: "平台发布",
        desc: "一键发布，合规标注自动完成",
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
        label: "ToryX AI 角色",
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
        desc: "AI 内容自动标记，平台反而给更多推荐",
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
        desc: "一键检测合规，避免限流",
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
        answer: "是的，我们主动标注 AIGC，这符合平台要求且不影响推荐流量。合规标注反而能获得平台更多信任。",
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
        { label: "快速生图", href: "/quick-gen" },
        { label: "商图精修", href: "/image-factory" },
        { label: "素材生成视频", href: "/pro-studio/video-batch" },
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
    role: string;
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
    { id: 1,  name: "Emily",  role: "时尚博主", style: "realistic",    src: "/images/landing/char-realistic-1.png" },
    { id: 2,  name: "Marco",  role: "美食探店", style: "realistic",    src: "/images/landing/char-realistic-2.png" },
    { id: 3,  name: "Sophie", role: "旅行达人", style: "realistic",    src: "/images/landing/char-realistic-3.png" },
    { id: 4,  name: "James",  role: "商务讲解", style: "realistic",    src: "/images/landing/char-realistic-4.png" },
    // 动漫 ×4
    { id: 5,  name: "小柚",   role: "二次元科普", style: "anime",      src: "/images/landing/char-anime-1.png" },
    { id: 6,  name: "星河",   role: "虚拟偶像",   style: "anime",      src: "/images/landing/char-anime-2.png" },
    { id: 7,  name: "零",     role: "游戏解说",   style: "anime",      src: "/images/landing/char-anime-3.png" },
    { id: 8,  name: "樱",     role: "日语教学",   style: "anime",      src: "/images/landing/char-anime-4.png" },
    // 3D ×4
    { id: 9,  name: "Nova",   role: "科技评测", style: "3d",           src: "/images/landing/char-3d-1.png" },
    { id: 10, name: "Luna",   role: "品牌代言", style: "3d",           src: "/images/landing/char-3d-2.png" },
    { id: 11, name: "Bolt",   role: "体育解说", style: "3d",           src: "/images/landing/char-3d-3.png" },
    { id: 12, name: "Aria",   role: "音乐推荐", style: "3d",           src: "/images/landing/char-3d-4.png" },
    // 插画 ×4
    { id: 13, name: "墨墨",   role: "绘本故事", style: "illustration", src: "/images/landing/char-illust-1.png" },
    { id: 14, name: "圆圆",   role: "儿童教育", style: "illustration", src: "/images/landing/char-illust-2.png" },
    { id: 15, name: "豆子",   role: "生活Vlog", style: "illustration", src: "/images/landing/char-illust-3.png" },
    { id: 16, name: "阿花",   role: "手绘教程", style: "illustration", src: "/images/landing/char-illust-4.png" },
];
