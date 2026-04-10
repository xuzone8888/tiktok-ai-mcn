/**
 * 定价数据配置
 * 1 积分 = ¥0.05 (20积分 = ¥1)
 */

// 会员套餐类型
export interface PricingPlan {
    id: string;
    name: string;
    subtitle: string;
    monthlyPrice: number;
    yearlyPrice: number; // 年付8折
    credits: number; // 每月赠送积分
    recommended?: boolean;
    features: string[];
    limitations?: string[];
    cta: string;
    ctaLink: string;
}

// 积分充值包
export interface CreditPackage {
    id: string;
    credits: number;
    price: number;
    originalPrice?: number;
    discount?: string;
    badge?: string;
    popular?: boolean;
}

// 会员套餐数据
export const pricingPlans: PricingPlan[] = [
    {
        id: "free",
        name: "免费版",
        subtitle: "体验 AI 创作的无限可能",
        monthlyPrice: 0,
        yearlyPrice: 0,
        credits: 100, // 注册送 100 积分
        features: [
            "🎁 新人礼包：100 积分",
            "🎬 AI 视频生成（全模型）",
            "🖼️ AI 图片生成（多风格）",
            "📝 AI 文案生成",
            "📱 单条发布到 TikTok",
            "📊 基础数据分析",
        ],
        limitations: ["❌ 多条发布"],
        cta: "免费开始",
        ctaLink: "/auth/register",
    },
    {
        id: "creator",
        name: "创作者版",
        subtitle: "个人创作者的效率神器",
        monthlyPrice: 39,
        yearlyPrice: 31, // 年付约8折
        credits: 200,
        features: [
            "🎁 每月赠送 200 积分",
            "🚀 高效发布：10 条/天",
            "⚡ 优先队列：速度提升 30%",
            "📱 账号管理：3 个",
            "🎬 AI 视频生成（全模型）",
            "🖼️ AI 图片生成（高清 4K）",
            "📝 AI 文案：多语言翻译",
            "📊 进阶数据分析",
            "💬 在线客服支持",
            "📥 无水印高清下载",
        ],
        cta: "立即开通",
        ctaLink: "/contact",
    },
    {
        id: "pro",
        name: "专业版",
        subtitle: "专业团队的高效创作平台",
        monthlyPrice: 99,
        yearlyPrice: 79,
        credits: 1000,
        recommended: true,
        features: [
            "🎁 每月赠送 1000 积分",
            "🚀 高效发布：50 条/天",
            "⚡ 极速队列：速度提升 50%",
            "📱 账号管理：10 个",
            "👥 团队协作：3 个席位",
            "🎬 AI 视频：独享高速通道",
            "🖼️ 多任务生成 + 风格迁移",
            "📝 100+ 标题变体生成",
            "📊 实时监控 + 自动报表",
            "🔔 最佳时段智能发布",
            "📦 云端素材库：10GB",
            "💬 1对1 微信群支持",
            "🧾 电子发票",
        ],
        cta: "立即开通",
        ctaLink: "/contact",
    },
    {
        id: "enterprise",
        name: "企业版",
        subtitle: "大规模电商的增长引擎",
        monthlyPrice: 299,
        yearlyPrice: 239,
        credits: 5000,
        features: [
            "🎁 每月赠送 5000 积分",
            "🚀 高效发布：无限制",
            "⚡ 独享通道：0 排队",
            "📱 账号管理：无限",
            "👥 团队协作：10 个席位",
            "🏢 子账号体系管理",
            "🎬 全模型 + API 接口",
            "🖼️ 自定义模型训练",
            "📝 品牌调性定制",
            "📊 BI 看板 + ROI 追踪",
            "🔔 智能分时发布",
            "📦 云端素材库：100GB",
            "💬 7×24 VIP 专属客服",
            "🧾 增值税专票",
            "🎓 1对1 运营培训",
            "🔐 私有化部署可选",
        ],
        cta: "联系我们",
        ctaLink: "/contact",
    },
];

