"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield, Globe } from "lucide-react";
import { useState } from "react";

export default function TermsPage() {
  const [lang, setLang] = useState<"en" | "zh">("en");

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* 背景装饰 */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-pink-500/5 rounded-full blur-[120px]" />
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
                ToryX
              </span>
            </Link>
            <div className="flex items-center gap-4">
              {/* 语言切换 */}
              <div className="flex items-center gap-2 bg-white/10 rounded-lg p-1">
                <button
                  onClick={() => setLang("en")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${lang === "en" ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"
                    }`}
                >
                  <Globe className="h-4 w-4" />
                  English
                </button>
                <button
                  onClick={() => setLang("zh")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${lang === "zh" ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"
                    }`}
                >
                  中文
                </button>
              </div>
              <Link href="/">
                <Button variant="ghost" className="text-gray-300 hover:text-white">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  {lang === "en" ? "Back to Home" : "返回首页"}
                </Button>
              </Link>
            </div>
          </nav>
        </div>
      </header >

      {/* 内容 */}
      < main className="relative z-10 py-16" >
        <div className="container max-w-4xl mx-auto px-6">
          {lang === "en" ? <EnglishContent /> : <ChineseContent />}
        </div>
      </main >

      {/* 页脚 */}
      < footer className="relative z-10 border-t border-white/5 py-8 bg-black/30" >
        <div className="container max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-gray-500 text-sm">
              © {new Date().getFullYear()} Wuhan Guanxing Cultural Media Co., Ltd. All Rights Reserved.
            </div>
            <div className="flex items-center gap-6 text-gray-500 text-sm">
              <Link href="/terms" className="hover:text-white transition-colors">
                {lang === "en" ? "Terms of Service" : "服务条款"}
              </Link>
              <Link href="/privacy" className="hover:text-white transition-colors">
                {lang === "en" ? "Privacy Policy" : "隐私政策"}
              </Link>
              <Link href="https://beian.miit.gov.cn/" target="_blank" className="hover:text-white transition-colors flex items-center gap-1">
                <Shield className="h-4 w-4" />
                鄂ICP备2023007484号
              </Link>
            </div>
          </div>
        </div>
      </footer >
    </div >
  );
}

