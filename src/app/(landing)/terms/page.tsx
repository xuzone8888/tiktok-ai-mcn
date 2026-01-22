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
            <p className="leading-relaxed">7.1 All technology, software, algorithms, trademarks, logos, and platform design are owned by Wuhan Guanxing Cultural Media Co., Ltd.</p>
            <p className="leading-relaxed mt-4">7.2 You retain ownership of content you create through our platform. By using our services, you grant us a limited license to process, store, and display your content as necessary to provide our services.</p>
            <p className="leading-relaxed mt-4">7.3 For content you publicly post through our platform, you grant us a non-exclusive, royalty-free, worldwide license to display and distribute within the platform.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">8. AI-Generated Content Disclaimer</h2>
            <p className="leading-relaxed">8.1 Our services use artificial intelligence to generate content. AI-generated content may not always be accurate, appropriate, or suitable for your intended purpose.</p>
            <p className="leading-relaxed mt-4">8.2 You are responsible for reviewing all generated content before use or publication.</p>
            <p className="leading-relaxed mt-4">8.3 We do not guarantee any specific results or outcomes from our AI services.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">9. Limitation of Liability</h2>
            <p className="leading-relaxed">TO THE MAXIMUM EXTENT PERMITTED BY LAW:</p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
              <li>Our services are provided &quot;AS IS&quot; without warranties of any kind</li>
              <li>We are not liable for any indirect, incidental, special, or consequential damages</li>
              <li>Our total liability shall not exceed the amount you paid us in the 12 months preceding the claim</li>
              <li>We are not responsible for third-party actions, including TikTok&apos;s moderation decisions</li>
              <li>We are not liable for service interruptions due to factors beyond our control</li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">10. Indemnification</h2>
            <p className="leading-relaxed">You agree to indemnify and hold harmless Wuhan Guanxing Cultural Media Co., Ltd. from any claims, damages, losses, or expenses arising from your use of our services, your violation of these Terms, or content you create through our platform.</p>
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
            <p className="leading-relaxed">We may update these Terms from time to time. We will notify you of material changes via email or prominent notice on our platform. Continued use of our services after changes constitutes acceptance of the new Terms.</p>
          </section>

          <section>
            <h2 className="text-2xl font-semibold text-white mb-4">14. Contact Information</h2>
            <p className="leading-relaxed">For questions about these Terms, please contact us:</p>
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
