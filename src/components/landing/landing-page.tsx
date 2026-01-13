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
} from "lucide-react";

const features = [
  {
    icon: Video,
    title: "AI 视频生成",
    description: "基于 Sora2、VEO3 等顶级 AI 模型，将图片或文字转化为高质量短视频",
    gradient: "from-cyan-500 to-blue-500",
  },
  {
    icon: ImageIcon,
    title: "电商图片工厂",
    description: "一键生成商品展示图、模特换装图，支持批量处理，提升电商运营效率",
    gradient: "from-pink-500 to-rose-500",
  },
  {
    icon: Sparkles,
    title: "AI 数字人模特",
    description: "签约专属 AI 模特，注入品牌基因，打造独特视觉风格",
    gradient: "from-purple-500 to-violet-500",
  },
  {
    icon: Layers,
    title: "批量视频制作",
    description: "专业工作室支持批量创建任务，一次提交多个视频，自动队列处理",
    gradient: "from-amber-500 to-orange-500",
  },
  {
    icon: Globe,
    title: "链接一键成片",
    description: "输入商品链接，自动提取信息生成营销视频脚本，智能配图成片",
    gradient: "from-emerald-500 to-teal-500",
  },
  {
    icon: Users,
    title: "团队协作",
    description: "支持多人团队管理，积分共享，任务分配，高效协同创作",
    gradient: "from-indigo-500 to-blue-500",
  },
];

const stats = [
  { value: "50万+", label: "累计生成视频" },
  { value: "10万+", label: "活跃创作者" },
  { value: "99.9%", label: "服务可用性" },
  { value: "5秒", label: "平均响应时间" },
];