// 积分充值包数据
export const creditPackages: CreditPackage[] = [
    {
        id: "starter",
        credits: 200,
        price: 9.9,
        badge: "首充专享",
    },
    {
        id: "basic",
        credits: 500,
        price: 25,
        originalPrice: 25,
    },
    {
        id: "standard",
        credits: 1000,
        price: 45,
        originalPrice: 50,
        discount: "9折",
    },
    {
        id: "popular",
        credits: 2000,
        price: 80,
        originalPrice: 100,
        discount: "8折",
        popular: true,
    },
    {
        id: "business",
        credits: 5000,
        price: 175,
        originalPrice: 250,
        discount: "7折",
    },
    {
        id: "enterprise",
        credits: 10000,
        price: 300,
        originalPrice: 500,
        discount: "6折",
    },
    {
        id: "unlimited",
        credits: 50000,
        price: 1250,
        originalPrice: 2500,
        discount: "5折",
        badge: "大客户专享",
    },
];

// 功能对比表
export const featureComparison = {
    categories: [
        {
            name: "AI 生成",
            features: [
                { name: "AI 视频生成", free: true, creator: true, pro: true, enterprise: true },
                { name: "AI 图片生成", free: true, creator: true, pro: true, enterprise: true },
                { name: "AI 文案生成", free: true, creator: true, pro: true, enterprise: true },
                { name: "高清 4K 输出", free: false, creator: true, pro: true, enterprise: true },
                { name: "多任务生成", free: false, creator: false, pro: true, enterprise: true },
                { name: "自定义模型", free: false, creator: false, pro: false, enterprise: true },
            ],
        },
        {
            name: "发布管理",
            features: [
                { name: "单条发布", free: true, creator: true, pro: true, enterprise: true },
                { name: "高效发布", free: false, creator: "10条/天", pro: "50条/天", enterprise: "无限" },
                { name: "账号管理", free: "1个", creator: "3个", pro: "10个", enterprise: "无限" },
                { name: "智能发布调度", free: false, creator: false, pro: true, enterprise: true },
            ],
        },
        {
            name: "团队协作",
            features: [
                { name: "团队成员", free: "1人", creator: "1人", pro: "3人", enterprise: "10人" },
                { name: "子账号管理", free: false, creator: false, pro: false, enterprise: true },
                { name: "权限管理", free: false, creator: false, pro: true, enterprise: true },
            ],
        },
        {
            name: "客服支持",
            features: [
                { name: "在线客服", free: false, creator: true, pro: true, enterprise: true },
                { name: "1对1支持", free: false, creator: false, pro: true, enterprise: true },
                { name: "专属客户经理", free: false, creator: false, pro: false, enterprise: true },
                { name: "电子发票", free: false, creator: false, pro: true, enterprise: true },
                { name: "增值税专票", free: false, creator: false, pro: false, enterprise: true },
            ],
        },
    ],
};

// 价格相关 FAQ
export const pricingFaqs = [
    {
        question: "积分是什么？如何消耗？",
        answer: "积分是平台的通用货币。生成一条视频消耗 20 积分（约¥1），生成一张图片消耗 4 积分（约¥0.2）。会员每月赠送积分，用完可随时充值。",
    },
    {
        question: "免费版能用多久？",
        answer: "免费版永久有效！注册即送 100 积分，可生成约 5 条视频。积分用完后可升级会员获取更多，或单独购买积分包。",
    },
    {
        question: "如何升级或降级套餐？",
        answer: "您可以随时升级套餐，未使用的积分会累积。降级需在当前周期结束后生效。如需帮助，请联系客服。",
    },
    {
        question: "支持哪些支付方式？",
        answer: "目前支持微信支付、支付宝。企业版支持对公转账。海外用户请联系客服了解付款方式。",
    },
    {
        question: "发票怎么开？",
        answer: "专业版支持电子发票，企业版支持增值税专用发票。购买后在「账户设置」中申请，1-3 个工作日内开具。",
    },
    {
        question: "不满意可以退款吗？",
        answer: "首次购买 7 天内如不满意，可申请全额退款（已使用积分将扣除）。请通过客服渠道提交申请。",
    },
];

// 营销话术
export const marketingCopy = {
    hero: {
        title: "选择适合你的方案",
        subtitle: "从个人创作者到企业团队，总有一款适合你",
    },
    comparison: {
        title: "对比人工运营成本",
        traditional: {
            label: "传统方式",
            cost: "¥5000+/月",
            items: ["雇人运营", "设计师", "文案"],
        },
        ai: {
            label: "Star Gaze",
            cost: "¥99/月起",
            items: ["全自动生成", "智能发布管理", "数据分析"],
        },
        savings: "节省 98% 成本",
    },
    trust: [
        "🔒 安全支付，支持微信/支付宝",
        "💯 7天无理由退款",
        "🚀 10,000+ 创作者正在使用",
    ],
};
