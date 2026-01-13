"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield } from "lucide-react";

export default function PrivacyPage() {
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
                TikTok AI MCN
              </span>
            </Link>
            <Link href="/">
              <Button variant="ghost" className="text-gray-300 hover:text-white">
                <ArrowLeft className="h-4 w-4 mr-2" />
                返回首页
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* 内容 */}
      <main className="relative z-10 py-16">
        <div className="container max-w-4xl mx-auto px-6">
          <div className="mb-12">
            <h1 className="text-4xl font-bold mb-4">隐私政策</h1>
            <p className="text-gray-400">最后更新日期：{new Date().toLocaleDateString("zh-CN")}</p>
          </div>

          <div className="prose prose-invert prose-lg max-w-none">
            <div className="space-y-8 text-gray-300">
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">引言</h2>
                <p className="leading-relaxed">
                  【请填写公司名称】（以下简称"我们"）非常重视用户的隐私保护。本隐私政策旨在向您说明我们如何收集、使用、存储和保护您的个人信息，以及您享有的相关权利。
                </p>
                <p className="leading-relaxed mt-4">
                  请您在使用我们的服务前，仔细阅读并理解本隐私政策。一旦您开始使用我们的服务，即表示您已阅读并同意本隐私政策。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">一、我们收集的信息</h2>
                
                <h3 className="text-xl font-medium text-white mt-6 mb-3">1.1 您主动提供的信息</h3>
                <ul className="list-disc pl-6 space-y-2">
                  <li>账户注册信息：用户名、邮箱地址、手机号码、密码</li>
                  <li>个人资料信息：头像、昵称、个人简介</li>
                  <li>支付信息：支付账户信息（我们不存储完整的银行卡号或支付密码）</li>
                  <li>上传内容：您上传的图片、视频等素材</li>
                  <li>反馈信息：您向我们提交的问题、建议、投诉等</li>
                </ul>

                <h3 className="text-xl font-medium text-white mt-6 mb-3">1.2 自动收集的信息</h3>
                <ul className="list-disc pl-6 space-y-2">
                  <li>设备信息：设备型号、操作系统版本、唯一设备标识符</li>
                  <li>日志信息：IP 地址、访问时间、浏览页面、点击记录</li>
                  <li>使用数据：功能使用频率、操作习惯、服务使用记录</li>
                  <li>Cookie 信息：用于维持登录状态和改善用户体验</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">二、信息使用目的</h2>
                <p className="leading-relaxed">我们收集您的信息用于以下目的：</p>
                <ul className="list-disc pl-6 space-y-2 mt-4">
                  <li>提供、维护和改进我们的服务</li>
                  <li>处理您的注册、登录和账户管理</li>
                  <li>处理您的订单和支付请求</li>
                  <li>向您发送服务通知和重要更新</li>
                  <li>提供客户支持和响应您的请求</li>
                  <li>进行数据分析以改进产品和服务</li>
                  <li>防止欺诈和保障平台安全</li>
                  <li>遵守法律法规和监管要求</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">三、信息共享与披露</h2>
                <p className="leading-relaxed">
                  我们不会出售您的个人信息。在以下情况下，我们可能会共享您的信息：
                </p>
                <ul className="list-disc pl-6 space-y-2 mt-4">
                  <li><strong>服务提供商：</strong>与帮助我们运营服务的第三方服务商共享必要信息（如支付处理、云服务）</li>
                  <li><strong>法律要求：</strong>根据法律法规、法律程序或政府机关的强制性要求</li>
                  <li><strong>业务转让：</strong>在合并、收购或资产出售的情况下，您的信息可能作为资产转让</li>
                  <li><strong>用户同意：</strong>在获得您明确同意的其他情况下</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">四、信息存储与保护</h2>
                <p className="leading-relaxed">4.1 我们将您的信息存储在中华人民共和国境内的安全服务器上。</p>
                <p className="leading-relaxed mt-4">4.2 我们采用行业标准的安全措施保护您的信息，包括：</p>
                <ul className="list-disc pl-6 space-y-2 mt-4">
                  <li>数据传输加密（SSL/TLS）</li>
                  <li>数据存储加密</li>
                  <li>访问控制和权限管理</li>
                  <li>安全审计和监控</li>
                  <li>员工安全意识培训</li>
                </ul>
                <p className="leading-relaxed mt-4">4.3 我们仅在实现目的所必需的期限内保留您的个人信息，除非法律要求更长的保留期限。</p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">五、您的权利</h2>
                <p className="leading-relaxed">根据相关法律法规，您享有以下权利：</p>
                <ul className="list-disc pl-6 space-y-2 mt-4">
                  <li><strong>访问权：</strong>您有权访问我们持有的您的个人信息</li>
                  <li><strong>更正权：</strong>您有权要求更正不准确或不完整的个人信息</li>
                  <li><strong>删除权：</strong>在特定情况下，您有权要求删除您的个人信息</li>
                  <li><strong>撤回同意：</strong>您可以随时撤回之前给予的同意</li>
                  <li><strong>账户注销：</strong>您可以申请注销您的账户</li>
                </ul>
                <p className="leading-relaxed mt-4">
                  如需行使上述权利，请通过本政策末尾的联系方式与我们联系。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">六、Cookie 使用</h2>
                <p className="leading-relaxed">
                  我们使用 Cookie 和类似技术来：
                </p>
                <ul className="list-disc pl-6 space-y-2 mt-4">
                  <li>保持您的登录状态</li>
                  <li>记住您的偏好设置</li>
                  <li>分析服务使用情况</li>
                  <li>提供个性化体验</li>
                </ul>
                <p className="leading-relaxed mt-4">
                  您可以通过浏览器设置管理 Cookie，但禁用 Cookie 可能影响服务的正常使用。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">七、未成年人保护</h2>
                <p className="leading-relaxed">
                  我们的服务主要面向成年人。如果您未满 18 周岁，请在法定监护人的陪同下阅读本隐私政策，并在取得监护人同意后使用我们的服务。
                </p>
                <p className="leading-relaxed mt-4">
                  如果我们发现在未经监护人同意的情况下收集了未成年人的个人信息，我们将采取措施尽快删除相关信息。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">八、隐私政策更新</h2>
                <p className="leading-relaxed">
                  我们可能会不时更新本隐私政策。更新后的政策将在本页面发布，并注明更新日期。对于重大变更，我们会通过站内通知或邮件等方式告知您。
                </p>
                <p className="leading-relaxed mt-4">
                  建议您定期查阅本政策，以了解我们如何保护您的信息。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">九、联系我们</h2>
                <p className="leading-relaxed">
                  如果您对本隐私政策有任何疑问、意见或建议，或需要行使您的个人信息权利，请通过以下方式联系我们：
                </p>
                <p className="leading-relaxed mt-4">
                  公司名称：【请填写公司名称】<br />
                  隐私保护负责人邮箱：【请填写邮箱】<br />
                  联系电话：【请填写联系电话】<br />
                  公司地址：【请填写公司地址】
                </p>
                <p className="leading-relaxed mt-4">
                  我们将在收到您的请求后 15 个工作日内予以回复。
                </p>
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
              © {new Date().getFullYear()} 【请填写公司名称】 版权所有
            </div>
            <div className="flex items-center gap-6 text-gray-500 text-sm">
              <Link href="/terms" className="hover:text-white transition-colors">服务条款</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">隐私政策</Link>
              <Link href="/legal" className="hover:text-white transition-colors">法律声明</Link>
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
