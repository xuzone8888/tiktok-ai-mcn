"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield, Globe } from "lucide-react";
import { useState } from "react";

export default function PrivacyPage() {
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
                Tok Factory
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
      </header>

      {/* 内容 */}
      <main className="relative z-10 py-16">
        <div className="container max-w-4xl mx-auto px-6">
          {lang === "en" ? <EnglishContent /> : <ChineseContent />}
        </div>
      </main>

      {/* 页脚 */}
      <footer className="relative z-10 border-t border-white/5 py-8 bg-black/30">
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
                鄂ICP备2024072250号-2
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function EnglishContent() {
  return (
    <>
      <div className="mb-12">
        <h1 className="text-4xl font-bold mb-4">Privacy Policy</h1>
        <p className="text-gray-400">Last Updated: January 16, 2026</p>
        <p className="text-gray-400 mt-2">Effective Date: January 16, 2026</p>
      </div>

      <div className="prose prose-invert prose-lg max-w-none">
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. Introduction</h2>
            <p className="leading-relaxed">
              Wuhan Guanxing Cultural Media Co., Ltd. (&quot;Tok Factory&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the Tok Factory platform
              (www.tokfactoryai.com). This Privacy Policy explains how we collect, use, disclose, and safeguard your information
              when you use our AI-powered content creation services, including our integration with the TikTok platform.
            </p>
            <p className="leading-relaxed mt-4">
              By using Tok Factory, you agree to the collection and use of information in accordance with this Privacy Policy.
              If you do not agree with this policy, please do not use our services.
            </p>
          </section>

          <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-cyan-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
              </svg>
              2. TikTok Integration & Data Handling
            </h2>
            <p className="leading-relaxed text-white/90">
              <strong>IMPORTANT:</strong> Tok Factory integrates with TikTok&apos;s Content Posting API to enable you to publish
              AI-generated videos directly to your TikTok account. This section specifically covers how we handle your TikTok data.
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.1 TikTok Data We Collect</h3>
            <p className="leading-relaxed">When you connect your TikTok account, we collect:</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>TikTok User ID (Open ID):</strong> To identify your account and publish content on your behalf</li>
              <li><strong>Display Name & Avatar:</strong> To display your account information within our platform</li>
              <li><strong>Basic Profile Information:</strong> Follower count, following count, and video count for display purposes</li>
              <li><strong>OAuth Access Tokens:</strong> To authenticate API requests to TikTok (encrypted and stored securely)</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.2 How We Use Your TikTok Data</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Video Publishing:</strong> Upload and publish videos you create using our platform to your TikTok account</li>
              <li><strong>Account Display:</strong> Show your connected TikTok accounts within our dashboard</li>
              <li><strong>Publishing Status:</strong> Track the status of videos published to TikTok</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.3 TikTok Data We Do NOT Collect</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>We do NOT access your TikTok password</li>
              <li>We do NOT read your private messages or comments</li>
              <li>We do NOT access videos you did not create through our platform</li>
              <li>We do NOT share your TikTok data with third parties for advertising purposes</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.4 TikTok Data Retention & Deletion</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>OAuth tokens are stored only while your account is connected</li>
              <li>When you disconnect your TikTok account, we delete all associated tokens within 24 hours</li>
              <li>Publishing records are retained for 90 days for your reference, then automatically deleted</li>
              <li>You can request immediate deletion of all your TikTok-related data at any time</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.5 Revoking TikTok Access</h3>
            <p className="leading-relaxed">
              You can disconnect your TikTok account at any time through our Account Management page. Additionally,
              you can revoke Tok Factory&apos;s access directly from your TikTok app under Settings → Security → Manage App Permissions.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">3. Information We Collect</h2>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.1 Information You Provide</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Account Information:</strong> Email address, username, password (encrypted)</li>
              <li><strong>Profile Information:</strong> Display name, avatar, preferences</li>
              <li><strong>Content:</strong> Images, videos, and text you upload for AI processing</li>
              <li><strong>Payment Information:</strong> Processed securely through third-party payment processors</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.2 Automatically Collected Information</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Device Information:</strong> Browser type, operating system, device identifiers</li>
              <li><strong>Usage Data:</strong> Pages visited, features used, timestamps</li>
              <li><strong>Log Data:</strong> IP address, access times, error logs</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">4. How We Use Your Information</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide and maintain our AI content creation services</li>
              <li>Process your video and image generation requests</li>
              <li>Publish content to connected social media platforms (with your authorization)</li>
              <li>Send service notifications and updates</li>
              <li>Improve our services and develop new features</li>
              <li>Prevent fraud and ensure platform security</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">5. Information Sharing</h2>
            <p className="leading-relaxed">We do NOT sell your personal information. We may share information with:</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>Service Providers:</strong> Cloud hosting, payment processing, analytics (under strict confidentiality agreements)</li>
              <li><strong>Social Media Platforms:</strong> Only TikTok, only with your explicit authorization, only for publishing your content</li>
              <li><strong>Legal Requirements:</strong> When required by law or to protect our rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">6. Data Security</h2>
            <p className="leading-relaxed">We implement industry-standard security measures:</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li>SSL/TLS encryption for data in transit</li>
              <li>AES-256 encryption for sensitive data at rest</li>
              <li>Regular security audits and vulnerability assessments</li>
              <li>Access controls and employee training</li>
              <li>OAuth tokens are encrypted and never exposed in logs or UI</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">7. Your Rights</h2>
            <p className="leading-relaxed">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Correction:</strong> Update inaccurate information</li>
              <li><strong>Deletion:</strong> Request deletion of your data (&quot;right to be forgotten&quot;)</li>
              <li><strong>Portability:</strong> Receive your data in a machine-readable format</li>
              <li><strong>Withdraw Consent:</strong> Disconnect social media accounts at any time</li>
              <li><strong>Restriction:</strong> Limit how we process your data</li>
            </ul>
            <p className="leading-relaxed mt-4">
              To exercise these rights, contact us at privacy@tokfactoryai.com
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">8. Data Retention</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Account Data:</strong> Retained while your account is active, deleted within 30 days of account deletion</li>
              <li><strong>Generated Content:</strong> Stored for 90 days unless you delete it earlier</li>
              <li><strong>TikTok Tokens:</strong> Deleted immediately upon disconnection</li>
              <li><strong>Log Data:</strong> Retained for 12 months for security purposes</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">9. Children&apos;s Privacy</h2>
            <p className="leading-relaxed">
              Tok Factory is not intended for users under 18 years of age. We do not knowingly collect personal
              information from children. If we discover that a child under 18 has provided us with personal information,
              we will delete it immediately.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">10. International Data Transfers</h2>
            <p className="leading-relaxed">
              Our servers are located in the People&apos;s Republic of China. If you access our services from outside China,
              your data may be transferred to and processed in China. We ensure appropriate safeguards are in place for
              international data transfers.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">11. Changes to This Policy</h2>
            <p className="leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of significant changes via email
              or prominent notice on our platform. Your continued use of our services after such modifications constitutes
              your acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">12. Contact Us</h2>
            <p className="leading-relaxed">
              If you have any questions about this Privacy Policy or our data practices, please contact us:
            </p>
            <div className="mt-4 p-4 bg-white/5 rounded-lg">
              <p><strong>Wuhan Guanxing Cultural Media Co., Ltd.</strong></p>
              <p className="mt-2">Email: privacy@tokfactoryai.com</p>
              <p>Website: www.tokfactoryai.com</p>
              <p>Address: Wuhan, Hubei Province, China</p>
            </div>
            <p className="leading-relaxed mt-4">
              We will respond to your inquiry within 15 business days.
            </p>
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
        <h1 className="text-4xl font-bold mb-4">隐私政策</h1>
        <p className="text-gray-400">最后更新日期：2026年1月16日</p>
        <p className="text-gray-400 mt-2">生效日期：2026年1月16日</p>
      </div>

      <div className="prose prose-invert prose-lg max-w-none">
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">一、引言</h2>
            <p className="leading-relaxed">
              武汉观星文化传媒有限公司（以下简称&ldquo;Tok Factory&rdquo;、&ldquo;我们&rdquo;或&ldquo;本公司&rdquo;）运营 Tok Factory 平台
              (www.tokfactoryai.com)。本隐私政策旨在向您说明我们如何收集、使用、披露和保护您在使用我们的 AI 内容创作服务时的信息，
              包括我们与 TikTok 平台的集成。
            </p>
            <p className="leading-relaxed mt-4">
              使用 Tok Factory 即表示您同意按照本隐私政策收集和使用信息。如您不同意本政策，请勿使用我们的服务。
            </p>
          </section>

          <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-cyan-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
              </svg>
              二、TikTok 集成与数据处理
            </h2>
            <p className="leading-relaxed text-white/90">
              <strong>重要提示：</strong>Tok Factory 集成了 TikTok 的 Content Posting API，使您能够将 AI 生成的视频直接发布到您的 TikTok 账号。
              本节专门说明我们如何处理您的 TikTok 数据。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.1 我们收集的 TikTok 数据</h3>
            <p className="leading-relaxed">当您连接 TikTok 账号时，我们会收集：</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>TikTok 用户 ID (Open ID)：</strong>用于识别您的账号并代您发布内容</li>
              <li><strong>显示名称和头像：</strong>用于在我们的平台内显示您的账号信息</li>
              <li><strong>基本资料信息：</strong>粉丝数、关注数和视频数（仅用于显示）</li>
              <li><strong>OAuth 访问令牌：</strong>用于向 TikTok 发起 API 请求（加密安全存储）</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.2 我们如何使用您的 TikTok 数据</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>视频发布：</strong>将您通过我们平台创建的视频上传并发布到您的 TikTok 账号</li>
              <li><strong>账号展示：</strong>在我们的控制面板中显示您已连接的 TikTok 账号</li>
              <li><strong>发布状态追踪：</strong>追踪发布到 TikTok 的视频状态</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.3 我们不会收集的 TikTok 数据</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>我们不会获取您的 TikTok 密码</li>
              <li>我们不会读取您的私信或评论</li>
              <li>我们不会访问非通过我们平台创建的视频</li>
              <li>我们不会为广告目的与第三方共享您的 TikTok 数据</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.4 TikTok 数据保留与删除</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>OAuth 令牌仅在您的账号保持连接期间存储</li>
              <li>当您断开 TikTok 账号连接时，我们会在 24 小时内删除所有相关令牌</li>
              <li>发布记录保留 90 天供您参考，之后自动删除</li>
              <li>您可以随时请求立即删除所有与 TikTok 相关的数据</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.5 撤销 TikTok 访问权限</h3>
            <p className="leading-relaxed">
              您可以随时通过我们的账号管理页面断开 TikTok 账号连接。此外，您也可以直接在 TikTok 应用的
              设置 → 安全 → 管理应用权限 中撤销 Tok Factory 的访问权限。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">三、我们收集的信息</h2>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.1 您主动提供的信息</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>账户信息：</strong>邮箱地址、用户名、密码（加密存储）</li>
              <li><strong>个人资料：</strong>显示名称、头像、偏好设置</li>
              <li><strong>内容：</strong>您上传用于 AI 处理的图片、视频和文字</li>
              <li><strong>支付信息：</strong>通过第三方支付处理商安全处理</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">3.2 自动收集的信息</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>设备信息：</strong>浏览器类型、操作系统、设备标识符</li>
              <li><strong>使用数据：</strong>访问的页面、使用的功能、时间戳</li>
              <li><strong>日志数据：</strong>IP 地址、访问时间、错误日志</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">四、信息使用目的</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>提供和维护我们的 AI 内容创作服务</li>
              <li>处理您的视频和图片生成请求</li>
              <li>将内容发布到已连接的社交媒体平台（经您授权）</li>
              <li>发送服务通知和更新</li>
              <li>改进服务并开发新功能</li>
              <li>防止欺诈并确保平台安全</li>
              <li>遵守法律义务</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">五、信息共享</h2>
            <p className="leading-relaxed">我们不会出售您的个人信息。我们可能在以下情况下共享信息：</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>服务提供商：</strong>云托管、支付处理、分析服务（受严格保密协议约束）</li>
              <li><strong>社交媒体平台：</strong>仅限 TikTok，仅在您明确授权的情况下，仅用于发布您的内容</li>
              <li><strong>法律要求：</strong>根据法律要求或为保护我们的权利</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">六、数据安全</h2>
            <p className="leading-relaxed">我们采用行业标准的安全措施：</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li>传输中的数据采用 SSL/TLS 加密</li>
              <li>静态敏感数据采用 AES-256 加密</li>
              <li>定期进行安全审计和漏洞评估</li>
              <li>访问控制和员工培训</li>
              <li>OAuth 令牌加密存储，永不在日志或界面中暴露</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">七、您的权利</h2>
            <p className="leading-relaxed">您有权：</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>访问权：</strong>请求获取您个人数据的副本</li>
              <li><strong>更正权：</strong>更新不准确的信息</li>
              <li><strong>删除权：</strong>请求删除您的数据（&ldquo;被遗忘权&rdquo;）</li>
              <li><strong>可携带权：</strong>以机器可读格式接收您的数据</li>
              <li><strong>撤回同意：</strong>随时断开社交媒体账号连接</li>
              <li><strong>限制权：</strong>限制我们处理您数据的方式</li>
            </ul>
            <p className="leading-relaxed mt-4">
              如需行使这些权利，请通过 privacy@tokfactoryai.com 联系我们
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">八、数据保留</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>账户数据：</strong>在账户有效期间保留，账户删除后 30 天内删除</li>
              <li><strong>生成内容：</strong>存储 90 天，除非您提前删除</li>
              <li><strong>TikTok 令牌：</strong>断开连接后立即删除</li>
              <li><strong>日志数据：</strong>出于安全目的保留 12 个月</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">九、未成年人保护</h2>
            <p className="leading-relaxed">
              Tok Factory 不面向 18 岁以下用户。我们不会故意收集儿童的个人信息。如果我们发现 18 岁以下的儿童向我们提供了个人信息，
              我们将立即删除。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十、国际数据传输</h2>
            <p className="leading-relaxed">
              我们的服务器位于中华人民共和国境内。如果您从中国境外访问我们的服务，您的数据可能会被传输到中国并在中国处理。
              我们确保对国际数据传输采取适当的保障措施。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十一、政策变更</h2>
            <p className="leading-relaxed">
              我们可能会不时更新本隐私政策。对于重大变更，我们将通过电子邮件或在平台上显著通知您。
              在此类修改后继续使用我们的服务即表示您接受更新后的政策。
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">十二、联系我们</h2>
            <p className="leading-relaxed">
              如果您对本隐私政策或我们的数据处理有任何疑问，请联系我们：
            </p>
            <div className="mt-4 p-4 bg-white/5 rounded-lg">
              <p><strong>武汉观星文化传媒有限公司</strong></p>
              <p className="mt-2">邮箱：privacy@tokfactoryai.com</p>
              <p>网站：www.tokfactoryai.com</p>
              <p>地址：中国湖北省武汉市</p>
            </div>
            <p className="leading-relaxed mt-4">
              我们将在收到您的请求后 15 个工作日内予以回复。
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