function EnglishContent() {
  return (
    <>
      <div className="mb-12">
        <h1 className="text-4xl font-bold mb-4">Terms of Service</h1>
        <p className="text-gray-400">Last Updated: January 22, 2026</p>
        <p className="text-gray-400 mt-2">Effective Date: January 22, 2026</p>
      </div>

      <div className="prose prose-invert prose-lg max-w-none">
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. Agreement to Terms</h2>
            <p className="leading-relaxed">
              Welcome to ToryX, operated by Wuhan Guanxing Cultural Media Co., Ltd. (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;).
              These Terms of Service (&quot;Terms&quot;) govern your access to and use of the ToryX platform at www.tokfactoryai.com,
              including our AI-powered content creation services and social media publishing features.
            </p>
            <p className="leading-relaxed mt-4">
              By accessing or using our services, you agree to be bound by these Terms. If you disagree with any part of these Terms,
              you may not access our services.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">2. Description of Services</h2>
            <p className="leading-relaxed">ToryX provides the following AI-powered services:</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>AI Video Generation:</strong> Create videos from images, text prompts, and templates using advanced AI models</li>
              <li><strong>AI Image Generation:</strong> Generate e-commerce product images, virtual try-on images, and marketing visuals</li>
              <li><strong>Digital Model Services:</strong> Access to AI-generated digital human models for content creation</li>
              <li><strong>Batch Processing:</strong> Create multiple pieces of content efficiently through our batch production pipeline</li>
              <li><strong>Social Media Publishing:</strong> Publish generated content directly to connected TikTok accounts</li>
              <li><strong>Asset Management:</strong> Store, organize, and manage your generated content</li>
            </ul>
          </section>

          <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-cyan-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
              </svg>
              3. TikTok Integration Terms
            </h2>
            <p className="leading-relaxed text-white/90">
              <strong>IMPORTANT:</strong> Our platform integrates with TikTok&apos;s Content Posting API. By using this feature, you agree to the following additional terms:
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.1 TikTok Account Connection</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>You may connect your TikTok account(s) to ToryX to enable video publishing</li>
              <li>By connecting your account, you authorize us to publish content on your behalf</li>
              <li>You remain fully responsible for all content published to your TikTok account through our platform</li>
              <li>You must comply with TikTok&apos;s Terms of Service and Community Guidelines</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.2 Content Publishing Responsibility</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>You are solely responsible for ensuring published content complies with TikTok&apos;s policies</li>
              <li>We do not guarantee that published content will remain on TikTok (TikTok may remove content)</li>
              <li>Any violations of TikTok&apos;s policies are your responsibility, not ours</li>
              <li>We are not liable for any account restrictions or bans imposed by TikTok</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.3 API Limitations</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Service availability depends on TikTok API functionality; we are not liable for API outages</li>
              <li>TikTok may modify or discontinue API features at any time without notice to us</li>
              <li>We reserve the right to adjust our TikTok integration features accordingly</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.4 Disconnecting Your Account</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>You may disconnect your TikTok account at any time through our Account Management page</li>
              <li>Disconnection stops all future publishing but does not remove already published content</li>
              <li>You can also revoke access through TikTok&apos;s app settings</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">4. Account Registration</h2>
            <p className="leading-relaxed">4.1 To use our services, you must create an account by providing accurate and complete information.</p>
            <p className="leading-relaxed mt-4">4.2 You are responsible for maintaining the confidentiality of your account credentials and for all activities under your account.</p>
            <p className="leading-relaxed mt-4">4.3 You must be at least 18 years old to create an account and use our services.</p>
            <p className="leading-relaxed mt-4">4.4 You may not transfer, sell, or share your account with third parties.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">5. Credits and Payment</h2>
            <p className="leading-relaxed">5.1 ToryX operates on a credit-based system. You purchase credits to use our AI generation services.</p>
            <p className="leading-relaxed mt-4">5.2 Credit prices and consumption rates for each service are displayed on our platform and are subject to change with prior notice.</p>
            <p className="leading-relaxed mt-4">5.3 All credit purchases are final. Refunds are only provided as required by applicable law or at our sole discretion.</p>
            <p className="leading-relaxed mt-4">5.4 Credits expire one year from the date of purchase unless otherwise stated.</p>
            <p className="leading-relaxed mt-4">5.5 We reserve the right to modify pricing with 30 days&apos; advance notice.</p>
          </section>

          <section className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">6. Acceptable Use Policy</h2>
            <p className="leading-relaxed">You agree NOT to use our services to:</p>
            <ol className="list-decimal pl-6 space-y-2 mt-4">
              <li>Create, upload, or distribute content that violates any laws or regulations</li>
              <li>Publish content that endangers national security or discloses state secrets</li>
              <li>Create content that undermines national unity or sovereignty</li>
              <li>Damage national honor and interests</li>
              <li>Incite ethnic hatred or discrimination, or undermine national unity</li>
              <li>Undermine national religious policies or promote cults</li>
              <li>Spread rumors or disrupt social order and stability</li>
              <li>Create pornographic, sexually explicit, or violent content</li>
              <li>Publish content that insults, defames, or infringes upon the rights of others</li>
              <li>Infringe upon intellectual property rights, portrait rights, or privacy rights of others</li>
              <li>Create any other content that violates public morals or social ethics</li>
            </ol>
            <p className="leading-relaxed mt-4 text-white font-medium">
              Violation of these terms may result in immediate account termination without refund.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">7. Intellectual Property</h2>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">7.1 Our Intellectual Property</h3>
            <p className="leading-relaxed">
              All technology, software, algorithms, trademarks, logos, and platform design are owned by Wuhan Guanxing Cultural Media Co., Ltd.
              You may not copy, modify, or distribute any part of our platform without written permission.
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">7.2 Your Content</h3>
            <p className="leading-relaxed">
              You retain ownership of content you create through our platform. By using our services, you grant us a limited license to
              process, store, and display your content as necessary to provide our services.
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">7.3 Content License Grant</h3>
            <p className="leading-relaxed">
              For content you publicly post through our platform, you grant us a non-exclusive, royalty-free, worldwide license to:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Display and distribute within the platform</li>
              <li>Use for platform promotion and marketing</li>
              <li>Analyze for service improvement</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">7.4 Uploaded Materials</h3>
            <p className="leading-relaxed">
              You represent and warrant that you have all necessary rights to any materials you upload. You are solely responsible for
              any claims arising from your uploaded content.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">8. AI-Generated Content Disclaimer</h2>
            <p className="leading-relaxed">8.1 Our services use artificial intelligence to generate content. AI-generated content may not always be accurate, appropriate, or suitable for your intended purpose.</p>
            <p className="leading-relaxed mt-4">8.2 You are responsible for reviewing all generated content before use or publication.</p>
            <p className="leading-relaxed mt-4">8.3 We do not guarantee any specific results or outcomes from our AI services.</p>
            <p className="leading-relaxed mt-4">8.4 AI model performance may vary and is subject to continuous improvement and modification.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">9. Limitation of Liability</h2>
            <p className="leading-relaxed">
              TO THE MAXIMUM EXTENT PERMITTED BY LAW:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li>Our services are provided &quot;AS IS&quot; without warranties of any kind</li>
              <li>We are not liable for any indirect, incidental, special, or consequential damages</li>
              <li>Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim</li>
              <li>We are not responsible for third-party actions, including TikTok&apos;s moderation decisions</li>
              <li>We are not liable for service interruptions due to factors beyond our control</li>
              <li>We are not liable for damages caused by third-party API changes (including TikTok API)</li>
              <li>We are not liable for force majeure events including network outages, hacker attacks, or natural disasters</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">10. Indemnification</h2>
            <p className="leading-relaxed">
              You agree to indemnify and hold harmless Wuhan Guanxing Cultural Media Co., Ltd. and its officers, directors, employees,
              and agents from any claims, damages, losses, or expenses (including legal fees) arising from:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li>Your use of our services</li>
              <li>Your violation of these Terms</li>
              <li>Content you create, upload, or publish through our platform</li>
              <li>Your violation of any third-party rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">11. Service Modifications and Termination</h2>
            <p className="leading-relaxed">11.1 We reserve the right to modify, suspend, or discontinue any part of our services at any time with reasonable notice.</p>
            <p className="leading-relaxed mt-4">11.2 We may terminate your account if you violate these Terms, with or without notice.</p>
            <p className="leading-relaxed mt-4">11.3 Upon termination, your right to use our services ceases immediately. Unused credits may be forfeited.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">12. Governing Law and Dispute Resolution</h2>
            <p className="leading-relaxed">12.1 These Terms are governed by the laws of the People&apos;s Republic of China.</p>
            <p className="leading-relaxed mt-4">12.2 Any disputes shall first be resolved through good-faith negotiation.</p>
            <p className="leading-relaxed mt-4">12.3 If negotiation fails, disputes shall be submitted to the competent court in Wuhan, Hubei Province, China.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">13. Changes to Terms</h2>
            <p className="leading-relaxed">
              We may update these Terms from time to time. We will notify you of material changes via email or prominent notice on our platform.
              Continued use of our services after changes constitutes acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">14. Contact Information</h2>
            <p className="leading-relaxed">
              For questions about these Terms, please contact us:
            </p>
            <div className="mt-4 p-4 bg-white/5 rounded-lg">
              <p><strong>武汉观星文化传媒有限公司</strong></p>
              <p className="mt-1">Wuhan Guanxing Cultural Media Co., Ltd.</p>
              <p className="mt-2">Email: contact@toryx.ai</p>
              <p>Website: www.tokfactoryai.com</p>
              <p>Address: Wuhan, Hubei Province, China</p>
              <p className="mt-2 text-gray-400">ICP License: 鄂ICP备2023007484号</p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ChineseContent() {
  return (
    <>
      <div className="mb-12">
        <h1 className="text-4xl font-bold mb-4">服务条款</h1>
        <p className="text-gray-400">最后更新日期：2026年1月22日</p>
        <p className="text-gray-400 mt-2">生效日期：2026年1月22日</p>
      </div>

      <div className="prose prose-invert prose-lg max-w-none">
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">一、条款接受</h2>
            <p className="leading-relaxed">
              “ToryX”软件及相关服务，系指<strong>武汉观星文化传媒有限公司</strong>及其关联方（以下简称“公司”、“我们”或“我们的”）合法拥有并运营的、标注名称为 ToryX (AI 内容智造工厂) 的客户端应用程序、官方网站以及供第三方网站和应用程序使用的软件开发工具包（SDK）和应用程序编程接口（API）。
            </p>
            <p className="leading-relaxed mt-4">
              本协议是您与公司之间关于您下载、安装、使用、复制“ToryX”软件，及使用“ToryX”相关服务所订立的协议。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">二、服务内容</h2>
            <p className="leading-relaxed">ToryX 提供以下 AI 驱动的服务：</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>AI 视频生成：</strong>使用先进的 AI 模型从图片、文字提示和模板创建视频</li>
              <li><strong>AI 图片生成：</strong>生成电商产品图、虚拟试穿图和营销视觉素材</li>
              <li><strong>数字人模特服务：</strong>获取用于内容创作的 AI 生成数字人模特</li>
              <li><strong>批量处理：</strong>通过批量生产流水线高效创建多个内容</li>
              <li><strong>社交媒体发布：</strong>将生成的内容直接发布到已连接的 TikTok 账号</li>
              <li><strong>资产管理：</strong>存储、组织和管理您生成的内容</li>
            </ul>
          </section>

          <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-cyan-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
              </svg>
              三、TikTok 集成条款
            </h2>
            <p className="leading-relaxed text-white/90">
              <strong>重要提示：</strong>我们的平台集成了 TikTok 的 Content Posting API。使用此功能即表示您同意以下附加条款：
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.1 TikTok 账号连接</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>您可以将 TikTok 账号连接到 ToryX 以启用视频发布功能</li>
              <li>连接账号即表示您授权我们代您发布内容</li>
              <li>您对通过我们平台发布到 TikTok 账号的所有内容承担全部责任</li>
              <li>您必须遵守 TikTok 的服务条款和社区准则</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.2 内容发布责任</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>您独自负责确保发布的内容符合 TikTok 的政策</li>
              <li>我们不保证发布的内容会保留在 TikTok 上（TikTok 可能会删除内容）</li>
              <li>任何违反 TikTok 政策的行为由您负责，与我们无关</li>
              <li>我们不对 TikTok 施加的任何账号限制或封禁承担责任</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.3 API 限制说明</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>服务可用性取决于 TikTok API 功能；我们不对 API 中断负责</li>
              <li>TikTok 可能随时修改或停止 API 功能，无需提前通知我们</li>
              <li>我们保留相应调整 TikTok 集成功能的权利</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.4 断开账号连接</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>您可以随时通过账号管理页面断开 TikTok 账号连接</li>
              <li>断开连接将停止所有未来的发布，但不会删除已发布的内容</li>
              <li>您也可以通过 TikTok 应用的设置撤销访问权限</li>
            </ul>
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-sm text-gray-400">相关链接：</p>
              <ul className="list-disc pl-6 space-y-1 mt-2 text-sm">
                <li><a href="https://www.tiktok.com/legal/page/row/terms-of-service/en" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">TikTok 服务条款</a></li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">四、账户注册</h2>
            <p className="leading-relaxed">4.1 使用我们的服务需要创建账户，并提供准确完整的信息。</p>
            <p className="leading-relaxed mt-4">4.2 您负责保护账户凭据的机密性，并对账户下的所有活动负责。</p>
            <p className="leading-relaxed mt-4">4.3 您必须年满 18 周岁才能创建账户并使用我们的服务。</p>
            <p className="leading-relaxed mt-4">4.4 您不得将账户转让、出售或与第三方共享。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">五、积分与付费</h2>
            <p className="leading-relaxed">5.1 ToryX 采用积分制。您购买积分来使用我们的 AI 生成服务。</p>
            <p className="leading-relaxed mt-4">5.2 每项服务的积分价格和消耗量在平台上显示，可能会在提前通知后进行调整。</p>
            <p className="leading-relaxed mt-4">5.3 所有积分购买均为最终销售。仅在适用法律要求或我们自行决定的情况下提供退款。</p>
            <p className="leading-relaxed mt-4">5.4 积分自购买之日起一年内有效，除非另有说明。</p>
            <p className="leading-relaxed mt-4">5.5 我们保留在提前 30 天通知后修改定价的权利。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">六、订阅服务</h2>
            <p className="leading-relaxed">6.1 <strong>订阅升级和降级：</strong>从一种付费计划更改为另一种付费计划时，通过计算两个计划的剩余天数及其各自的每日费率，对新计划进行按比例分摊。</p>
            <p className="leading-relaxed mt-4">6.2 <strong>费用变更：</strong>我们可能会不时更改计划的费用，并将提前通知您。价格变更将在下一个订阅期开始时生效。如果您不同意价格变更，则必须在价格变更生效前取消订阅。</p>
            <p className="leading-relaxed mt-4">6.3 <strong>取消订阅：</strong>您可以随时取消订阅。取消后，您的订阅将在当前周期结束时失效。已支付的费用不予退还。</p>
          </section>

          <section className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">七、使用规范</h2>
            <p className="leading-relaxed">您同意不使用我们的服务：</p>
            <ol className="list-decimal pl-6 space-y-2 mt-4">
              <li>创建、上传或传播违反国家法律法规的内容</li>
              <li>发布危害国家安全、泄露国家秘密的内容</li>
              <li>颠覆国家政权、破坏国家统一的内容</li>
              <li>损害国家荣誉和利益的内容</li>
              <li>煽动民族仇恨、破坏民族团结的内容</li>
              <li>破坏国家宗教政策、宣扬邪教的内容</li>
              <li>散布谣言、扰乱社会秩序的内容</li>
              <li>淫秽、色情、暴力的内容</li>
              <li>侮辱、诽谤他人的内容</li>
              <li>侵犯他人知识产权、肖像权、隐私权的内容</li>
              <li>其他违反公序良俗的内容</li>
            </ol>
            <p className="leading-relaxed mt-4 text-white font-medium">
              违反上述规定可能导致账户立即封禁且不予退款。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">八、知识产权</h2>
            <h3 className="text-xl font-medium text-white mt-6 mb-3">8.1 我们的知识产权</h3>
            <p className="leading-relaxed">
              所有技术、软件、算法、商标、标识和平台设计均归武汉观星文化传媒有限公司所有。
              未经书面许可，您不得复制、修改或分发我们平台的任何部分。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">8.2 您的内容</h3>
            <p className="leading-relaxed">
              您通过我们平台创建的内容归您所有。使用我们的服务即表示您授予我们有限的许可，
              以处理、存储和显示您的内容，以便提供我们的服务。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">8.3 内容授权许可</h3>
            <p className="leading-relaxed">
              对于您通过本平台公开发布的内容，您授予我们非排他的、免费的、全球范围内的使用许可，用于：
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>在平台内展示和分发</li>
              <li>用于平台宣传和推广</li>
              <li>用于服务分析和改进</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">8.4 上传素材</h3>
            <p className="leading-relaxed">
              您声明并保证您拥有上传的任何素材的所有必要权利。您对因上传内容引起的任何索赔承担全部责任。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">九、AI 生成内容免责声明</h2>
            <p className="leading-relaxed">9.1 我们的服务使用人工智能生成内容。AI 生成的内容可能并不总是准确、适当或适合您的预期目的。</p>
            <p className="leading-relaxed mt-4">9.2 您负责在使用或发布之前审核所有生成的内容。</p>
            <p className="leading-relaxed mt-4">9.3 我们不保证 AI 服务会产生任何特定结果或成果。</p>
            <p className="leading-relaxed mt-4">9.4 AI 模型的性能可能会有所不同，并会持续改进和修改。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十、税务</h2>
            <p className="leading-relaxed">
              10.1 您在 ToryX 软件及相关服务中的收入（如有）将直接以现金或等值形式提现。
            </p>
            <p className="leading-relaxed mt-4">
              10.2 您理解并同意，公司有权为您代扣代缴税金，并依据国家法律法规之规定向税务机关申报缴纳。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十一、责任限制</h2>
            <p className="leading-relaxed">
              在法律允许的最大范围内：
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li>我们的服务按&ldquo;现状&rdquo;提供，不提供任何形式的保证</li>
              <li>我们不对任何间接、附带、特殊或后果性损害承担责任</li>
              <li>我们的总责任不超过您在索赔前 12 个月内向我们支付的金额</li>
              <li>我们不对第三方行为负责，包括 TikTok 的审核决定</li>
              <li>我们不对超出我们控制范围的因素导致的服务中断负责</li>
              <li>由于第三方 API（如 TikTok API）变更导致的服务调整，我们不承担责任</li>
              <li>由于网络环境、黑客攻击、自然灾害等不可抗力导致的损失，我们不承担责任</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十二、赔偿</h2>
            <p className="leading-relaxed">
              您同意赔偿并使武汉观星文化传媒有限公司及其管理人员、董事、员工和代理人免受因以下原因引起的任何索赔、损害、损失或费用（包括法律费用）：
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li>您使用我们的服务</li>
              <li>您违反本条款</li>
              <li>您通过我们平台创建、上传或发布的内容</li>
              <li>您侵犯任何第三方权利</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十三、服务变更与终止</h2>
            <p className="leading-relaxed">13.1 我们保留随时修改、暂停或终止我们服务任何部分的权利，并会合理通知。</p>
            <p className="leading-relaxed mt-4">13.2 如您违反本条款，我们可以终止您的账户，无论是否通知。</p>
            <p className="leading-relaxed mt-4">13.3 终止后，您使用我们服务的权利立即停止。未使用的积分可能被没收。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十四、适用法律与争议解决</h2>
            <p className="leading-relaxed">14.1 本条款受中华人民共和国法律管辖。</p>
            <p className="leading-relaxed mt-4">14.2 任何争议应首先通过善意协商解决。</p>
            <p className="leading-relaxed mt-4">14.3 如协商失败，争议应提交至中国湖北省武汉市有管辖权的法院。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十五、条款变更</h2>
            <p className="leading-relaxed">
              我们可能会不时更新本条款。对于重大变更，我们将通过电子邮件或在平台上显著通知您。
              变更后继续使用我们的服务即表示接受新条款。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十六、联系方式</h2>
            <p className="leading-relaxed">
              如对本条款有任何疑问，请联系我们：
            </p>
            <div className="mt-4 p-4 bg-white/5 rounded-lg">
              <p><strong>武汉观星文化传媒有限公司</strong></p>
              <p className="mt-1">Wuhan Guanxing Cultural Media Co., Ltd.</p>
              <p className="mt-2">邮箱：contact@toryx.ai</p>
              <p>网站：www.tokfactoryai.com</p>
              <p>地址：中国湖北省武汉市</p>
              <p className="mt-2 text-gray-400">ICP备案号：鄂ICP备2023007484号</p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
