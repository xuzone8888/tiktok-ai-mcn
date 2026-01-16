"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Video,
  Image as ImageIcon,
  Sparkles,
  Zap,
  Users,
  Shield,
  ArrowRight,
  Play,
  CheckCircle,
  Star,
  Globe,
  Cpu,
  Layers,
  Wand2,
  TrendingUp,
  Clock,
  Award,
  Rocket,
} from "lucide-react";

const features = [
  {
    icon: Video,
    title: "AI 视频生成",
    titleEn: "AI Video Generation",
    description: "基于 Sora2、VEO3 等顶级 AI 模型，将图片或文字转化为高质量短视频",
    gradient: "from-cyan-500 to-blue-500",
    bgGlow: "bg-cyan-500/20",
  },
  {
    icon: ImageIcon,
    title: "电商图片工厂",
    titleEn: "E-commerce Image Factory",
    description: "一键生成商品展示图、模特换装图，支持批量处理，提升电商运营效率",
    gradient: "from-pink-500 to-rose-500",
    bgGlow: "bg-pink-500/20",
  },
  {
    icon: Sparkles,
    title: "AI 数字人模特",
    titleEn: "AI Digital Models",
    description: "签约专属 AI 模特，注入品牌基因，打造独特视觉风格",
    gradient: "from-purple-500 to-violet-500",
    bgGlow: "bg-purple-500/20",
  },
  {
    icon: Layers,
    title: "批量视频制作",
    titleEn: "Batch Video Production",
    description: "专业工作室支持批量创建任务，一次提交多个视频，自动队列处理",
    gradient: "from-amber-500 to-orange-500",
    bgGlow: "bg-amber-500/20",
  },
  {
    icon: Globe,
    title: "链接一键成片",
    titleEn: "Link to Video",
    description: "输入商品链接，自动提取信息生成营销视频脚本，智能配图成片",
    gradient: "from-emerald-500 to-teal-500",
    bgGlow: "bg-emerald-500/20",
  },
  {
    icon: Users,
    title: "团队协作",
    titleEn: "Team Collaboration",
    description: "支持多人团队管理，积分共享，任务分配，高效协同创作",
    gradient: "from-indigo-500 to-blue-500",
    bgGlow: "bg-indigo-500/20",
  },
];

const stats = [
  { value: "50万+", label: "累计生成视频", icon: Video },
  { value: "10万+", label: "活跃创作者", icon: Users },
  { value: "99.9%", label: "服务可用性", icon: Award },
  { value: "5秒", label: "平均响应时间", icon: Clock },
];

const testimonials = [
  {
    content: "使用这个平台后，我们的短视频产出效率提升了 10 倍，电商转化率显著提高。",
    author: "张经理",
    role: "某电商品牌运营总监",
    avatar: "Z",
    gradient: "from-cyan-500 to-blue-500",
  },
  {
    content: "AI 模特功能太惊艳了，再也不用花大价钱请真人模特拍摄，效果一样出色。",
    author: "李女士",
    role: "独立电商卖家",
    avatar: "L",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    content: "批量生成功能节省了大量时间，一个人就能完成整个团队的工作量。",
    author: "王先生",
    role: "MCN 机构创始人",
    avatar: "W",
    gradient: "from-purple-500 to-violet-500",
  },
];

