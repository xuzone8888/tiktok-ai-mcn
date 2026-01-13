"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield } from "lucide-react";

export default function LegalPage() {
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
            <h1 className="text-4xl font-bold mb-4">法律声明</h1>
            <p className="text-gray-400">最后更新日期：{new Date().toLocaleDateString("zh-CN")}</p>
          </div>

          <div className="prose prose-invert prose-lg max-w-none">
            <div className="space-y-8 text-gray-300">
              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">一、权利归属</h2>
                <p className="leading-relaxed">
                  1.1 TikTok AI MCN 平台（以下简称"本平台"）由【请填写公司名称】（以下简称"本公司"）运营和管理。
                </p>
                <p className="leading-relaxed mt-4">
                  1.2 本平台的所有内容，包括但不限于文字、图片、视频、音频、图表、标志、标识、版面设计、专栏目录、软件程序、数据库及其他信息（统称"平台内容"），其知识产权归本公司所有或本公司已获得合法授权。
                </p>
                <p className="leading-relaxed mt-4">
                  1.3 未经本公司书面许可，任何人不得以任何方式复制、转载、链接、改编或以其他方式使用本平台内容。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">二、商标声明</h2>
                <p className="leading-relaxed">
                  2.1 本平台使用的 &ldquo;TikTok AI MCN&rdquo; 名称、标志、图标及相关的商品/服务名称、标志、标识（统称"商标"）为本公司的注册商标或商标。
                </p>
                <p className="leading-relaxed mt-4">
                  2.2 未经本公司书面授权，任何人不得以任何方式展示、使用或做其他处理，也不得向他人表明您有权展示、使用或做其他处理。
                </p>
                <p className="leading-relaxed mt-4">
                  2.3 本平台提及的其他产品和公司名称可能是其各自所有者的商标。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">三、用户内容</h2>
                <p className="leading-relaxed">
                  3.1 用户通过本平台上传、发布或传输的内容（包括但不限于图片、视频、文字等，统称"用户内容"），用户保证其拥有完整的合法权利或已获得必要的授权。
                </p>
                <p className="leading-relaxed mt-4">
                  3.2 用户内容不得侵犯任何第三方的知识产权、肖像权、隐私权、名誉权或其他合法权益。
                </p>
                <p className="leading-relaxed mt-4">
                  3.3 因用户内容引发的任何争议、纠纷或损失，由用户自行承担全部责任，与本公司无关。如给本公司造成损失，用户应予以赔偿。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">四、AI 生成内容声明</h2>
                <p className="leading-relaxed">
                  4.1 本平台提供的 AI 生成内容（包括图片、视频等）由人工智能算法自动生成，可能存在不准确、不完整或不符合预期的情况。
                </p>
                <p className="leading-relaxed mt-4">
                  4.2 用户在使用 AI 生成内容时，应自行审核内容的适当性和合法性，确保不侵犯任何第三方权益。
                </p>
                <p className="leading-relaxed mt-4">
                  4.3 用户对 AI 生成内容的使用（包括但不限于商业使用、公开发布等）所产生的一切后果由用户自行承担。
                </p>
                <p className="leading-relaxed mt-4">
                  4.4 本公司不对 AI 生成内容的准确性、完整性、适用性作任何明示或暗示的保证。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">五、免责声明</h2>
                <p className="leading-relaxed">
                  5.1 本公司不保证本平台服务不会中断，对服务的及时性、安全性、准确性也不作任何保证。
                </p>
                <p className="leading-relaxed mt-4">
                  5.2 对于因不可抗力或本公司无法控制的原因（包括但不限于黑客攻击、电信部门技术调整、政府管制、自然灾害等）造成的服务中断或其他缺陷，本公司不承担任何责任。
                </p>
                <p className="leading-relaxed mt-4">
                  5.3 本平台可能包含指向第三方网站或服务的链接，这些链接仅为用户提供便利。本公司对第三方网站或服务的内容、隐私政策或做法不承担任何责任。
                </p>
                <p className="leading-relaxed mt-4">
                  5.4 在法律允许的最大范围内，本公司不对任何间接的、附带的、特殊的、惩罚性的或后果性的损害承担责任。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">六、法律适用</h2>
                <p className="leading-relaxed">
                  6.1 本法律声明的订立、效力、解释、履行及争议解决均适用中华人民共和国大陆地区法律（不包括冲突法规定）。
                </p>
                <p className="leading-relaxed mt-4">
                  6.2 因本法律声明产生的任何争议，双方应首先通过友好协商解决；协商不成的，任何一方均可向本公司所在地有管辖权的人民法院提起诉讼。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">七、侵权投诉</h2>
                <p className="leading-relaxed">
                  如果您认为本平台上的内容侵犯了您的合法权益，请通过以下方式与我们联系：
                </p>
                <ul className="list-disc pl-6 space-y-2 mt-4">
                  <li>提供您的身份证明材料</li>
                  <li>提供您对涉嫌侵权内容拥有权利的证明材料</li>
                  <li>提供涉嫌侵权内容的具体链接或描述</li>
                  <li>提供您的联系方式</li>
                  <li>签署承诺书，保证投诉内容的真实性</li>
                </ul>
                <p className="leading-relaxed mt-4">
                  请将上述材料发送至：【请填写投诉邮箱】
                </p>
                <p className="leading-relaxed mt-4">
                  我们将在收到有效投诉后尽快处理，并在法律规定的时限内给予答复。
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">八、公司信息</h2>
                <p className="leading-relaxed">
                  公司名称：【请填写公司名称】<br />
                  统一社会信用代码：【请填写统一社会信用代码】<br />
                  注册地址：【请填写注册地址】<br />
                  经营地址：【请填写经营地址】<br />
                  联系电话：【请填写联系电话】<br />
                  联系邮箱：【请填写联系邮箱】
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">九、备案信息</h2>
                <p className="leading-relaxed">
                  网站备案号：【请填写ICP备案号】<br />
                  增值电信业务经营许可证：【如有请填写】<br />
                  网络文化经营许可证：【如有请填写】
                </p>
              </section>

              <section>
                <h2 className="text-2xl font-semibold text-white mb-4">十、声明更新</h2>
                <p className="leading-relaxed">
                  本公司保留随时修改本法律声明的权利。修改后的法律声明将在本平台公布，自公布之日起生效。如您继续使用本平台服务，即视为您接受修改后的法律声明。
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
