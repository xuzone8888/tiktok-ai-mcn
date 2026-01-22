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
              <div className="flex items-center gap-2 bg-white/10 rounded-lg p-1">
                <button
                  onClick={() => setLang("en")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${lang === "en" ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"}`}
                >
                  <Globe className="h-4 w-4" />
                  English
                </button>
                <button
                  onClick={() => setLang("zh")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${lang === "zh" ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"}`}
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
        <h1 className="text-4xl font-bold mb-4">Terms of Service</h1>
        <p className="text-gray-400">Last Updated: January 22, 2026</p>
        <p className="text-gray-400 mt-2">Effective Date: January 22, 2026</p>
      </div>

      <div className="prose prose-invert prose-lg max-w-none">
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. Introduction</h2>
            <p className="leading-relaxed">Welcome to &quot;ToryX&quot; software and related services!</p>
            <p className="leading-relaxed mt-4">
              &quot;ToryX&quot; software and related services refer to the products and services provided to you by <strong>Wuhan Guanxing Cultural Media Co., Ltd.</strong> and its affiliates (hereinafter referred to as &quot;Company&quot;), which legally own and operate the client application labeled &quot;ToryX&quot; and the related website (www.tokfactoryai.com). This Agreement is entered into between you and the Company regarding your download, installation, registration, login, use of &quot;ToryX&quot; software, and access to related services.
            </p>
            <p className="leading-relaxed mt-4">
              To better provide services to you, please strictly read and fully understand this Agreement before you start using &quot;ToryX&quot; software and related services, especially terms involving exemption or limitation of liability, licensing of rights and use of information, terms regarding consent to activate and use special individual services, governing law and dispute resolution terms, etc. <strong>Among them, important contents such as exemption or limitation of liability terms will be prompted in bold for your attention, and you should read them emphatically.</strong> If you are under 18 years old, please carefully read and fully understand this Agreement accompanied by your legal guardian, and use &quot;ToryX&quot; software and related services after obtaining the consent of your legal guardian.
            </p>
            <p className="leading-relaxed mt-4">
              If you do not agree to this Agreement, we will be unable to provide you with complete products and services, and you may choose to stop using them. <strong>If you voluntarily choose to agree to or use &quot;ToryX&quot; software and related services, it shall be deemed that you have fully understood this Agreement and agreed to accept the constraints of this Agreement and other agreements and rules related to &quot;ToryX&quot; software and related services (including but not limited to &quot;ToryX Privacy Policy&quot;) as a party to this Agreement.</strong>
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">2. &quot;ToryX&quot; Software and Related Services</h2>
            <p className="leading-relaxed">2.1 You may use &quot;ToryX&quot; software and related services in the form of clients, webpages, etc. on terminals such as computers and mobile phones. The specific form provided by the Company shall prevail.</p>
            <p className="leading-relaxed mt-4">2.2 The Company grants you a personal, non-transferable, and non-exclusive license to use &quot;ToryX&quot; software and related services. <strong>Without prior written authorization from the Company, you may not use it for commercial purposes.</strong></p>
            <p className="leading-relaxed mt-4">2.3 You can obtain this software from the Company&apos;s website or a third party authorized by the Company. If you obtain this software from a third party not authorized by the Company, the Company cannot guarantee that the software can be used normally.</p>
            <p className="leading-relaxed mt-4">2.4 In order to improve user experience and improve service content, the Company will continuously strive to develop new services and provide you with software updates from time to time.</p>
            <p className="leading-relaxed mt-4">2.5 Unless you have prior written authorization from the Company, you may not access or use &quot;ToryX&quot; software and related services in any unauthorized form.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">3. About &quot;Account&quot;</h2>
            <p className="leading-relaxed">3.1 &quot;ToryX&quot; software and related services provide you with a registration channel. You have the right to choose a legal character combination as your account and set a password that meets security requirements on your own.</p>
            <p className="leading-relaxed mt-4">3.2 You understand and assume that the account you set shall not violate national laws and regulations and the relevant rules of the Company. Your account name, avatar, profile, and other registration information shall not contain illegal or undesirable information.</p>
            <p className="leading-relaxed mt-4">3.3 Your account is limited to your personal use. Without the written consent of the Company, it is prohibited to donate, borrow, rent, transfer, sell, or permit others to use the account in any other way.</p>
            <p className="leading-relaxed mt-4">3.4 You are responsible for maintaining the security and confidentiality of your personal account and password, and assume full legal responsibility for activities engaged in the name of your registered account.</p>
            <p className="leading-relaxed mt-4"><strong>3.5 If your account is lost or you forget your password, you can follow the Company&apos;s appeal channel to appeal for retrieval of the account or password.</strong></p>
            <p className="leading-relaxed mt-4"><strong>3.6 When registering, using, and managing your account, you should ensure the authenticity of the identity information filled in during registration.</strong></p>
            <p className="leading-relaxed mt-4">3.7 In addition to self-registering an account, users can also authorize the use of user accounts of third-party software legally owned by them to log in and use &quot;ToryX&quot; software and related services.</p>
            <p className="leading-relaxed mt-4"><strong>3.8 After you complete account registration and login, you can browse and modify the submitted personal identity information at any time. You can also apply to cancel your account.</strong></p>
            <p className="leading-relaxed mt-4"><strong>3.9 You understand and agree that in order to fully utilize account resources, if you fail to log in for the first time in time after registration or fail to log in and use the account for more than two consecutive months, the Company has the right to recall your account.</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">4. User Personal Information Protection</h2>
            <p className="leading-relaxed">The Company is committed to the protection of your personal information together with you. Protecting user personal information is one of the Company&apos;s basic principles. The Company will protect your rights to browse, modify, delete relevant personal information, withdraw authorization, and cancel your account in accordance with the law, and will use encryption technology, anonymization processing, and other technical measures and other security measures matching &quot;ToryX&quot; software and related services to protect your personal information.</p>
            <p className="leading-relaxed mt-4"><strong>For more content on your personal information protection, please refer to the &quot;ToryX Privacy Policy&quot;.</strong></p>
          </section>

          <section className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">5. User Conduct Code</h2>
            <p className="leading-relaxed"><strong>5.1 User Conduct Requirements</strong></p>
            <p className="leading-relaxed mt-2">You shall be responsible for your use of &quot;ToryX&quot; software and related services. Unless permitted by law or with prior written permission from the Company, your use of &quot;ToryX&quot; software and related services shall not involve the following behaviors: using any unauthorized tools to interfere with the normal operation of the software, engaging in acts endangering computer network security, maliciously registering accounts, etc.</p>
            <p className="leading-relaxed mt-4"><strong>5.2 Information Content Norms</strong></p>
            <p className="leading-relaxed mt-2">The information you create, comment on, publish, and disseminate shall consciously abide by the &quot;Seven Bottom Lines&quot; requirements such as laws and regulations, the socialist system, national interests, legitimate rights and interests of citizens, social public order, moral customs, and information authenticity. You agree and commit not to create, reproduce, publish, or disseminate the following information:</p>
            <ol className="list-decimal pl-6 space-y-1 mt-2">
              <li>Opposing the basic principles established by the Constitution</li>
              <li>Endangering national security or divulging state secrets</li>
              <li>Subverting state power, overthrowing the socialist system, undermining national unity</li>
              <li>Advocating terrorism or extremism</li>
              <li>Inciting ethnic hatred or discrimination, undermining ethnic unity</li>
              <li>Undermining state religious policies or propagating cults and feudal superstitions</li>
              <li>Fabricating or spreading rumors or false information to disturb social order</li>
              <li>Disseminating obscenity, pornography, gambling, violence, terror, or abetting crimes</li>
              <li>Infringing upon the legitimate rights and interests of minors or harming the physical and mental health of minors</li>
              <li>Insulting or defaming others or infringing upon the legitimate rights and interests of others</li>
              <li>Infringing upon others&apos; privacy rights, reputation rights, portrait rights, intellectual property rights, and other legitimate rights and interests</li>
              <li>Other information violating laws, regulations, policies, and public order and good customs</li>
            </ol>
            <p className="leading-relaxed mt-4"><strong>5.3 If the Company has reason to believe that your behavior violates or may violate the above agreement, the Company may verify and handle it independently, and has the right to terminate the provision of services to you without prior notice and pursue relevant legal responsibilities.</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">6. &quot;ToryX&quot; Information Content Usage Norms</h2>
            <p className="leading-relaxed">6.1 Without written permission from the Company, you may not copy, read, adopt, or use the information content in &quot;ToryX&quot; software and related services under this Agreement for commercial purposes, either by yourself or by authorizing, allowing, or assisting any third party.</p>
            <p className="leading-relaxed mt-4">6.2 With written permission from the Company, your sharing and forwarding of the information content of &quot;ToryX&quot; software and related services shall also comply with relevant norms, and the original content shall not be tampered with or obscured.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">7. Breach Handling</h2>
            <p className="leading-relaxed"><strong>7.1 In response to your violation of this Agreement or other service terms, the Company has the right to independently judge and take measures such as prior warning, refusal to publish, immediate cessation of information transmission, deletion of posts, short-term prohibition of speaking, restriction of some or all account functions, up to permanent closure of the account.</strong> The Company has the right to announce the processing results and decide whether to restore the use of the relevant account based on the actual situation.</p>
            <p className="leading-relaxed mt-4"><strong>7.2 If your violation of this Agreement or other service terms causes third-party complaints or litigation claims, you shall handle it yourself and bear all legal responsibilities that may arise therefrom. If your illegal or breach behavior causes the Company and its affiliates to compensate any third party or suffer penalties from state organs, you shall also fully compensate the Company and its affiliates for all losses suffered therefrom.</strong></p>
            <p className="leading-relaxed mt-4"><strong>7.3 The Company respects and protects the intellectual property rights, reputation rights, name rights, privacy rights, and other legitimate rights and interests of legal persons and citizens. You guarantee that the text, pictures, videos, audio, links, etc. uploaded when using &quot;ToryX&quot; software and related services do not infringe any legitimate rights and interests of any third party.</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">8. Changes, Interruption, and Termination of Services</h2>
            <p className="leading-relaxed">8.1 You understand and agree that &quot;ToryX&quot; software and related services provided by the Company are provided based on the status quo achievable by existing technology and conditions. The Company will do its best to provide you with services and ensure the continuity and security of services. You understand that the Company cannot foresee and prevent legal, technical, and other risks at any time, including but not limited to service interruptions caused by force majeure, network reasons, third-party service defects, etc.</p>
            <p className="leading-relaxed mt-4">8.2 You understand and agree that for the needs of overall service operation and platform operation security, the Company has the right to decide service/function settings and scope, and to modify, interrupt, suspend, or terminate &quot;ToryX&quot; software and related services based on specific circumstances.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">9. Advertising</h2>
            <p className="leading-relaxed">9.1 You understand and agree that the Company may push relevant information, advertising releases, or brand promotion services to you during your use of &quot;ToryX&quot; software and related services.</p>
            <p className="leading-relaxed mt-4">9.2 The Company fulfills relevant obligations for advertising and promotion. You should judge the authenticity and reliability of such advertising or promotion information yourself and be responsible for your own judgment.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">10. Intellectual Property</h2>
            <p className="leading-relaxed">10.1 The intellectual property rights of the content provided by the Company in &quot;ToryX&quot; software and related services (including but not limited to software, technology, programs, webpages, text, pictures, images, audio, video, charts, layout design, electronic documents, etc.) belong to the Company. No one may use them without the Company&apos;s permission.</p>
            <p className="leading-relaxed mt-4">10.2 You understand and agree that the text, pictures, videos, audio, etc. you publish and upload when using &quot;ToryX&quot; software and related services are originally created by you or have been legally authorized. The intellectual property rights of any content you upload or publish through &quot;ToryX&quot; belong to you or the original copyright owner.</p>
            <p className="leading-relaxed mt-4"><strong>10.3 You know, understand, and agree that for the content you publish and upload through &quot;ToryX&quot; software and related services, you grant the Company and its affiliates a worldwide, free, non-exclusive, sublicensable right.</strong></p>
            <p className="leading-relaxed mt-4"><strong>10.4 You confirm and agree to authorize the Company to defend rights against infringement of the intellectual property rights of the content you upload and publish in the Company&apos;s own name or by entrusting a professional third party.</strong></p>
          </section>

          <section className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">11. Taxation</h2>
            <p className="leading-relaxed"><strong>11.1 Your income (if any) in &quot;ToryX&quot; software and related services will be withdrawn directly in cash or equivalent form. You understand and agree that the Company has the right to withhold and pay taxes for you, and declare and pay to the tax authorities in accordance with national laws and regulations.</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">12. Disclaimer</h2>
            <p className="leading-relaxed"><strong>12.1 You understand and agree that &quot;ToryX&quot; software and related services may be affected or interfered with by various factors, and the Company does not guarantee that:</strong></p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>&quot;ToryX&quot; software and related services fully meet user requirements;</strong></li>
              <li><strong>&quot;ToryX&quot; software and related services are undisturbed, timely, safe, reliable, or error-free;</strong></li>
              <li><strong>Any errors in &quot;ToryX&quot; software and related services will be corrected.</strong></li>
            </ul>
            <p className="leading-relaxed mt-4"><strong>12.2 You understand and agree that during the use of &quot;ToryX&quot; software and related services, force majeure factors (force majeure refers to objective events that cannot be foreseen, overcome, and avoided), including but not limited to natural disasters, government actions, wars, strikes, riots, etc., may be encountered. When force majeure occurs, the Company will strive to repair it in time at the first instance, but the Company is exempted from liability for losses caused by force majeure within the scope of laws and regulations.</strong></p>
            <p className="leading-relaxed mt-4"><strong>12.3 In no event shall the Company be liable for any indirect, consequential, punitive, incidental, special, or penal damages, including loss of profits suffered by you due to your use of &quot;ToryX&quot; software and related services.</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">13. Special Agreement on Individual Services and Third-Party Services</h2>
            <p className="leading-relaxed">13.1 &quot;ToryX&quot; software and related services contain information or information content links obtained by the Company in various legal ways, and also include other individual services legally operated by the Company and its affiliates. Certain individual services may require you to accept agreements or other rules specially formulated for such services at the same time.</p>
            <p className="leading-relaxed mt-4">13.2 When you use software and related services provided by third parties in &quot;ToryX&quot; software and related services, in addition to abiding by this Agreement, you may also need to agree to and abide by the third party&apos;s agreements, privacy policies, and relevant rules. Disputes, losses, or damages arising from third-party software and related services shall be resolved by you and the third party yourselves.</p>
            <p className="leading-relaxed mt-4"><strong>13.3 &quot;ToryX&quot; integrates and uses third-party services including but not limited to TikTok and Alibaba Cloud. When you use these services, you agree to abide by their relevant terms of service.</strong></p>
          </section>

          <section className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">14. Minors Use Terms</h2>
            <p className="leading-relaxed"><strong>14.1 If you are a minor under the age of 18, you should use &quot;ToryX&quot; software and related services under the guardianship and guidance of your guardian and with the consent of your guardian, after carefully reading and agreeing to this Agreement.</strong></p>
            <p className="leading-relaxed mt-4"><strong>14.2 The Company attaches importance to the protection of minors&apos; personal information. Minor users should strengthen their awareness of personal protection and treat it specifically when filling in personal information.</strong></p>
            <p className="leading-relaxed mt-4"><strong>14.3 Minor users and their guardians understand and confirm that if you violate laws and regulations or the content of this Agreement, you and your guardians shall bear all legal responsibilities that may result therefrom according to the law.</strong></p>
            <p className="leading-relaxed mt-4"><strong>14.4 Special Note for Minor Users:</strong> Teenagers should use &quot;ToryX&quot; software and related services correctly within a reasonable range under the supervision and guidance of their guardians, avoid addiction to virtual cyberspace, and develop good internet surfing habits.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">15. Others</h2>
            <p className="leading-relaxed"><strong>15.1 The conclusion, effectiveness, performance, interpretation, and dispute resolution of this Agreement shall be governed by the laws of the People&apos;s Republic of China. If any provision of this Agreement is invalid or unenforceable due to conflict with the laws of the People&apos;s Republic of China, these terms shall be re-interpreted as closely as possible to the original intent of this Agreement, and other provisions of this Agreement shall still have full force and effect.</strong></p>
            <p className="leading-relaxed mt-4"><strong>15.2 The signing place of this Agreement is Wuhan, Hubei Province. If any dispute arises between you and the Company, both parties shall try to resolve it through friendly negotiation. If negotiation fails, you agree to submit the dispute to the People&apos;s Court where the Company is located for litigation.</strong></p>
            <p className="leading-relaxed mt-4"><strong>15.3 In order to provide you with better services or due to adjustments in national laws, regulations, and policies, &quot;ToryX&quot; software and related services will be updated and changed from time to time, and we will revise this Agreement in due course. If you continue to use &quot;ToryX&quot; software and related services, it means you have agreed to accept the revised content of this Agreement.</strong></p>
            <p className="leading-relaxed mt-4">15.4 The headings in this Agreement are set for convenience and reading only and do not affect the meaning or interpretation of any provision in this Agreement.</p>
            <p className="leading-relaxed mt-4">15.5 You and the Company are independent subjects. In no case does this Agreement constitute any form of express or implied guarantee or condition by the Company to the user, nor does it constitute an agency, partnership, joint venture, or employment relationship between the parties.</p>
            <p className="leading-relaxed mt-4">15.6 The copyright of this Agreement belongs to the Company, and the Company reserves all rights of interpretation and modification.</p>
          </section>

          <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-cyan-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
              </svg>
              16. Other Terms (TikTok Related)
            </h2>
            <p className="leading-relaxed"><strong>16.1 Your authorization to use your TikTok account in &quot;ToryX&quot; software and related services shall be deemed as your agreement to TikTok&apos;s relevant terms of service.</strong></p>
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-sm text-gray-400">Related Links:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2 text-sm">
                <li><a href="https://www.tiktok.com/legal/page/row/terms-of-service/en" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">TikTok Terms of Service</a></li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">17. Subscription</h2>
            <p className="leading-relaxed"><strong>17.1 Subscription Upgrade and Downgrade:</strong> When changing from one paid plan to another, the new plan will be prorated by calculating the remaining days of the two plans and their respective daily rates.</p>
            <p className="leading-relaxed mt-4"><strong>17.2 Fee Changes:</strong> We may change plan fees from time to time and will notify you in advance. Price changes will take effect at the beginning of the next subscription period. If you do not agree to the price change, you must cancel your subscription before the price change takes effect.</p>
            <p className="leading-relaxed mt-4"><strong>17.3 Subscription Cancellation:</strong> You can cancel your subscription at any time. After cancellation, your subscription will expire at the end of the current cycle. Paid fees are non-refundable.</p>
          </section>

          <section className="border-t border-white/10 pt-8 mt-8">
            <div className="p-4 bg-white/5 rounded-lg">
              <p><strong>Wuhan Guanxing Cultural Media Co., Ltd.</strong></p>
              <p className="mt-1">Email: contact@toryx.ai</p>
              <p className="mt-2">Website: www.tokfactoryai.com</p>
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
        <h1 className="text-4xl font-bold mb-4">&quot;ToryX&quot;用户服务协议</h1>
        <p className="text-gray-400">更新日期：2026年01月22日</p>
        <p className="text-gray-400 mt-2">生效日期：2026年01月22日</p>
      </div>

      <div className="prose prose-invert prose-lg max-w-none">
        <div className="space-y-8 text-gray-300">
          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">1. 导言</h2>
            <p className="leading-relaxed">欢迎您使用&quot;ToryX&quot;软件及相关服务！</p>
            <p className="leading-relaxed mt-4">&quot;ToryX&quot;软件及相关服务，系指<strong>武汉观星文化传媒有限公司</strong>及其关联方（以下简称&quot;公司&quot;）合法拥有并运营的、标注名称为&quot;ToryX&quot;的客户端应用程序以及相关网站（ www.tokfactoryai.com ）向您提供的产品与服务。本协议是您与公司就您下载、安装、注册、登录、使用&quot;ToryX&quot;软件，并获得相关服务所订立的协议。</p>
            <p className="leading-relaxed mt-4">为了更好地为您提供服务，请您在开始使用&quot;ToryX&quot;软件及相关服务之前，务必认真阅读并充分理解本协议，特别是涉及免除或者限制责任的条款、权利许可和信息使用的条款、同意开通和使用特殊单项服务的条款、法律适用和争议解决条款等。<strong>其中，免除或者限制责任条款等重要内容将以加粗形式提示您注意，您应重点阅读。</strong>如您未满18周岁，请您在法定监护人陪同下仔细阅读并充分理解本协议，并征得法定监护人的同意后使用&quot;ToryX&quot;软件及相关服务。</p>
            <p className="leading-relaxed mt-4">如您不同意本协议，这将导致我们无法为您提供完整的产品和服务，您也可以选择停止使用。<strong>如您自主选择同意或使用&quot;ToryX&quot;软件及相关服务，则视为您已充分理解本协议，并同意作为本协议的一方当事人接受本协议以及其他与&quot;ToryX&quot;软件及相关服务相关的协议和规则（包括但不限于《ToryX隐私政策》）的约束。</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">2. &quot;ToryX&quot;软件及相关服务</h2>
            <p className="leading-relaxed">2.1 您可以使用电脑、手机等终端以客户端、网页等形式使用&quot;ToryX&quot;软件及相关服务。具体以公司提供的为准。</p>
            <p className="leading-relaxed mt-4">2.2 公司给予您一项个人的、不可转让及非排他性的许可，以使用&quot;ToryX&quot;软件及相关服务。<strong>未经公司事先书面授权，您不得进行商业性使用。</strong></p>
            <p className="leading-relaxed mt-4">2.3 您可以从公司网站、公司授权的第三方获取本软件。如果您从未经公司授权的第三方获取本软件，公司无法保证该软件能够正常使用。</p>
            <p className="leading-relaxed mt-4">2.4 为了改善用户体验、完善服务内容，公司将不断努力开发新的服务，并为您不时提供软件更新。</p>
            <p className="leading-relaxed mt-4">2.5 除非得到公司事先书面授权，您不得以任何形式对&quot;ToryX&quot;软件及相关服务进行未经授权的访问或使用。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">3. 关于&quot;帐号&quot;</h2>
            <p className="leading-relaxed">3.1 &quot;ToryX&quot;软件及相关服务为您提供了注册通道，您有权选择合法的字符组合作为自己的帐号，并自行设置符合安全要求的密码。</p>
            <p className="leading-relaxed mt-4">3.2 您理解并承诺，您所设置的帐号不得违反国家法律法规及公司的相关规则，您的帐号名称、头像和简介等注册信息中不得出现违法和不良信息。</p>
            <p className="leading-relaxed mt-4">3.3 您的帐号仅限于您本人使用，未经公司书面同意，禁止以任何形式赠与、借用、出租、转让、售卖或以其他方式许可他人使用该帐号。</p>
            <p className="leading-relaxed mt-4">3.4 您有责任维护个人帐号、密码的安全性与保密性，并对您以注册帐号名义所从事的活动承担全部法律责任。</p>
            <p className="leading-relaxed mt-4"><strong>3.5 您的帐号在丢失或遗忘密码后，可遵照公司申诉途径及时申诉请求找回帐号或密码。</strong></p>
            <p className="leading-relaxed mt-4"><strong>3.6 在注册、使用和管理帐号时，您应保证注册帐号时填写的身份信息的真实性。</strong></p>
            <p className="leading-relaxed mt-4">3.7 除自行注册帐号外，用户也可授权使用其合法拥有的第三方软件的用户帐号登录使用&quot;ToryX&quot;软件及相关服务。</p>
            <p className="leading-relaxed mt-4"><strong>3.8 当您完成帐号注册、登录后，您可随时浏览、修改自己提交的个人身份信息。您也可以申请注销帐号。</strong></p>
            <p className="leading-relaxed mt-4"><strong>3.9 您理解并同意，为了充分使用帐号资源，如您在注册后未及时进行初次登录使用或连续超过两个月未登录帐号，公司有权收回您的帐号。</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">4. 用户个人信息保护</h2>
            <p className="leading-relaxed">公司与您一同致力于您个人信息的保护，保护用户个人信息是公司的基本原则之一。公司将依法保护您浏览、修改、删除相关个人信息以及撤回授权、注销帐号的权利，并将运用加密技术、匿名化处理等其他与&quot;ToryX&quot;软件及相关服务相匹配的技术措施保护您的个人信息。</p>
            <p className="leading-relaxed mt-4"><strong>更多关于您个人信息保护的内容，请您参看《ToryX隐私政策》。</strong></p>
          </section>

          <section className="bg-red-500/10 border border-red-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">5. 用户行为规范</h2>
            <p className="leading-relaxed"><strong>5.1 用户行为要求</strong></p>
            <p className="leading-relaxed mt-2">您应当对您使用&quot;ToryX&quot;软件及相关服务的行为负责，除非法律允许或者经公司事先书面许可，您使用&quot;ToryX&quot;软件及相关服务不得具有下列行为：使用未经公司授权的任何工具对软件的正常运行进行干扰、进行危害计算机网络安全的行为、恶意注册帐号等。</p>
            <p className="leading-relaxed mt-4"><strong>5.2 信息内容规范</strong></p>
            <p className="leading-relaxed mt-2">您制作、评论、发布、传播的信息应自觉遵守法律法规、社会主义制度、国家利益、公民合法权益、社会公共秩序、道德风尚和信息真实性等&quot;七条底线&quot;要求。您同意并承诺不制作、复制、发布、传播下列信息：</p>
            <ol className="list-decimal pl-6 space-y-1 mt-2">
              <li>反对宪法确定的基本原则的</li>
              <li>危害国家安全，泄露国家秘密的</li>
              <li>颠覆国家政权，推翻社会主义制度，煽动分裂国家，破坏国家统一的</li>
              <li>宣扬恐怖主义、极端主义的</li>
              <li>宣扬民族仇恨、民族歧视，破坏民族团结的</li>
              <li>破坏国家宗教政策，宣扬邪教和封建迷信的</li>
              <li>编造、散布谣言、虚假信息，扰乱社会秩序的</li>
              <li>散布、传播淫秽、色情、赌博、暴力、恐怖或者教唆犯罪的</li>
              <li>侵害未成年人合法权益或者损害未成年人身心健康的</li>
              <li>侮辱或者诽谤他人，侵害他人合法权益的</li>
              <li>侵犯他人隐私权、名誉权、肖像权、知识产权等合法权益内容的</li>
              <li>其他违反法律法规、政策及公序良俗的信息</li>
            </ol>
            <p className="leading-relaxed mt-4"><strong>5.3 如果公司有理由认为您的行为违反或可能违反上述约定的，公司可独立进行判断并处理，且有权在不事先通知的情况下终止向您提供服务，并追究相关法律责任。</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">6. &quot;ToryX&quot;信息内容使用规范</h2>
            <p className="leading-relaxed">6.1 未经公司书面许可，您不得自行或授权、允许、协助任何第三人对本协议&quot;ToryX&quot;软件及相关服务中信息内容进行复制、读取、采用等行为用于商业用途。</p>
            <p className="leading-relaxed mt-4">6.2 经公司书面许可后，您对&quot;ToryX&quot;软件及相关服务的信息内容的分享、转发等行为，还应符合相关规范，不得对原始内容进行篡改、遮挡等操作。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">7. 违约处理</h2>
            <p className="leading-relaxed"><strong>7.1 针对您违反本协议或其他服务条款的行为，公司有权独立判断并视情况采取预先警示、拒绝发布、立即停止传输信息、删除跟帖、短期禁止发言、限制帐号部分或者全部功能直至永久关闭帐号等措施。</strong>公司有权公告处理结果，且有权根据实际情况决定是否恢复相关帐号的使用。</p>
            <p className="leading-relaxed mt-4"><strong>7.2 因您违反本协议或其他服务条款规定，引起第三方投诉或诉讼索赔的，您应当自行处理并承担全部可能由此引起的法律责任。因您的违法或违约行为导致公司及其关联方向任何第三方赔偿或遭受国家机关处罚的，您还应足额赔偿公司及其关联方因此遭受的全部损失。</strong></p>
            <p className="leading-relaxed mt-4"><strong>7.3 公司尊重并保护法人、公民的知识产权、名誉权、姓名权、隐私权等合法权益。您保证，在使用&quot;ToryX&quot;软件及相关服务时上传的文字、图片、视频、音频、链接等不侵犯任何第三方的合法权益。</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">8. 服务的变更、中断和终止</h2>
            <p className="leading-relaxed">8.1 您理解并同意，公司提供的&quot;ToryX&quot;软件及相关服务是按照现有技术和条件所能达到的现状提供的。公司会尽最大努力向您提供服务，确保服务的连贯性和安全性。您理解，公司不能随时预见和防范不可抗力、网络原因、第三方服务瑕疵等因素可能导致的服务中断。</p>
            <p className="leading-relaxed mt-4">8.2 您理解并同意，公司为了服务整体运营、平台运营安全的需要，有权视具体情况决定服务/功能设置、范围，修改、中断、中止或终止&quot;ToryX&quot;软件及相关服务。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">9. 广告</h2>
            <p className="leading-relaxed">9.1 您理解并同意，在使用&quot;ToryX&quot;软件及相关服务过程中公司可能会向您推送具有相关性的信息、广告发布或品牌推广服务。</p>
            <p className="leading-relaxed mt-4">9.2 公司履行广告及推广相关义务，您应当自行判断该广告或推广信息的真实性和可靠性并为自己的判断行为负责。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">10. 知识产权</h2>
            <p className="leading-relaxed">10.1 公司在&quot;ToryX&quot;软件及相关服务中提供的内容（包括但不限于软件、技术、程序、网页、文字、图片、图像、音频、视频、图表、版面设计、电子文档等）的知识产权属于公司所有。未经公司许可，任何人不得擅自使用。</p>
            <p className="leading-relaxed mt-4">10.2 您理解并同意，您在使用&quot;ToryX&quot;软件及相关服务时发布上传的文字、图片、视频、音频等均由您原创或已获合法授权。您通过&quot;ToryX&quot;上传、发布的任何内容的知识产权归属您或原始著作权人所有。</p>
            <p className="leading-relaxed mt-4"><strong>10.3 您知悉、理解并同意，您通过&quot;ToryX&quot;软件及相关服务发布、上传的内容，授予公司及其关联方一项全球范围内、免费、非独家、可再许可的权利。</strong></p>
            <p className="leading-relaxed mt-4"><strong>10.4 您确认并同意授权公司以公司自己的名义或委托专业第三方对侵犯您上传发布的享有知识产权的内容进行代维权。</strong></p>
          </section>

          <section className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">11. 税收</h2>
            <p className="leading-relaxed"><strong>11.1 您在&quot;ToryX&quot;软件及相关服务中的收入（如有）将直接以现金或等值形式提现。您理解并同意，公司有权为您代扣代缴税金，并依据国家法律法规之规定向税务机关申报缴纳。</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">12. 免责声明</h2>
            <p className="leading-relaxed"><strong>12.1 您理解并同意，&quot;ToryX&quot;软件及相关服务可能会受多种因素的影响或干扰，公司不保证：</strong></p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li><strong>&quot;ToryX&quot;软件及相关服务完全适合用户的使用要求；</strong></li>
              <li><strong>&quot;ToryX&quot;软件及相关服务不受干扰，及时、安全、可靠或不出现错误；</strong></li>
              <li><strong>&quot;ToryX&quot;软件及相关服务中任何错误都将能得到更正。</strong></li>
            </ul>
            <p className="leading-relaxed mt-4"><strong>12.2 您理解并同意，在使用&quot;ToryX&quot;软件及相关服务过程中，可能遇到不可抗力等因素。出现不可抗力情况时，公司将努力在第一时间及时修复，但因不可抗力造成的损失，公司在法律法规范围内免于承担责任。</strong></p>
            <p className="leading-relaxed mt-4"><strong>12.3 在任何情况下，公司均不对任何间接性、后果性、惩罚性、偶然性、特殊性或刑罚性的损害，包括因您使用&quot;ToryX&quot;软件及相关服务而遭受的利润损失，承担责任。</strong></p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">13. 关于单项服务与第三方服务的特殊约定</h2>
            <p className="leading-relaxed">13.1 &quot;ToryX&quot;软件及相关服务中包含公司以各种合法方式获取的信息或信息内容链接，同时也包括公司及其关联方合法运营的其他单项服务。某些单项服务可能需要您同时接受就该服务特别制订的协议或者其他规则。</p>
            <p className="leading-relaxed mt-4">13.2 您在&quot;ToryX&quot;软件及相关服务中使用第三方提供的软件及相关服务时，除遵守本协议外，还可能需要同意并遵守第三方的协议、隐私政策及相关规则。如因第三方软件及相关服务产生的争议、损失或损害，由您与第三方自行解决。</p>
            <p className="leading-relaxed mt-4"><strong>13.3 &quot;ToryX&quot;集成并使用了包括但不限于TikTok、阿里云等第三方服务。当您使用这些服务时，您同意遵守其相关服务条款。</strong></p>
          </section>

          <section className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4">14. 未成年人使用条款</h2>
            <p className="leading-relaxed"><strong>14.1 若您是未满18周岁的未成年人，您应在您的监护人监护、指导下并获得监护人同意的情况下，认真阅读并同意本协议后，方可使用&quot;ToryX&quot;软件及相关服务。</strong></p>
            <p className="leading-relaxed mt-4"><strong>14.2 公司重视对未成年人个人信息的保护，未成年用户在填写个人信息时，请加强个人保护意识并谨慎对待。</strong></p>
            <p className="leading-relaxed mt-4"><strong>14.3 未成年人用户及其监护人理解并确认，如您违反法律法规、本协议内容，则您及您的监护人应依照法律规定承担因此而可能导致的全部法律责任。</strong></p>
            <p className="leading-relaxed mt-4"><strong>14.4 未成年人用户特别提示：</strong>青少年使用&quot;ToryX&quot;软件及相关服务应该在其监护人的监督指导下，在合理范围内正确学习使用网络，避免沉迷虚拟的网络空间，养成良好上网习惯。</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">15. 其他</h2>
            <p className="leading-relaxed"><strong>15.1 本协议的成立、生效、履行、解释及争议的解决均应适用中华人民共和国法律。</strong></p>
            <p className="leading-relaxed mt-4"><strong>15.2 本协议的签署地为湖北省武汉市。若您与公司发生任何争议，双方应尽量友好协商解决，协商不成，您同意应将争议提交至公司所在地人民法院诉讼解决。</strong></p>
            <p className="leading-relaxed mt-4"><strong>15.3 为给您提供更好的服务或国家法律法规、政策调整，&quot;ToryX&quot;软件及相关服务将不时更新与变化，我们会适时对本协议进行修订。如您继续使用&quot;ToryX&quot;软件及相关服务，即表示您已同意接受修订后的本协议内容。</strong></p>
            <p className="leading-relaxed mt-4">15.4 本协议中的标题仅为方便及阅读而设，并不影响本协议中任何规定的含义或解释。</p>
            <p className="leading-relaxed mt-4">15.5 您和公司均是独立的主体，在任何情况下本协议不构成公司对用户的任何形式的明示或暗示担保或条件，双方之间亦不构成代理、合伙、合营或雇佣关系。</p>
            <p className="leading-relaxed mt-4">15.6 本协议的版权为公司所有，公司保留一切解释和修改的权利。</p>
          </section>

          <section className="bg-gradient-to-r from-cyan-500/10 to-pink-500/10 border border-cyan-500/20 rounded-xl p-6">
            <h2 className="text-2xl font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
              </svg>
              16. TikTok相关条款
            </h2>
            <p className="leading-relaxed"><strong>16.1 您在&quot;ToryX&quot;软件及相关服务中授权使用您的TikTok帐号，即视为您同意TikTok的相关服务条款。</strong></p>
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-sm text-gray-400">相关链接：</p>
              <ul className="list-disc pl-6 space-y-1 mt-2 text-sm">
                <li><a href="https://www.tiktok.com/legal/page/row/terms-of-service/en" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">TikTok 服务条款</a></li>
              </ul>
            </div>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">17. 订阅</h2>
            <p className="leading-relaxed"><strong>17.1 订阅升级和降级：</strong>从一种付费计划更改为另一种付费计划时，通过计算两个计划的剩余天数及其各自的每日费率，对新计划进行按比例分摊。</p>
            <p className="leading-relaxed mt-4"><strong>17.2 费用变更：</strong>我们可能会不时更改计划的费用，并将提前通知您。价格变更将在下一个订阅期开始时生效。如果您不同意价格变更，则必须在价格变更生效前取消订阅。</p>
            <p className="leading-relaxed mt-4"><strong>17.3 取消订阅：</strong>您可以随时取消订阅。取消后，您的订阅将在当前周期结束时失效。已支付的费用不予退还。</p>
          </section>

          <section className="border-t border-white/10 pt-8 mt-8">
            <div className="p-4 bg-white/5 rounded-lg">
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
