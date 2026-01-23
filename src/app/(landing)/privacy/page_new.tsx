"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield, Globe, Eye, Database, Lock, Share2, Cookie, UserCheck, Clock, Mail, Building2 } from "lucide-react";
import { useState } from "react";

export default function PrivacyPage() {
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
                <span className="text-xl font-bold text-white">ToryX</span>
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
            <h1 className="text-4xl font-bold mb-4">{lang === "en" ? "Privacy Policy" : "隐私政策"}</h1>
            <p className="text-gray-400">{lang === "en" ? "Last Updated: " : "最后更新日期："}{lastUpdated}</p>
          </div>

          <div className="prose prose-invert prose-lg max-w-none">
            <div className="space-y-6 text-gray-300">

              {/* 1. 信息收集 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Eye className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "1. Information We Collect" : "一、我们收集的信息"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>1.1 <strong>Account Information:</strong> Email, username, password (encrypted), and profile details.</li>
                          <li>1.2 <strong>Usage Data:</strong> Features used, content generated, and interaction patterns.</li>
                          <li>1.3 <strong>Device Information:</strong> IP address, browser type, operating system, and device identifiers.</li>
                          <li>1.4 <strong>Payment Information:</strong> Transaction records (processed by third-party providers).</li>
                        </>
                      ) : (
                        <>
                          <li>1.1 <strong>账户信息：</strong>电子邮件、用户名、密码（加密存储）和个人资料详情。</li>
                          <li>1.2 <strong>使用数据：</strong>使用的功能、生成的内容和交互模式。</li>
                          <li>1.3 <strong>设备信息：</strong>IP 地址、浏览器类型、操作系统和设备标识符。</li>
                          <li>1.4 <strong>支付信息：</strong>交易记录（由第三方支付提供商处理）。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 2. 信息使用 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Database className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "2. How We Use Information" : "二、我们如何使用信息"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>2.1 To provide, maintain, and improve our services.</li>
                          <li>2.2 To personalize your experience and content recommendations.</li>
                          <li>2.3 To process transactions and send related communications.</li>
                          <li>2.4 To detect and prevent fraud, abuse, and security incidents.</li>
                          <li>2.5 To comply with legal obligations and enforce our policies.</li>
                        </>
                      ) : (
                        <>
                          <li>2.1 提供、维护和改进我们的服务。</li>
                          <li>2.2 个性化您的体验和内容推荐。</li>
                          <li>2.3 处理交易并发送相关通讯。</li>
                          <li>2.4 检测和防止欺诈、滥用和安全事件。</li>
                          <li>2.5 遵守法律义务并执行我们的政策。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 3. 数据安全 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Lock className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "3. Data Security" : "三、数据安全"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>3.1 We use industry-standard encryption (SSL/TLS) for data transmission.</li>
                          <li>3.2 Passwords are stored using secure hashing algorithms.</li>
                          <li>3.3 Access to personal data is restricted to authorized personnel only.</li>
                          <li>3.4 We conduct regular security audits and vulnerability assessments.</li>
                        </>
                      ) : (
                        <>
                          <li>3.1 我们使用行业标准加密（SSL/TLS）进行数据传输。</li>
                          <li>3.2 密码使用安全哈希算法存储。</li>
                          <li>3.3 个人数据访问仅限于授权人员。</li>
                          <li>3.4 我们定期进行安全审计和漏洞评估。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 4. 信息共享 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Share2 className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "4. Information Sharing" : "四、信息共享"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>4.1 We do not sell your personal information to third parties.</li>
                          <li>4.2 We may share data with service providers who assist in our operations.</li>
                          <li>4.3 We may disclose information when required by law or legal process.</li>
                          <li>4.4 In case of merger or acquisition, user data may be transferred.</li>
                        </>
                      ) : (
                        <>
                          <li>4.1 我们不会将您的个人信息出售给第三方。</li>
                          <li>4.2 我们可能会与协助我们运营的服务提供商共享数据。</li>
                          <li>4.3 当法律或法律程序要求时，我们可能会披露信息。</li>
                          <li>4.4 在合并或收购的情况下，用户数据可能会被转移。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 5. Cookie 政策 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Cookie className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "5. Cookies & Tracking" : "五、Cookie 与追踪技术"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>5.1 We use cookies to maintain session state and remember preferences.</li>
                          <li>5.2 Analytics cookies help us understand how users interact with our platform.</li>
                          <li>5.3 You can manage cookie preferences through your browser settings.</li>
                          <li>5.4 Disabling cookies may affect certain features of our service.</li>
                        </>
                      ) : (
                        <>
                          <li>5.1 我们使用 Cookie 来维护会话状态和记住偏好。</li>
                          <li>5.2 分析 Cookie 帮助我们了解用户如何与平台互动。</li>
                          <li>5.3 您可以通过浏览器设置管理 Cookie 偏好。</li>
                          <li>5.4 禁用 Cookie 可能会影响我们服务的某些功能。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 6. 用户权利 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <UserCheck className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "6. Your Rights" : "六、您的权利"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>6.1 <strong>Access:</strong> Request a copy of your personal data.</li>
                          <li>6.2 <strong>Correction:</strong> Update or correct inaccurate information.</li>
                          <li>6.3 <strong>Deletion:</strong> Request deletion of your personal data.</li>
                          <li>6.4 <strong>Portability:</strong> Receive your data in a portable format.</li>
                          <li>6.5 <strong>Opt-out:</strong> Unsubscribe from marketing communications.</li>
                        </>
                      ) : (
                        <>
                          <li>6.1 <strong>访问权：</strong>请求获取您个人数据的副本。</li>
                          <li>6.2 <strong>更正权：</strong>更新或更正不准确的信息。</li>
                          <li>6.3 <strong>删除权：</strong>请求删除您的个人数据。</li>
                          <li>6.4 <strong>可携带权：</strong>以可移植格式接收您的数据。</li>
                          <li>6.5 <strong>退出权：</strong>取消订阅营销通讯。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 7. 数据保留 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Clock className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "7. Data Retention" : "七、数据保留"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>7.1 We retain personal data for as long as your account is active.</li>
                          <li>7.2 After account deletion, data is removed within 30 days.</li>
                          <li>7.3 Some data may be retained longer for legal or regulatory compliance.</li>
                        </>
                      ) : (
                        <>
                          <li>7.1 我们在您的账户活跃期间保留个人数据。</li>
                          <li>7.2 账户删除后，数据将在 30 天内删除。</li>
                          <li>7.3 某些数据可能因法律或监管合规要求而保留更长时间。</li>
                        </>
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 8. 儿童隐私 */}
              <section className="bg-white/5 border border-white/10 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-lg bg-white/5 text-white shrink-0">
                    <Shield className="h-6 w-6" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white mb-3 mt-1">{lang === "en" ? "8. Children's Privacy" : "八、儿童隐私"}</h2>
                    <ul className="space-y-2 text-sm text-gray-400">
                      {lang === "en" ? (
                        <>
                          <li>8.1 Our service is not intended for users under 18 years of age.</li>
                          <li>8.2 We do not knowingly collect data from minors.</li>
                          <li>8.3 If we discover such data, we will delete it promptly.</li>
                        </>
                      ) : (
                        <>
                          <li>8.1 我们的服务不面向 18 岁以下的用户。</li>
                          <li>8.2 我们不会故意收集未成年人的数据。</li>
                          <li>8.3 如果我们发现此类数据，将立即删除。</li>
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
