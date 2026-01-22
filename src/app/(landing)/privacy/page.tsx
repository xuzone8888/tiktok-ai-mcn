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
                鄂ICP备2023007484号
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
        <p className="text-gray-400">Last Updated: January 22, 2026</p>
        <p className="text-gray-400 mt-2">Effective Date: January 22, 2026</p>
      </div>

      <div className="prose prose-invert prose-lg max-w-none">
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. Introduction</h2>
            <p className="leading-relaxed">
              Wuhan Guanxing Cultural Media Co., Ltd. (&quot;ToryX&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the ToryX platform
              (www.tokfactoryai.com). This Privacy Policy explains how we collect, use, disclose, and safeguard your information
              when you use our AI-powered content creation services, including our integration with the TikTok platform.
            </p>
            <p className="leading-relaxed mt-4">
              By using ToryX, you agree to the collection and use of information in accordance with this Privacy Policy.
              If you do not agree with this policy, please do not use our services.
            </p>
          </section>

          <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-cyan-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
              </svg>
              2. TikTok Integration &amp; Data Handling
            </h2>
            <p className="leading-relaxed text-white/90">
              <strong>IMPORTANT:</strong> ToryX integrates with TikTok&apos;s Content Posting API to enable you to publish
              AI-generated videos directly to your TikTok account. This section specifically covers how we handle your TikTok data.
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.1 TikTok Data We Collect</h3>
            <p className="leading-relaxed">When you connect your TikTok account, we collect:</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>TikTok User ID (Open ID):</strong> To identify your account and publish content on your behalf</li>
              <li><strong>Display Name &amp; Avatar:</strong> To display your account information within our platform</li>
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

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.4 TikTok Data Retention &amp; Deletion</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>OAuth tokens are stored only while your account is connected</li>
              <li>When you disconnect your TikTok account, we delete all associated tokens within 24 hours</li>
              <li>Publishing records are retained for 90 days for your reference, then automatically deleted</li>
              <li>You can request immediate deletion of all your TikTok-related data at any time</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.5 Revoking TikTok Access</h3>
            <p className="leading-relaxed">
              You can disconnect your TikTok account at any time through our Account Management page. Additionally,
              you can revoke ToryX&apos;s access directly from your TikTok app under Settings → Security → Manage App Permissions.
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.6 TikTok Policy Links</h3>
            <p className="leading-relaxed">
              By using our TikTok publishing feature, you acknowledge that you have read and agree to TikTok&apos;s official policies:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li><a href="https://www.tiktok.com/legal/page/row/privacy-policy/en" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">TikTok Privacy Policy</a></li>
              <li><a href="https://www.tiktok.com/legal/page/row/terms-of-service/en" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">TikTok Terms of Service</a></li>
            </ul>
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
            <p className="leading-relaxed mt-4">
              <strong>Data Storage Location:</strong> Your data is stored on Alibaba Cloud servers within the People&apos;s Republic of China.
            </p>
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

          <section className="bg-white/5 border border-white/10 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">8. Account Deletion</h2>
            <p className="leading-relaxed">You have the right to delete your account at any time. The deletion process:</p>
            <ol className="list-decimal pl-6 space-y-2 mt-4">
              <li>Log in to your account, go to &quot;Settings&quot; → &quot;Account Security&quot; → &quot;Delete Account&quot;</li>
              <li>Verify your identity and submit the deletion request</li>
              <li>We will process the deletion within 15 business days</li>
              <li>After deletion, your personal data will be removed within 30 days</li>
            </ol>
            <p className="leading-relaxed mt-4 text-white/80">
              Note: Some data may be retained for legal compliance purposes (e.g., transaction records for 3 years as required by tax law).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">9. Data Retention</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Account Data:</strong> Retained while your account is active, deleted within 30 days of account deletion</li>
              <li><strong>Generated Content:</strong> Stored for 90 days unless you delete it earlier</li>
              <li><strong>TikTok Tokens:</strong> Deleted immediately upon disconnection</li>
              <li><strong>Log Data:</strong> Retained for 12 months for security purposes</li>
            </ul>
          </section>

          <section className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">10. Protection of Minors</h2>
            <p className="leading-relaxed">
              ToryX is not intended for users under 18 years of age. We do not knowingly collect personal
              information from children. If we discover that a child under 18 has provided us with personal information,
              we will delete it within 24 hours.
            </p>
            <p className="leading-relaxed mt-4">
              <strong>For Guardians:</strong> If you are the guardian of a minor and discover that they have used our services without consent,
              please contact us immediately at privacy@tokfactoryai.com. We will delete the account and associated data promptly.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">11. International Data Transfers</h2>
            <p className="leading-relaxed">
              Our servers are located in the People&apos;s Republic of China. If you access our services from outside China,
              your data may be transferred to and processed in China. We ensure appropriate safeguards are in place for
              international data transfers.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">12. Changes to This Policy</h2>
            <p className="leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of significant changes via email
              or prominent notice on our platform. Your continued use of our services after such modifications constitutes
              your acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">13. Contact Us</h2>
            <p className="leading-relaxed">
              If you have any questions about this Privacy Policy or our data practices, please contact us:
            </p>
            <div className="mt-4 p-4 bg-white/5 rounded-lg">
              <p><strong>武汉观星文化传媒有限公司</strong></p>
              <p className="mt-1">Wuhan Guanxing Cultural Media Co., Ltd.</p>
              <p className="mt-2">Email: contact@toryx.ai</p>
              <p>Website: www.tokfactoryai.com</p>
              <p>Address: Wuhan, Hubei Province, China</p>
              <p className="mt-2 text-gray-400">ICP License: 鄂ICP备2023007484号</p>
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
        <h1 className="text-4xl font-bold mb-4">&quot;ToryX&quot; 隐私政策</h1>
        <p className="text-gray-400">更新日期：2026年01月22日</p>
        <p className="text-gray-400 mt-2">生效日期：2026年01月22日</p>
      </div>

      <div className="prose prose-invert prose-lg max-w-none">
        <div className="space-y-8 text-gray-300">
          {/* 引言 */}
          <section>
            <p className="leading-relaxed">
              &quot;ToryX&quot;指<strong>武汉观星文化传媒有限公司</strong>及其关联方（以下简称&quot;我们&quot;）合法拥有并运营的、标注名称为 ToryX (AI 内容智造工厂) 的客户端应用程序、官方网站以及供第三方网站和应用程序使用的软件开发工具包（SDK）和应用程序编程接口（API）。
            </p>
            <p className="leading-relaxed mt-4">
              我们作为 ToryX 的运营者，深知个人信息对你的重要性，我们将按照法律法规的规定，保护你的个人信息及隐私安全。我们制定本隐私政策并特别提示：希望你在使用 ToryX 及相关服务前仔细阅读并理解本隐私政策，以便作出适当的选择。
            </p>
          </section>

          {/* 概要 */}
          <section className="bg-white/5 border border-white/10 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">概要</h2>
            <p className="leading-relaxed">
              我们将通过本隐私政策向你介绍不同场景下我们如何处理个人信息。当你开启或使用 ToryX 时，为实现你选择使用的功能、服务，或为遵守法律法规的要求，我们会处理相关信息。除实现 ToryX 基本功能、服务所需的信息，和根据法律法规要求所必需的信息之外，你可以拒绝我们处理其他信息，但这可能导致我们无法提供对应功能、服务。我们将在隐私政策中逐项说明相关情况，<strong>有关你个人信息权益的重要条款已用加粗形式提示，请特别关注。</strong>
            </p>
            <p className="leading-relaxed mt-4">
              ToryX 及相关版本之间的实际功能可能略有差异，但如关联版本无独立隐私政策，我们会遵循本隐私政策收集、处理你的个人信息。
            </p>
            <p className="leading-relaxed mt-4">
              除本隐私政策外，在特定场景下，我们还会通过即时告知（含弹窗、页面提示等）、功能更新说明等方式，向你说明对应的信息收集目的、范围及使用方式，这些即时告知及功能更新说明等构成本隐私政策的一部分，并与本隐私政策具有同等效力。
            </p>
            <p className="leading-relaxed mt-4">
              下文将帮你详细了解我们如何收集、使用、存储、传输、公开与保护个人信息；帮你了解查询、更正、补充、删除、复制、转移个人信息的方式。其中，<strong>有关你个人信息权益的重要内容已用加粗形式提示，请特别关注。</strong>
            </p>
          </section>

          {/* 1. 我们如何收集和使用个人信息 */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. 我们如何收集和使用个人信息</h2>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">1.1 帐号服务</h3>
            <p className="leading-relaxed mb-2"><strong>1.1.1 注册、登录</strong></p>
            <p className="leading-relaxed">
              当你注册、登录 ToryX 及使用相关服务时，你可以通过手机号码或者邮箱创建帐号，并且你可以完善相关的网络身份识别信息（名称、头像、密码），我们收集这些信息是为了帮助你完成注册。收集手机号码是履行国家法律法规关于网络实名制（真实身份信息认证）要求的必要信息，如果你拒绝提供手机号码用于注册、登录，我们可能无法为你提供信息发布（包括生成视频、评论等）功能。
            </p>
            <p className="leading-relaxed mt-2">
              基于我们与通信运营商的合作，当你使用&quot;一键登录&quot;功能时，经过你的同意，我们会使用运营商提供的功能，将你设备中的手机号码作为你的注册、登录帐号并免于密码或动态验证码核验，为你提供快捷的注册、登录服务。如果你不希望使用&quot;一键登录&quot;功能，可以通过其他方式注册、登录 ToryX。
            </p>
            <p className="leading-relaxed mt-2">
              你可以使用第三方帐号注册、登录 ToryX，但需要授权我们获取你在第三方平台的信息（头像、昵称等公开信息以及你授权的其他信息），用于生成与该第三方帐号绑定的 ToryX 帐号，使你可以直接注册、登录并使用 ToryX 和相关服务。部分情况下，我们需要重新验证并绑定你的手机号码，以确认该第三方帐号的真实性和关联性。
            </p>
            <p className="leading-relaxed mt-2">
              如果你忘记了你的 ToryX 的登录方式，可以使用找回密码功能。为保障你帐号的安全，我们可能需要你填写相关信息以进行验证，必要时可能通过真实身份信息验证等方式验证你的身份。
            </p>

            <p className="leading-relaxed mt-4 mb-2"><strong>1.1.2 实名认证</strong></p>
            <p className="leading-relaxed">
              在你使用需实名认证的功能或服务时，为符合法律法规相关要求，保障你或其他用户的安全，或维护功能/服务的安全稳定，需要你提供真实身份信息（真实姓名、身份证件号码或人脸信息，根据实际情况可能有所不同）以完成实名认证。
            </p>
            <p className="leading-relaxed mt-2">
              在实名认证的过程中，可能需要由提供认证服务的第三方认证机构核验你的真实身份信息。这些信息仅供完成实名认证的目的，或其他法律法规所规定的用途，未经你明示授权不会用作其他目的。你可以拒绝提供，但将可能无法使用必须实名认证才可使用的功能或相关服务。不能使用此类功能或服务，不影响你使用其他功能与服务。
            </p>

            <p className="leading-relaxed mt-4 mb-2"><strong>1.1.3 帐号公开信息</strong></p>
            <p className="leading-relaxed">
              我们会在你注册 ToryX 时为你的帐号生成用户 ID，该 ID 是你的帐号的公开识别符号。
            </p>

            <p className="leading-relaxed mt-4 mb-2"><strong>1.1.4 统一帐号和关联版本</strong></p>
            <p className="leading-relaxed">
              如无特别说明，ToryX 的各关联版本均使用统一的帐号服务，<strong>你可以使用同一帐号便捷地登录、使用 ToryX 关联版本，以使用对应版本的服务或功能。</strong>为了在各关联版本中提供一致的服务体验，我们使用SDK或相关技术同步帐号和内容，其中可能包括：共享昵称、头像等你设置为公开的帐号信息；同步你使用此帐号发布的内容；同步你授权的其他信息。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">1.2 内容生成与浏览</h3>
            <p className="leading-relaxed">
              在你使用 ToryX 生成或浏览内容的过程中，我们会记录你的使用情况。如果你未登录帐号，我们会通过设备对应的标识符信息来记录你的【点击、浏览、分享信息】。如果你已登录帐号，我们会通过你的 ToryX 帐号记录你的【点击、浏览、反馈等】。
            </p>
            <p className="leading-relaxed mt-2">
              在为你提供基于位置的内容或服务时，经过你的授权，我们会使用与本服务相关的<strong>地理位置信息（如IP地址对应的城市及/或区县）</strong>，以保障内容或服务的质量。
            </p>
            <p className="leading-relaxed mt-2">
              当你使用搜索时，我们会收集你的搜索关键字信息、日志记录。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">1.3 其他功能</h3>
            <p className="leading-relaxed mb-2"><strong>1.3.1 消息通知</strong></p>
            <p className="leading-relaxed">
              你知悉并同意，我们在运营中可能会通过你在使用产品及/或服务的过程中所提供的联系方式（例如：电话号码、邮箱），向你发送通知，例如消息告知、身份验证、安全验证、用户使用体验调研；此外，我们也可能会以短信、邮件的方式，为你提供你可能感兴趣的服务、功能或活动等商业性信息。如你不愿接受这些信息，你可以直接与我们联系进行退订。
            </p>
            <p className="leading-relaxed mt-2 mb-2"><strong>1.3.2 分享互动</strong></p>
            <p className="leading-relaxed">
              在你分享或接收被分享的信息时，我们需要访问你的剪切板，读取其中包含的链接或分享码，以实现跳转、分享等功能。我们仅在识别出剪切板内容属于 ToryX 跳转、分享等指令时才会将其上传。
            </p>
            <p className="leading-relaxed mt-2 mb-2"><strong>1.3.3 订单与支付</strong></p>
            <p className="leading-relaxed">
              当你购买会员或服务时，我们或提供服务的第三方会收集你的订单信息。支付功能由与我们合作的第三方支付机构向你提供服务。第三方支付机构可能需要收集你的姓名、银行卡类型及卡号、有效期及手机号码等必要信息。银行卡相关信息是个人敏感信息，拒绝提供将导致你无法使用该功能。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">1.4 运营与安全运行</h3>
            <p className="leading-relaxed">
              为维护产品或服务的正常稳定运行，保护你或其他用户或公众的安全及合法利益，我们会收集如下必要信息：
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>为了保障软件与服务的安全运行、运营的质量及效率，我们会收集你的硬件型号、操作系统版本号、设备标识符、IP 地址、软件版本号、网络接入方式、类型、状态、网络质量数据、操作、使用、服务日志等数据。</li>
              <li>为了预防恶意程序、保障运营质量及效率，我们会收集应用程序的总体运行、使用情况与频率、应用崩溃情况、性能数据。</li>
              <li>我们可能使用你的帐号信息、设备信息、服务日志信息，以及我们的关联方、合作方获得你授权或依法可以提供给我们的信息，用于判断帐号安全、交易安全、进行身份验证、识别违法违规情况。</li>
            </ul>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">1.5 Cookie等同类技术的使用</h3>
            <p className="leading-relaxed">
              我们可能会使用 Cookie 或同类技术来收集和存储你的信息，这主要用于：
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li><strong>保障安全</strong>：确认你是否安全登录，排查异常情况。</li>
              <li><strong>提升体验</strong>：帮助你省去重复填写个人信息的步骤。</li>
              <li><strong>推荐内容</strong>：了解你的偏好，为你推荐感兴趣的内容或服务。</li>
            </ul>
            <p className="leading-relaxed mt-2">
              你可以在浏览器设置中清除 Cookie，但清除后可能无法使用依赖于 Cookie 的功能。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">1.6 依法豁免征得同意处理个人信息</h3>
            <p className="leading-relaxed">
              在下列情形中，根据法律法规，我们处理你的个人信息无需征得你的授权同意：
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>根据你的要求订立或履行合同所必需；</li>
              <li>为履行法定职责或者法定义务所必需；</li>
              <li>为应对突发公共卫生事件，或者紧急情况下为保护自然人的生命健康和财产安全所必需；</li>
              <li>为公共利益实施新闻报道、舆论监督等行为，在合理的范围内处理个人信息；</li>
              <li>在合理的范围内处理你自行公开的个人信息，或者其他已经合法公开的个人信息；</li>
              <li>法律法规规定的其他情形。</li>
            </ul>
          </section>

          {/* 2. 数据使用过程中涉及的合作方以及转移、公开个人信息 */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">2. 数据使用过程中涉及的合作方以及转移、公开个人信息</h2>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.1 合作方的使用</h3>
            <p className="leading-relaxed mb-2"><strong>2.1.1 基本原则</strong></p>
            <p className="leading-relaxed">遵循合法、正当、必要、安全审慎原则。</p>

            <p className="leading-relaxed mt-4 mb-2"><strong>2.1.2 合作场景</strong></p>
            <p className="leading-relaxed">
              我们可能会与第三方合作提供服务（如支付、消息推送、实名认证等），在合作过程中，我们要求合作方严格遵守法律法规和数据安全要求。
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li><strong>支付服务</strong>：由第三方支付机构提供，需收集必要的支付信息。</li>
              <li><strong>消息推送</strong>：终端设备制造商或推送服务商可能需要使用你的设备信息以完成推送。</li>
              <li><strong>登录/绑定帐号</strong>：经你同意，第三方产品可能会使用你的公开信息。</li>
            </ul>

            <p className="leading-relaxed mt-4 mb-2"><strong>2.1.3 广告</strong></p>
            <p className="leading-relaxed">
              我们可能与广告合作方共享去标识化的统计信息，用于分析广告有效性，但不会共享可识别你个人身份的信息。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.2 运营主体变更</h3>
            <p className="leading-relaxed">
              如发生合并、收购或资产转让，你的个人信息可能被转移。我们会要求继受方继续履行本隐私政策的义务，否则将要求其重新征得你的同意。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.3 停止运营</h3>
            <p className="leading-relaxed">
              如停止运营，我们将及时停止收集并删除或匿名化处理你的个人信息，并向你发送通知。
            </p>

            <h3 className="text-xl font-medium text-white mt-6 mb-3">2.4 公开</h3>
            <p className="leading-relaxed">
              除非遵循法律法规或获得你的同意，我们不会主动公开你的个人信息。
            </p>
          </section>

          {/* 3. 管理你的个人信息 */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">3. 管理你的个人信息</h2>
            <p className="leading-relaxed">
              我们保障你对个人信息的查阅、复制、更正、补充、删除、撤回同意、注销帐号等权利。
            </p>
            <p className="leading-relaxed mt-2">
              你可以通过应用内的设置功能或联系客服来管理你的个人信息。
            </p>
            <p className="leading-relaxed mt-2">
              特别是账户注销功能，你可以在&quot;设置-账号安全&quot;中找到注销入口，注销后我们将删除或匿名化处理你的相关数据。
            </p>
          </section>

          {/* 4. 我们如何保护个人信息的安全 */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">4. 我们如何保护个人信息的安全</h2>

            <p className="leading-relaxed mb-2"><strong>4.1 安全措施</strong></p>
            <p className="leading-relaxed">
              我们采取加密、去标识化等技术手段，以及严格的管理制度来保护你的个人信息。
            </p>

            <p className="leading-relaxed mt-4 mb-2"><strong>4.2 应急预案</strong></p>
            <p className="leading-relaxed">
              建立安全事件应急预案，一旦发生泄漏等事件，将及时启动预案并告知你相关情况。
            </p>

            <p className="leading-relaxed mt-4 mb-2"><strong>4.3 安全提示</strong></p>
            <p className="leading-relaxed">
              请你理解互联网环境并非百分之百安全，请妥善保管你的帐号信息。
            </p>
          </section>

          {/* 5. 我们如何存储个人信息 */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">5. 我们如何存储个人信息</h2>

            <p className="leading-relaxed mb-2"><strong>5.1 存储地点</strong></p>
            <p className="leading-relaxed">
              你的个人信息将存储于<strong>中华人民共和国境内</strong>。如需跨境传输，我们将遵循相关法律法规规定。
            </p>

            <p className="leading-relaxed mt-4 mb-2"><strong>5.2 存储期限</strong></p>
            <p className="leading-relaxed">
              我们仅在提供服务所必需的期间内保留你的个人信息。注销帐号后，我们将删除或匿名化处理你的信息，法律法规另有规定的除外。
            </p>
          </section>

          {/* 6. 我们如何保护未成年人 */}
          <section className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">6. 我们如何保护未成年人</h2>
            <p className="leading-relaxed">
              我们非常重视对未成年人的保护。
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>若你是未满18周岁的未成年人，应在监护人指导下阅读并同意本政策。</li>
              <li>我们只会在法律允许、监护人同意或保护未成年人所必要的情况下处理未成年人信息。</li>
            </ul>
          </section>

          {/* 7. 隐私政策的查阅和修订 */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">7. 隐私政策的查阅和修订</h2>

            <p className="leading-relaxed mb-2"><strong>7.1 查阅</strong></p>
            <p className="leading-relaxed">
              你可以在 ToryX 网站页脚或应用设置中查看本隐私政策。
            </p>

            <p className="leading-relaxed mt-4 mb-2"><strong>7.2 更新</strong></p>
            <p className="leading-relaxed">
              我们会适时修订本政策，并通过公告或站内信通知你。
            </p>
          </section>

          {/* 8. 联系我们 */}
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">8. 联系我们</h2>
            <p className="leading-relaxed">
              如果你对个人信息保护问题有疑问、建议或投诉，可选择通过以下方式联系我们：
            </p>
            <div className="mt-4 p-4 bg-white/5 rounded-lg">
              <p>发送邮件至：<strong>contact@toryx.ai</strong></p>
              <p className="mt-2">我们将尽快审核并在验证身份后的十五个工作日内回复。</p>
            </div>
          </section>

          {/* 9. 其他 - 第三方服务声明 */}
          <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-cyan-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">9. 其他</h2>

            <p className="leading-relaxed mb-2"><strong>9.1 第三方服务声明</strong></p>
            <p className="leading-relaxed">
              ToryX 在集成第三方服务（如 TikTok、YouTube）时，将遵循相关平台的数据政策。
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>如果你授权了 TikTok 账号，则意味着你同意接受 <a href="https://www.tiktok.com/legal/privacy-policy?lang=zh" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">TikTok 隐私政策</a>。</li>
              <li>ToryX 将使用到 Google/YouTube API 服务，如果你授权了 YouTube 账号，则意味着你同意接受 <a href="https://www.google.com/policies/privacy" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Google 隐私权政策</a>。</li>
              <li>如果你需要解除 Google/YouTube 授权，可以通过 <a href="https://security.google.com/settings/security/permissions" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">Google 安全设置页面</a> 撤消应用的数据访问权限。</li>
            </ul>
          </section>

          {/* 页脚信息 */}
          <section className="border-t border-white/10 pt-8 mt-8">
            <div className="p-4 bg-white/5 rounded-lg">
              <p><strong>武汉观星文化传媒有限公司</strong></p>
              <p className="mt-1">Wuhan Guanxing Cultural Media Co., Ltd.</p>
              <p className="mt-2">网站：www.tokfactoryai.com</p>
              <p>地址：中国湖北省武汉市</p>
              <p className="mt-2 text-gray-400">ICP备案号：鄂ICP备2023007484号</p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
