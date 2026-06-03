"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield, Globe, FileText, Users, AlertTriangle, Scale, Clock, Lock, CreditCard, Gavel, Building2, Mail } from "lucide-react";
import { useState } from "react";

export default function TermsPage() {
  const [lang, setLang] = useState<"en" | "zh">("zh");
  const lastUpdated = lang === "en" ? "January 22, 2026" : "2026年01月22日";

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* 背景装饰 */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-white/[0.02] rounded-full blur-[120px]" />
      </div>

      {/* 导航栏 */}
      <header className="relative z-50 border-b border-white/5 backdrop-blur-xl bg-black/20">
        <div className="container max-w-7xl mx-auto px-6 py-4">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-11 h-11 rounded-xl bg-[#1a1a1a] border border-white/20 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="text-xl font-bold text-white">Star Gaze</span>
                <span className="text-[10px] text-gray-500 tracking-wider uppercase">
                  AI 内容智造工厂
                </span>
              </div>
            </Link>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-white/10 rounded-lg p-1">
                <button
                  onClick={() => setLang("en")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${lang === "en" ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"}`}
                >
                  <Globe className="h-4 w-4" />
                  EN
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
                  {lang === "en" ? "Back" : "返回首页"}
                </Button>
              </Link>
            </div>
          </nav>
        </div>
      </header>

      {/* 内容 */}
      <main className="relative z-10 py-16">
        <div className="container max-w-4xl mx-auto px-6">
          <div className="mb-12">
            <h1 className="text-4xl font-bold mb-4">{lang === "en" ? "Terms of Service" : "服务条款"}</h1>
            <p className="text-gray-400">{lang === "en" ? "Last Updated: " : "最后更新日期："}{lastUpdated}</p>
          </div>

          <div className="prose prose-invert prose-lg max-w-none">
            <div className="space-y-6 text-gray-300">

              {/* 1. 服务条款接受 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "1. Acceptance of Terms" : "一、服务条款接受"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>1.1 By accessing or using Star Gaze platform, you agree to be bound by these Terms of Service.</li>
                          <li>1.2 If you do not agree to these terms, please do not use our services.</li>
                          <li>1.3 We reserve the right to modify these terms at any time. Continued use constitutes acceptance of changes.</li>
                        </>
                      ) : (
                        <>
                          <li>1.1 访问或使用 Star Gaze 平台即表示您同意接受本服务条款的约束。</li>
                          <li>1.2 如果您不同意这些条款，请勿使用我们的服务。</li>
                          <li>1.3 我们保留随时修改这些条款的权利，继续使用即表示接受更改。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 2. 用户资格 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Users className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "2. User Eligibility" : "二、用户资格"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>2.1 You must be at least 18 years old to use our services.</li>
                          <li>2.2 You must provide accurate and complete registration information.</li>
                          <li>2.3 You are responsible for maintaining the security of your account credentials.</li>
                        </>
                      ) : (
                        <>
                          <li>2.1 您必须年满 18 周岁才能使用我们的服务。</li>
                          <li>2.2 您必须提供准确、完整的注册信息。</li>
                          <li>2.3 您有责任维护账户凭证的安全性。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 3. AI 生成内容 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "3. AI Generated Content" : "三、AI 生成内容"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>3.1 Content generated through our platform is created using AI technology.</li>
                          <li>3.2 You retain usage rights to content you generate, subject to our licensing terms.</li>
                          <li>3.3 We do not guarantee the accuracy or suitability of AI-generated content.</li>
                          <li>3.4 You are solely responsible for reviewing and validating generated content before use.</li>
                        </>
                      ) : (
                        <>
                          <li>3.1 通过我们平台生成的内容由 AI 技术创建。</li>
                          <li>3.2 在遵守我们许可条款的前提下，您保留对所生成内容的使用权。</li>
                          <li>3.3 我们不保证 AI 生成内容的准确性或适用性。</li>
                          <li>3.4 您对使用前审核和验证生成内容负全部责任。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 4. 禁止行为 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <AlertTriangle className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "4. Prohibited Conduct" : "四、禁止行为"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>4.1 Creating content that violates laws or regulations.</li>
                          <li>4.2 Generating pornographic, violent, or harmful content.</li>
                          <li>4.3 Infringing on intellectual property rights of others.</li>
                          <li>4.4 Attempting to reverse engineer or exploit our systems.</li>
                          <li>4.5 Using the service for fraudulent or deceptive purposes.</li>
                        </>
                      ) : (
                        <>
                          <li>4.1 创建违反法律法规的内容。</li>
                          <li>4.2 生成色情、暴力或有害内容。</li>
                          <li>4.3 侵犯他人的知识产权。</li>
                          <li>4.4 试图逆向工程或利用我们的系统。</li>
                          <li>4.5 将服务用于欺诈或欺骗目的。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 5. 付款和订阅 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <CreditCard className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "5. Payment and Subscription" : "五、付款和订阅"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>5.1 Certain features require paid subscription or credits.</li>
                          <li>5.2 All payments are processed securely through authorized payment providers.</li>
                          <li>5.3 Subscription fees are billed in advance and are non-refundable unless otherwise stated.</li>
                          <li>5.4 We reserve the right to modify pricing with 30 days notice.</li>
                        </>
                      ) : (
                        <>
                          <li>5.1 某些功能需要付费订阅或积分。</li>
                          <li>5.2 所有付款均通过授权的支付提供商安全处理。</li>
                          <li>5.3 订阅费用预先收取，除非另有说明，否则不予退款。</li>
                          <li>5.4 我们保留提前 30 天通知后修改定价的权利。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 6. 知识产权 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Scale className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "6. Intellectual Property" : "六、知识产权"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>6.1 Star Gaze platform, including all software, designs, and content, is owned by Wuhan Guanxing Cultural Media Co., Ltd.</li>
                          <li>6.2 You may not copy, modify, or distribute our platform without written permission.</li>
                          <li>6.3 User-generated content remains the property of the user, subject to our license to host and display it.</li>
                        </>
                      ) : (
                        <>
                          <li>6.1 Star Gaze 平台（包括所有软件、设计和内容）由武汉观星文化传媒有限公司所有。</li>
                          <li>6.2 未经书面许可，您不得复制、修改或分发我们的平台。</li>
                          <li>6.3 用户生成的内容仍归用户所有，但受我们托管和展示许可的约束。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 7. 免责声明 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Shield className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "7. Disclaimer" : "七、免责声明"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>7.1 Our service is provided &quot;as is&quot; without warranties of any kind.</li>
                          <li>7.2 We do not guarantee uninterrupted or error-free service.</li>
                          <li>7.3 We are not liable for any indirect, incidental, or consequential damages.</li>
                        </>
                      ) : (
                        <>
                          <li>7.1 我们的服务按&quot;原样&quot;提供，不提供任何形式的保证。</li>
                          <li>7.2 我们不保证服务不间断或无错误。</li>
                          <li>7.3 我们对任何间接、附带或后果性损害不承担责任。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 8. 服务终止 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Clock className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "8. Termination" : "八、服务终止"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>8.1 We may terminate or suspend your account for violation of these terms.</li>
                          <li>8.2 You may cancel your account at any time through account settings.</li>
                          <li>8.3 Upon termination, your right to use the service ceases immediately.</li>
                        </>
                      ) : (
                        <>
                          <li>8.1 如果您违反这些条款，我们可能会终止或暂停您的账户。</li>
                          <li>8.2 您可以随时通过账户设置取消账户。</li>
                          <li>8.3 终止后，您使用服务的权利立即停止。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 9. 法律管辖 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Gavel className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "9. Governing Law" : "九、法律管辖"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>9.1 These terms are governed by the laws of the People&apos;s Republic of China.</li>
                          <li>9.2 Any disputes shall be resolved through arbitration in Wuhan, China.</li>
                        </>
                      ) : (
                        <>
                          <li>9.1 本条款受中华人民共和国法律管辖。</li>
                          <li>9.2 任何争议应通过在中国武汉进行仲裁解决。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 联系方式 */}
              <section className="grid md:grid-cols-2 gap-6">
                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-gray-400" />
                    {lang === "en" ? "Company" : "公司信息"}
                  </h3>
                  <div className="space-y-2 text-sm text-gray-400">
                    <p><span className="text-gray-500">{lang === "en" ? "Name: " : "公司名称："}</span>{lang === "en" ? "Wuhan Guanxing Cultural Media Co., Ltd." : "武汉观星文化传媒有限公司"}</p>
                    <p><span className="text-gray-500">{lang === "en" ? "Location: " : "地址："}</span>{lang === "en" ? "Wuhan, Hubei, China" : "中国湖北省武汉市"}</p>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <Mail className="h-5 w-5 text-gray-400" />
                    {lang === "en" ? "Contact" : "联系方式"}
                  </h3>
                  <div className="space-y-2 text-sm text-gray-400">
                    <p><span className="text-gray-500">{lang === "en" ? "Email: " : "邮箱："}</span>toryxai@outlook.com</p>
                  </div>
                </div>
              </section>

            </div>
          </div>
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
              <Link href="/terms" className="hover:text-white transition-colors">{lang === "en" ? "Terms" : "服务条款"}</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">{lang === "en" ? "Privacy" : "隐私政策"}</Link>
              <Link href="/legal" className="hover:text-white transition-colors">{lang === "en" ? "Legal" : "法律声明"}</Link>
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
