"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield } from "lucide-react";

export default function TermsPage() {
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
            <h1 className="text-4xl font-bold mb-4">服务条款</h1>
            <p className="text-gray-400">最后更新日期：{new Date().toLocaleDateString("zh-CN")}</p>
          </div>

          <div className="prose prose-invert prose-lg max-w-none">
            <div className="space-y-8 text-gray-300">
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">一、总则</h2>
                <p className="leading-relaxed">
                  欢迎您使用 TikTok AI MCN 平台（以下简称"本平台"）。本服务条款（以下简称"本条款"）是您与【请填写公司名称】（以下简称"我们"或"本公司"）之间关于使用本平台服务的法律协议。
                </p>
                <p className="leading-relaxed">
                  在使用本平台服务之前，请您仔细阅读并充分理解本条款的全部内容。如您不同意本条款的任何内容，请勿使用本平台服务。一旦您开始使用本平台服务，即表示您已阅读、理解并同意接受本条款的约束。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">二、服务内容</h2>
                <p className="leading-relaxed">本平台提供以下主要服务：</p>
                <ul className="list-disc pl-6 space-y-2 mt-4">
                  <li>AI 视频生成服务：基于人工智能技术将图片或文字转化为视频内容</li>
                  <li>电商图片生成服务：提供商品展示图、模特换装图等电商图片生成服务</li>
                  <li>AI 数字人模特服务：提供虚拟数字人模特签约和使用服务</li>
                  <li>批量内容处理服务：支持批量创建和处理视频、图片任务</li>
                  <li>链接解析生成服务：通过商品链接自动生成营销内容</li>
                  <li>团队协作服务：提供多人团队管理和协作功能</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">三、用户注册与账户</h2>
                <p className="leading-relaxed">3.1 您在使用本平台服务前需要注册账户。注册时，您应提供真实、准确、完整的个人信息，并在信息发生变更时及时更新。</p>
                <p className="leading-relaxed mt-4">3.2 您应妥善保管账户信息和密码，对账户下的所有活动承担责任。如发现账户被未经授权使用，应立即通知我们。</p>
                <p className="leading-relaxed mt-4">3.3 您不得将账户转让、出借或以任何方式提供给第三方使用。</p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">四、积分与付费</h2>
                <p className="leading-relaxed">4.1 本平台采用积分制计费方式。您可以通过购买获得积分，用于消费本平台的各项服务。</p>
                <p className="leading-relaxed mt-4">4.2 积分一经购买，除法律规定的情形外，不予退款。</p>
                <p className="leading-relaxed mt-4">4.3 不同服务所需积分数量以页面显示为准，我们有权根据运营情况调整积分价格，调整前会提前公告。</p>
                <p className="leading-relaxed mt-4">4.4 积分有效期为自购买之日起一年，逾期未使用的积分将自动失效。</p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">五、用户行为规范</h2>
                <p className="leading-relaxed">您在使用本平台服务时，不得：</p>
                <ul className="list-disc pl-6 space-y-2 mt-4">
                  <li>上传、生成或传播违反法律法规的内容</li>
                  <li>侵犯他人知识产权、肖像权、隐私权等合法权益</li>
                  <li>上传或生成涉及色情、暴力、恐怖、赌博等违规内容</li>
                  <li>使用自动化工具或程序恶意访问、攻击本平台</li>
                  <li>进行任何可能损害本平台正常运营的行为</li>
                  <li>将平台服务用于任何非法目的</li>
                </ul>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">六、知识产权</h2>
                <p className="leading-relaxed">6.1 本平台的所有技术、软件、界面设计、商标、标识等知识产权归本公司所有。</p>
                <p className="leading-relaxed mt-4">6.2 您通过本平台生成的内容，在不违反法律法规和本条款的前提下，您可以自由使用。</p>
                <p className="leading-relaxed mt-4">6.3 您应确保上传的素材拥有合法的使用权，因素材权属问题导致的纠纷由您自行承担。</p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">七、免责声明</h2>
                <p className="leading-relaxed">7.1 本平台基于人工智能技术提供服务，生成内容可能存在不准确或不完善之处，您应自行判断和审核生成内容。</p>
                <p className="leading-relaxed mt-4">7.2 对于因网络状况、第三方服务等不可控因素导致的服务中断或延迟，我们不承担责任。</p>
                <p className="leading-relaxed mt-4">7.3 您使用本平台生成的内容用于商业或其他用途所产生的后果，由您自行承担。</p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">八、服务变更与终止</h2>
                <p className="leading-relaxed">8.1 我们有权根据业务需要变更、暂停或终止部分或全部服务，并会提前通知用户。</p>
                <p className="leading-relaxed mt-4">8.2 如您违反本条款，我们有权暂停或终止向您提供服务，并有权追究相关法律责任。</p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">九、法律适用与争议解决</h2>
                <p className="leading-relaxed">9.1 本条款的订立、效力、解释、履行和争议解决均适用中华人民共和国法律。</p>
                <p className="leading-relaxed mt-4">9.2 因本条款产生的争议，双方应友好协商解决；协商不成的，任何一方均可向本公司所在地有管辖权的人民法院提起诉讼。</p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">十、联系方式</h2>
                <p className="leading-relaxed">
                  如您对本条款有任何疑问，请通过以下方式联系我们：
                </p>
                <p className="leading-relaxed mt-4">
                  公司名称：【请填写公司名称】<br />
                  联系邮箱：【请填写联系邮箱】<br />
                  联系电话：【请填写联系电话】<br />
                  公司地址：【请填写公司地址】
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