const testimonials = [
  {
    content: "使用这个平台后，我们的短视频产出效率提升了 10 倍，电商转化率显著提高。",
    author: "张经理",
    role: "某电商品牌运营总监",
    avatar: "Z",
  },
  {
    content: "AI 模特功能太惊艳了，再也不用花大价钱请真人模特拍摄，效果一样出色。",
    author: "李女士",
    role: "独立电商卖家",
    avatar: "L",
  },
  {
    content: "批量生成功能节省了大量时间，一个人就能完成整个团队的工作量。",
    author: "王先生",
    role: "MCN 机构创始人",
    avatar: "W",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-hidden">
      {/* 背景装饰 */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-pink-500/10 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-purple-500/5 rounded-full blur-[150px]" />
      </div>

      {/* 导航栏 */}
      <header className="relative z-50 border-b border-white/5 backdrop-blur-xl bg-black/20">
        <div className="container max-w-7xl mx-auto px-6 py-4">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-purple-500 to-pink-500 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent">
                TikTok AI MCN
              </span>
            </Link>

            <div className="hidden md:flex items-center gap-8">
              <Link href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">
                功能特色
              </Link>
              <Link href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">
                定价方案
              </Link>
              <Link href="/terms" className="text-sm text-gray-400 hover:text-white transition-colors">
                服务条款
              </Link>
              <Link href="/privacy" className="text-sm text-gray-400 hover:text-white transition-colors">
                隐私政策
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <Link href="/auth/login">
                <Button variant="ghost" className="text-gray-300 hover:text-white hover:bg-white/10">
                  登录
                </Button>
              </Link>
              <Link href="/auth/register">
                <Button className="bg-gradient-to-r from-cyan-500 to-pink-500 hover:opacity-90 text-white border-0">
                  免费注册
                </Button>
              </Link>
            </div>
          </nav>
        </div>
      </header>

      {/* Hero 区域 */}
      <section className="relative z-10 pt-20 pb-32">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center max-w-4xl mx-auto">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8">
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-sm text-gray-300">全新升级，支持 Sora2 & VEO3 模型</span>
            </div>

            <h1 className="text-5xl md:text-7xl font-bold leading-tight mb-6">
              <span className="bg-gradient-to-r from-cyan-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                AI 驱动的
              </span>
              <br />
              <span className="text-white">短视频创作平台</span>
            </h1>

            <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
              一站式 AI 内容创作解决方案，从图片生成、视频制作到数字人模特，
              <br className="hidden md:block" />
              让每一个创作者都能高效产出专业级短视频内容
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/auth/register">
                <Button size="lg" className="h-14 px-8 text-lg bg-gradient-to-r from-cyan-500 to-pink-500 hover:opacity-90 text-white border-0 shadow-lg shadow-purple-500/25">
                  <Play className="h-5 w-5 mr-2" />
                  开始创作
                </Button>
              </Link>
              <Link href="#features">
                <Button size="lg" variant="outline" className="h-14 px-8 text-lg border-white/20 text-white hover:bg-white/10">
                  了解更多
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
            </div>
          </div>

          {/* 统计数据 */}
          <div className="mt-20 grid grid-cols-2 md:grid-cols-4 gap-8">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent mb-2">
                  {stat.value}
                </div>
                <div className="text-gray-500">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 功能特色 */}
      <section id="features" className="relative z-10 py-24 bg-gradient-to-b from-transparent to-black/30">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              <span className="text-white">强大的</span>
              <span className="bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent"> AI 创作工具</span>
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              集成最先进的 AI 技术，为您提供全方位的内容创作能力
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card 
                key={index} 
                className="bg-white/5 border-white/10 hover:border-white/20 transition-all duration-300 hover:-translate-y-1 group"
              >
                <CardContent className="p-6">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-r ${feature.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <feature.icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">{feature.title}</h3>
                  <p className="text-gray-400 leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* 工作流程 */}
      <section className="relative z-10 py-24">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-white">
              简单 <span className="bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent">三步</span> 完成创作
            </h2>
            <p className="text-gray-400 text-lg">无需专业技能，人人都能轻松上手</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: "01", title: "上传素材", desc: "上传图片或输入商品链接，AI 自动分析内容" },
              { step: "02", title: "AI 生成", desc: "选择模型和风格，一键生成专业级视频内容" },
              { step: "03", title: "下载发布", desc: "批量下载成品，直接发布到各大平台" },
            ].map((item, index) => (
              <div key={index} className="relative">
                <div className="text-8xl font-bold text-white/5 absolute -top-4 left-0">{item.step}</div>
                <div className="relative z-10 pt-8">
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-r from-cyan-500/20 to-pink-500/20 border border-white/10 flex items-center justify-center mb-4">
                    {index === 0 && <Wand2 className="h-7 w-7 text-cyan-400" />}
                    {index === 1 && <Cpu className="h-7 w-7 text-purple-400" />}
                    {index === 2 && <CheckCircle className="h-7 w-7 text-pink-400" />}
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-gray-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 用户评价 */}
      <section className="relative z-10 py-24 bg-gradient-to-b from-transparent to-black/30">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-4 text-white">
              用户 <span className="bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent">好评如潮</span>
            </h2>
            <p className="text-gray-400 text-lg">来自真实用户的使用反馈</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((item, index) => (
              <Card key={index} className="bg-white/5 border-white/10">
                <CardContent className="p-6">
                  <div className="flex gap-1 mb-4">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} className="h-4 w-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-gray-300 mb-6 leading-relaxed">&ldquo;{item.content}&rdquo;</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-r from-cyan-500 to-pink-500 flex items-center justify-center text-white font-semibold">
                      {item.avatar}
                    </div>
                    <div>
                      <div className="text-white font-medium">{item.author}</div>
                      <div className="text-gray-500 text-sm">{item.role}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 py-24">
        <div className="container max-w-4xl mx-auto px-6 text-center">
          <div className="p-12 rounded-3xl bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 border border-white/10">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
              准备好开始您的 AI 创作之旅了吗？
            </h2>
            <p className="text-gray-400 text-lg mb-8">
              立即注册，获得免费体验积分，感受 AI 创作的魅力
            </p>
            <Link href="/auth/register">
              <Button size="lg" className="h-14 px-10 text-lg bg-gradient-to-r from-cyan-500 to-pink-500 hover:opacity-90 text-white border-0">
                立即开始免费试用
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* 页脚 */}
      <footer className="relative z-10 border-t border-white/5 py-12 bg-black/30">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <Link href="/" className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 via-purple-500 to-pink-500 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <span className="text-lg font-bold text-white">TikTok AI MCN</span>
              </Link>
              <p className="text-gray-500 text-sm leading-relaxed">
                AI 驱动的短视频创作平台，让每一个创作者都能高效产出专业级内容。
              </p>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4">产品功能</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><Link href="/quick-gen" className="hover:text-white transition-colors">快速视频生成</Link></li>
                <li><Link href="/image-factory" className="hover:text-white transition-colors">电商图片工厂</Link></li>
                <li><Link href="/pro-studio/video-batch" className="hover:text-white transition-colors">批量视频制作</Link></li>
                <li><Link href="/models" className="hover:text-white transition-colors">AI 模特管理</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4">支持</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><Link href="/help" className="hover:text-white transition-colors">帮助中心</Link></li>
                <li><Link href="/contact" className="hover:text-white transition-colors">联系我们</Link></li>
                <li><Link href="/feedback" className="hover:text-white transition-colors">反馈建议</Link></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4">法律</h4>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><Link href="/terms" className="hover:text-white transition-colors">服务条款</Link></li>
                <li><Link href="/privacy" className="hover:text-white transition-colors">隐私政策</Link></li>
                <li><Link href="/legal" className="hover:text-white transition-colors">法律声明</Link></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-white/5 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-gray-500 text-sm">
              © {new Date().getFullYear()} 【请填写公司名称】 版权所有
            </div>
            <div className="flex items-center gap-4 text-gray-500 text-sm">
              <Link href="https://beian.miit.gov.cn/" target="_blank" className="hover:text-white transition-colors flex items-center gap-1">
                <Shield className="h-4 w-4" />
                【请填写ICP备案号】
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