const workflowSteps = [
  {
    step: "01",
    title: "上传素材",
    desc: "上传图片或输入商品链接，AI 自动分析内容",
    icon: Wand2,
    color: "text-cyan-400",
    gradient: "from-cyan-500/20 to-cyan-500/5"
  },
  {
    step: "02",
    title: "AI 智能生成",
    desc: "选择模型和风格，一键生成专业级视频内容",
    icon: Cpu,
    color: "text-purple-400",
    gradient: "from-purple-500/20 to-purple-500/5"
  },
  {
    step: "03",
    title: "下载发布",
    desc: "批量下载成品，一键发布到 TikTok 等各大平台",
    icon: Rocket,
    color: "text-pink-400",
    gradient: "from-pink-500/20 to-pink-500/5"
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* 背景装饰 - 增强版 */}
      <div className="fixed inset-0 pointer-events-none">
        {/* 主光晕 */}
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[150px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-pink-500/10 rounded-full blur-[150px] animate-pulse" style={{ animationDuration: '10s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] bg-purple-500/5 rounded-full blur-[180px]" />
        {/* 网格背景 */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
        {/* 渐变遮罩 */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#0a0a0f]/50 to-[#0a0a0f]" />
      </div>

      {/* 导航栏 */}
      <header className="relative z-50 border-b border-white/5 backdrop-blur-xl bg-black/30 sticky top-0">
        <div className="container max-w-7xl mx-auto px-6 py-4">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-400 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25 group-hover:shadow-purple-500/40 transition-shadow">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent">
                  Tok Factory
                </span>
                <span className="text-[10px] text-gray-500 tracking-wider">AI 内容智造工厂</span>
              </div>
            </Link>

            <div className="hidden md:flex items-center gap-8">
              <Link href="#features" className="text-sm text-gray-400 hover:text-white transition-colors relative group">
                功能特色
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-cyan-400 to-pink-400 group-hover:w-full transition-all duration-300" />
              </Link>
              <Link href="#workflow" className="text-sm text-gray-400 hover:text-white transition-colors relative group">
                使用流程
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-cyan-400 to-pink-400 group-hover:w-full transition-all duration-300" />
              </Link>
              <Link href="/terms" className="text-sm text-gray-400 hover:text-white transition-colors relative group">
                服务条款
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-cyan-400 to-pink-400 group-hover:w-full transition-all duration-300" />
              </Link>
              <Link href="/privacy" className="text-sm text-gray-400 hover:text-white transition-colors relative group">
                隐私政策
                <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-gradient-to-r from-cyan-400 to-pink-400 group-hover:w-full transition-all duration-300" />
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/auth/login">
                <Button variant="ghost" className="text-gray-300 hover:text-white hover:bg-white/10 transition-all">
                  登录
                </Button>
              </Link>
              <Link href="/auth/register">
                <Button className="bg-gradient-to-r from-cyan-500 to-pink-500 hover:opacity-90 text-white border-0 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all">
                  免费注册
                </Button>
              </Link>
            </div>
          </nav>
        </div>
      </header>

      {/* Hero 区域 - 增强版 */}
      <section className="relative z-10 pt-24 pb-32">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center max-w-5xl mx-auto">
            {/* 徽章 */}
            <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-white/10 mb-10 backdrop-blur-sm">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-sm text-gray-300">全新升级 · 现已支持 Sora2 & VEO3 模型</span>
              <ArrowRight className="h-4 w-4 text-gray-400" />
            </div>

            {/* 主标题 */}
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold leading-[1.1] mb-8">
              <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
                AI 驱动的
              </span>
              <br />
              <span className="text-white">短视频创作平台</span>
            </h1>

            {/* 副标题 */}
            <p className="text-xl md:text-2xl text-gray-400 mb-12 max-w-3xl mx-auto leading-relaxed">
              一站式 AI 内容创作解决方案，从图片生成、视频制作到数字人模特，
              <br className="hidden md:block" />
              让每一个创作者都能<span className="text-white font-medium">高效产出专业级</span>短视频内容
            </p>

            {/* CTA 按钮 */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-5">
              <Link href="/auth/register">
                <Button size="lg" className="h-16 px-10 text-lg bg-gradient-to-r from-cyan-500 to-pink-500 hover:opacity-90 text-white border-0 shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all hover:scale-105 group">
                  <Play className="h-5 w-5 mr-3 group-hover:scale-110 transition-transform" />
                  开始免费创作
                  <ArrowRight className="h-5 w-5 ml-3 group-hover:translate-x-1 transition-transform" />
                </Button>
              </Link>
              <Link href="#features">
                <Button size="lg" variant="outline" className="h-16 px-10 text-lg border-white/20 text-white hover:bg-white/10 hover:border-white/30 transition-all">
                  <TrendingUp className="h-5 w-5 mr-2" />
                  了解更多
                </Button>
              </Link>
            </div>
          </div>

          {/* 统计数据 - 卡片版 */}
          <div className="mt-24 grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {stats.map((stat, index) => (
              <div
                key={index}
                className="relative group p-6 rounded-2xl bg-white/[0.03] border border-white/10 hover:border-white/20 transition-all duration-300 hover:-translate-y-1 backdrop-blur-sm"
              >
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500/5 to-pink-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <stat.icon className="h-5 w-5 text-gray-500 mb-3" />
                  <div className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent mb-1">
                    {stat.value}
                  </div>
                  <div className="text-sm text-gray-500">{stat.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 功能特色 - 重新设计 */}
      <section id="features" className="relative z-10 py-28">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-6">
              <Cpu className="h-4 w-4 text-purple-400" />
              <span className="text-sm text-gray-400">强大功能</span>
            </div>
            <h2 className="text-4xl md:text-6xl font-bold mb-6">
              <span className="text-white">强大的</span>
              <span className="bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent"> 人工智能创作工具</span>
            </h2>
            <p className="text-gray-400 text-lg md:text-xl max-w-2xl mx-auto">
              集成最先进的 AI 技术，为您提供全方位的内容创作能力
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="relative bg-white/[0.02] border-white/10 hover:border-white/25 transition-all duration-500 hover:-translate-y-2 group overflow-hidden"
              >
                {/* 光晕效果 */}
                <div className={`absolute -top-20 -right-20 w-40 h-40 ${feature.bgGlow} rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />

                <CardContent className="relative p-8">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-lg`}>
                    <feature.icon className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{feature.title}</h3>
                  <p className="text-xs text-gray-500 mb-3 uppercase tracking-wider">{feature.titleEn}</p>
                  <p className="text-gray-400 leading-relaxed">{feature.description}</p>

                  <div className="mt-6 flex items-center text-sm text-gray-500 group-hover:text-white transition-colors">
                    <span>了解更多</span>
                    <ArrowRight className="h-4 w-4 ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* 工作流程 - 重新设计 */}
      <section id="workflow" className="relative z-10 py-28 bg-gradient-to-b from-transparent via-purple-500/[0.02] to-transparent">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-6">
              <Wand2 className="h-4 w-4 text-cyan-400" />
              <span className="text-sm text-gray-400">简单易用</span>
            </div>
            <h2 className="text-4xl md:text-6xl font-bold mb-6 text-white">
              简单 <span className="bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent">三步</span> 完成创作
            </h2>
            <p className="text-gray-400 text-lg md:text-xl">无需专业技能，人人都能轻松上手</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            {workflowSteps.map((item, index) => (
              <div key={index} className="relative group">
                {/* 连接线 */}
                {index < 2 && (
                  <div className="hidden md:block absolute top-16 left-[60%] w-[80%] h-[2px] bg-gradient-to-r from-white/10 to-transparent" />
                )}

                <div className={`relative p-8 rounded-3xl bg-gradient-to-b ${item.gradient} border border-white/10 hover:border-white/20 transition-all duration-300`}>
                  {/* 步骤数字 */}
                  <div className="absolute -top-6 -left-2 text-9xl font-bold text-white/[0.03] select-none">{item.step}</div>

                  <div className="relative z-10">
                    <div className={`w-16 h-16 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                      <item.icon className={`h-8 w-8 ${item.color}`} />
                    </div>
                    <div className={`text-sm font-mono ${item.color} mb-2`}>STEP {item.step}</div>
                    <h3 className="text-2xl font-bold text-white mb-3">{item.title}</h3>
                    <p className="text-gray-400 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 用户评价 */}
      <section className="relative z-10 py-28">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center mb-20">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-6">
              <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
              <span className="text-sm text-gray-400">用户好评</span>
            </div>
            <h2 className="text-4xl md:text-6xl font-bold mb-6 text-white">
              用户 <span className="bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent">好评如潮</span>
            </h2>
            <p className="text-gray-400 text-lg md:text-xl">来自真实用户的使用反馈</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((item, index) => (
              <Card key={index} className="bg-white/[0.02] border-white/10 hover:border-white/20 transition-all duration-300 hover:-translate-y-1 group">
                <CardContent className="p-8">
                  <div className="flex gap-1 mb-6">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-gray-300 mb-8 leading-relaxed text-lg">&ldquo;{item.content}&rdquo;</p>
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full bg-gradient-to-r ${item.gradient} flex items-center justify-center text-white font-bold text-lg shadow-lg`}>
                      {item.avatar}
                    </div>
                    <div>
                      <div className="text-white font-semibold">{item.author}</div>
                      <div className="text-gray-500 text-sm">{item.role}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA - 增强版 */}
      <section className="relative z-10 py-28">
        <div className="container max-w-5xl mx-auto px-6">
          <div className="relative p-12 md:p-16 rounded-[2.5rem] overflow-hidden">
            {/* 背景 */}
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-pink-500/20" />
            <div className="absolute inset-0 backdrop-blur-xl" />
            <div className="absolute inset-[1px] rounded-[2.5rem] bg-[#0a0a0f]/80" />

            {/* 装饰光晕 */}
            <div className="absolute -top-20 -right-20 w-60 h-60 bg-pink-500/30 rounded-full blur-3xl" />
            <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-cyan-500/30 rounded-full blur-3xl" />

            <div className="relative text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/10 mb-8">
                <Rocket className="h-4 w-4 text-pink-400" />
                <span className="text-sm text-gray-300">立即开始</span>
              </div>
              <h2 className="text-3xl md:text-5xl font-bold text-white mb-6">
                准备好开始您的 AI 创作之旅了吗？
              </h2>
              <p className="text-gray-400 text-lg md:text-xl mb-10 max-w-2xl mx-auto">
                立即注册，获得 <span className="text-white font-semibold">免费体验积分</span>，感受 AI 创作的魅力
              </p>
              <Link href="/auth/register">
                <Button size="lg" className="h-16 px-12 text-lg bg-gradient-to-r from-cyan-500 to-pink-500 hover:opacity-90 text-white border-0 shadow-2xl shadow-purple-500/30 hover:shadow-purple-500/50 transition-all hover:scale-105">
                  立即开始免费试用
                  <ArrowRight className="h-5 w-5 ml-3" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 页脚 - 优化版 */}
      <footer className="relative z-10 border-t border-white/5 py-16 bg-black/50 backdrop-blur-sm">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-5 gap-8 mb-12">
            <div className="md:col-span-2">
              <Link href="/" className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div>
                  <span className="text-xl font-bold text-white">Tok Factory</span>
                  <p className="text-xs text-gray-500">AI 内容智造工厂</p>
                </div>
              </Link>
              <p className="text-gray-500 text-sm leading-relaxed max-w-xs">
                AI 驱动的短视频创作平台，让每一个创作者都能高效产出专业级内容。支持一键发布到 TikTok 等各大平台。
              </p>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-5">产品功能</h4>
              <ul className="space-y-3 text-sm text-gray-500">
                <li><Link href="/quick-gen" className="hover:text-white transition-colors">快速视频生成</Link></li>
                <li><Link href="/image-factory" className="hover:text-white transition-colors">电商图片工厂</Link></li>
                <li><Link href="/pro-studio/video-batch" className="hover:text-white transition-colors">批量视频制作</Link></li>
                <li><Link href="/models" className="hover:text-white transition-colors">AI 模特管理</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-5">支持</h4>
              <ul className="space-y-3 text-sm text-gray-500">
                <li><Link href="/help" className="hover:text-white transition-colors">帮助中心</Link></li>
                <li><Link href="/contact" className="hover:text-white transition-colors">联系我们</Link></li>
                <li><Link href="/feedback" className="hover:text-white transition-colors">反馈建议</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-5">法律</h4>
              <ul className="space-y-3 text-sm text-gray-500">
                <li><Link href="/terms" className="hover:text-white transition-colors">服务条款</Link></li>
                <li><Link href="/privacy" className="hover:text-white transition-colors">隐私政策</Link></li>
                <li><Link href="/legal" className="hover:text-white transition-colors">法律声明</Link></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-gray-500 text-sm">
              © {new Date().getFullYear()} 武汉观星文化传媒有限公司 版权所有
            </div>
            <div className="flex items-center gap-6 text-gray-500 text-sm">
              <Link href="https://beian.miit.gov.cn/" target="_blank" className="hover:text-white transition-colors flex items-center gap-1.5">
                <Shield className="h-4 w-4" />
                鄂ICP备2024072250号-2
              </Link>
            </div>
          </div>
        </div>
      </footer>

      {/* CSS 动画 */}
      <style jsx global>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient {
          animation: gradient 6s ease infinite;
        }
      `}</style>
    </div>
  );
}
