// Landing Page 静态数据
// 从 landing-page.legacy.tsx 提取，供各 Section 组件引用

import { Video, Users, Award, Clock, Wand2, Cpu, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ============================================
// 类型定义
// ============================================

export interface Stat {
    value: string;
    label: string;
    icon: LucideIcon;
}

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

// ============================================
// Hero 区域数据
// ============================================

export const heroData = {
    badge: "全新升级 · 现已支持多模型多生态",
    headline: "从商品链接，到 TikTok 爆款视频",
    subheadline: "60 秒 AI 生成 · 无需达人 · 无需寄样 · 一键全球分发",
    ctaPrimary: "免费开始",
    ctaSecondary: "预约演示",
    inputPlaceholder: "粘贴商品链接，开始生成...",
};

// ============================================
// 实时统计数据 (Live Stats)
// ============================================

export const liveStats: Stat[] = [
    { value: "28,942", label: "今日生成视频", icon: Video },
    { value: "8,392,105", label: "累计全球播放", icon: Users },
    { value: "42", label: "覆盖国家/地区", icon: Award },
];

// ============================================
// 工作流程步骤
// ============================================

export const workflowSteps: WorkflowStep[] = [
    {
        step: "01",
        title: "上传素材",
        desc: "上传图片或输入商品链接，AI 自动分析内容",
        icon: Wand2,
    },
    {
        step: "02",
        title: "AI 智能生成",
        desc: "选择模型和风格，一键生成专业级视频内容",
        icon: Cpu,
    },
    {
        step: "03",
        title: "下载发布",
        desc: "批量下载成品，一键发布到 TikTok 等各大平台",
        icon: Rocket,
    },
];

// ============================================
// FAQ 数据
// ============================================

export const faqItems: FaqItem[] = [
    {
        question: "AI 生成的视频有版权问题吗？",
        answer: "商用安全，素材来自授权库，AI 模特为原创生成，不涉及真人肖像权。",
    },
    {
        question: "需要寄送样品吗？",
        answer: "完全不需要。只需提供商品链接或图片，AI 即可自动提取信息生成视频。",
    },
    {
        question: "生成速度有多快？",
        answer: "平均 60 秒/条，批量任务可排队处理，无需等待。",
    },
    {
        question: "支持哪些平台？",
        answer: "TikTok, Instagram Reels, YouTube Shorts, Facebook Reels，以及抖音、快手等国内平台。",
    },
    {
        question: "可以免费试用吗？",
        answer: "注册即送 100 积分，可生成多条视频体验核心功能。",
    },
];

// ============================================
// Why Us 对比数据
// ============================================

export const comparisonData = {
    traditional: {
        label: "传统模式",
        steps: ["寄样 (7天)", "排期 (3天)", "拍摄 (2天)"],
        total: "12 天",
    },
    toryx: {
        label: "ToryX",
        steps: ["抓取 (3秒)", "生成 (60秒)", "分发 (1秒)"],
        total: "2 分钟",
    },
    improvement: "效率提升 8000%，成本降低 99%",
};

// ============================================
// Footer Logo 带
// ============================================

export const partnerLogos = [
    "Amazon",
    "Shopify",
    "TikTok",
    "Instagram",
    "YouTube",
    "飞书",
];

// ============================================
// Footer 链接
// ============================================

export const footerLinks = {
    product: [
        { label: "快速视频生成", href: "/quick-gen" },
        { label: "电商图片工厂", href: "/image-factory" },
        { label: "批量视频制作", href: "/pro-studio/video-batch" },
        { label: "AI 模特管理", href: "/models" },
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
