"use client";

import Link from "next/link";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield, Scale, Bookmark, Users, Cpu, AlertTriangle, Gavel, MessageSquare, Building, FileCheck, RefreshCw, Globe } from "lucide-react";
import { useState } from "react";

export default function LegalPage() {
  const [lang, setLang] = useState<"en" | "zh">("zh");

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
              <img
                src="/images/toryx_logo_text.png"
                alt="ToryX AI"
                className="h-8 drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]"
              />
            </Link>
            <div className="flex items-center gap-4">
              {/* 双语切换 */}
              <div className="flex items-center gap-2 bg-white/5 rounded-full p-1">
                <button
                  onClick={() => setLang("en")}
                  className={`px-3 py-1 rounded-full text-sm transition-all ${lang === "en" ? "bg-white text-black font-medium" : "text-gray-400 hover:text-white"}`}
                >
                  EN
                </button>
                <button
                  onClick={() => setLang("zh")}
                  className={`px-3 py-1 rounded-full text-sm transition-all ${lang === "zh" ? "bg-white text-black font-medium" : "text-gray-400 hover:text-white"}`}
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
            <h1 className="text-4xl font-bold mb-4">{lang === "en" ? "Legal Notice" : "法律声明"}</h1>
            <p className="text-gray-400">{lang === "en" ? "Last Updated: January 22, 2026" : "最后更新日期：2026年1月22日"}</p>
          </div>

          <div className="space-y-6 text-gray-300">
            {/* 1. 权利归属 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0"><Scale className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "1. Ownership of Rights" : "一、权利归属"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? '1.1 The ToryX platform (hereinafter referred to as "this Platform") is operated and managed by Wuhan Guanxing Cultural Media Co., Ltd. (hereinafter referred to as "the Company").' : '1.1 ToryX 平台（以下简称"本平台"）由武汉观星文化传媒有限公司（以下简称"本公司"）运营和管理。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '1.2 All content on this Platform, including but not limited to text, images, videos, audio, charts, logos, identifications, layout designs, column directories, software programs, databases, and other information (collectively "Platform Content"), is owned by the Company or the Company has obtained legal authorization.' : '1.2 本平台的所有内容，包括但不限于文字、图片、视频、音频、图表、标志、标识、版面设计、专栏目录、软件程序、数据库及其他信息（统称"平台内容"），其知识产权归本公司所有或本公司已获得合法授权。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '1.3 Without written permission from the Company, no one may copy, reprint, link, adapt, or otherwise use the Platform Content in any manner.' : '1.3 未经本公司书面许可，任何人不得以任何方式复制、转载、链接、改编或以其他方式使用本平台内容。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 2. 商标声明 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400 shrink-0"><Bookmark className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "2. Trademark Statement" : "二、商标声明"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? '2.1 The names, logos, icons, and related product/service names, logos, and identifications (collectively "Trademarks") used on this Platform, including "ToryX", are registered trademarks or trademarks of the Company.' : '2.1 本平台使用的"ToryX"名称、标志、图标及相关的商品/服务名称、标志、标识（统称"商标"）为本公司的注册商标或商标。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '2.2 Without written authorization from the Company, no one may display, use, or otherwise deal with these Trademarks, nor indicate to others that you have the right to do so.' : '2.2 未经本公司书面授权，任何人不得以任何方式展示、使用或做其他处理，也不得向他人表明您有权展示、使用或做其他处理。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '2.3 Other product and company names mentioned on this Platform may be trademarks of their respective owners.' : '2.3 本平台提及的其他产品和公司名称可能是其各自所有者的商标。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 3. 用户内容 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-pink-500/10 text-pink-400 shrink-0"><Users className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "3. User Content" : "三、用户内容"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? '3.1 For content uploaded, published, or transmitted by users through this Platform (including but not limited to images, videos, text, etc., collectively "User Content"), users warrant that they have complete legal rights or have obtained necessary authorization.' : '3.1 用户通过本平台上传、发布或传输的内容（包括但不限于图片、视频、文字等，统称"用户内容"），用户保证其拥有完整的合法权利或已获得必要的授权。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '3.2 User Content must not infringe any third party\'s intellectual property rights, portrait rights, privacy rights, reputation rights, or other legal rights.' : '3.2 用户内容不得侵犯任何第三方的知识产权、肖像权、隐私权、名誉权或其他合法权益。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '3.3 Users shall bear full responsibility for any disputes, conflicts, or losses arising from User Content, which are unrelated to the Company. If losses are caused to the Company, users shall compensate accordingly.' : '3.3 因用户内容引发的任何争议、纠纷或损失，由用户自行承担全部责任，与本公司无关。如给本公司造成损失，用户应予以赔偿。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 4. AI 生成内容声明 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-green-500/10 text-green-400 shrink-0"><Cpu className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "4. AI-Generated Content Statement" : "四、AI 生成内容声明"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? '4.1 The AI-generated content provided by this Platform (including images, videos, etc.) is automatically generated by artificial intelligence algorithms and may be inaccurate, incomplete, or not meet expectations.' : '4.1 本平台提供的 AI 生成内容（包括图片、视频等）由人工智能算法自动生成，可能存在不准确、不完整或不符合预期的情况。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '4.2 Users should independently review the appropriateness and legality of AI-generated content to ensure it does not infringe any third-party rights.' : '4.2 用户在使用 AI 生成内容时，应自行审核内容的适当性和合法性，确保不侵犯任何第三方权益。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '4.3 Users shall bear all consequences arising from their use of AI-generated content (including but not limited to commercial use, public release, etc.).' : '4.3 用户对 AI 生成内容的使用（包括但不限于商业使用、公开发布等）所产生的一切后果由用户自行承担。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '4.4 The Company makes no express or implied warranties regarding the accuracy, completeness, or suitability of AI-generated content.' : '4.4 本公司不对 AI 生成内容的准确性、完整性、适用性作任何明示或暗示的保证。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 5. 免责声明 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-400 shrink-0"><AlertTriangle className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "5. Disclaimer" : "五、免责声明"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? '5.1 The Company does not guarantee that Platform services will not be interrupted, nor does it make any guarantees regarding the timeliness, security, or accuracy of services.' : '5.1 本公司不保证本平台服务不会中断，对服务的及时性、安全性、准确性也不作任何保证。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '5.2 The Company shall not be liable for service interruptions or other defects caused by force majeure or reasons beyond the Company\'s control (including but not limited to hacker attacks, technical adjustments by telecommunications departments, government regulations, natural disasters, etc.).' : '5.2 对于因不可抗力或本公司无法控制的原因（包括但不限于黑客攻击、电信部门技术调整、政府管制、自然灾害等）造成的服务中断或其他缺陷，本公司不承担任何责任。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '5.3 This Platform may contain links to third-party websites or services, provided solely for user convenience. The Company assumes no responsibility for the content, privacy policies, or practices of third-party websites or services.' : '5.3 本平台可能包含指向第三方网站或服务的链接，这些链接仅为用户提供便利。本公司对第三方网站或服务的内容、隐私政策或做法不承担任何责任。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '5.4 To the maximum extent permitted by law, the Company shall not be liable for any indirect, incidental, special, punitive, or consequential damages.' : '5.4 在法律允许的最大范围内，本公司不对任何间接的、附带的、特殊的、惩罚性的或后果性的损害承担责任。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 6. 法律适用 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400 shrink-0"><Gavel className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "6. Applicable Law" : "六、法律适用"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? '6.1 The conclusion, effectiveness, interpretation, performance, and dispute resolution of this Legal Notice shall be governed by the laws of mainland China of the People\'s Republic of China (excluding conflict of law provisions).' : '6.1 本法律声明的订立、效力、解释、履行及争议解决均适用中华人民共和国大陆地区法律（不包括冲突法规定）。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '6.2 Any disputes arising from this Legal Notice shall first be resolved through friendly negotiation; if negotiation fails, either party may file a lawsuit with the competent people\'s court where the Company is located.' : '6.2 因本法律声明产生的任何争议，双方应首先通过友好协商解决；协商不成的，任何一方均可向本公司所在地有管辖权的人民法院提起诉讼。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 7. 侵权投诉 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-red-500/10 text-red-400 shrink-0"><MessageSquare className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "7. Infringement Complaints" : "七、侵权投诉"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'If you believe that content on this Platform infringes your legal rights, please contact us through the following methods:' : '如果您认为本平台上的内容侵犯了您的合法权益，请通过以下方式与我们联系：'}</p>
                  <ul className="list-disc pl-6 space-y-2 mt-4">
                    <li>{lang === "en" ? "Provide your identity verification materials" : "提供您的身份证明材料"}</li>
                    <li>{lang === "en" ? "Provide proof materials of your rights to the allegedly infringing content" : "提供您对涉嫌侵权内容拥有权利的证明材料"}</li>
                    <li>{lang === "en" ? "Provide specific links or descriptions of the allegedly infringing content" : "提供涉嫌侵权内容的具体链接或描述"}</li>
                    <li>{lang === "en" ? "Provide your contact information" : "提供您的联系方式"}</li>
                    <li>{lang === "en" ? "Sign a commitment letter guaranteeing the authenticity of the complaint" : "签署承诺书，保证投诉内容的真实性"}</li>
                  </ul>
                  <p className="leading-relaxed mt-4">{lang === "en" ? "Please send the above materials to: " : "请将上述材料发送至："}<span className="text-cyan-400">toryxai@outlook.com</span></p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'We will process valid complaints as soon as possible and respond within the time limit stipulated by law.' : '我们将在收到有效投诉后尽快处理，并在法律规定的时限内给予答复。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 8. 公司信息 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0"><Building className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "8. Company Information" : "八、公司信息"}</h2>
                  <div className="grid sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <p className="text-gray-400 text-sm">{lang === "en" ? "Company Name" : "公司名称"}</p>
                      <p className="text-white">{lang === "en" ? "Wuhan Guanxing Cultural Media Co., Ltd." : "武汉观星文化传媒有限公司"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">{lang === "en" ? "Registered Address" : "注册地址"}</p>
                      <p className="text-white">{lang === "en" ? "Wuhan, Hubei Province, China" : "中国湖北省武汉市"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">{lang === "en" ? "Contact Email" : "联系邮箱"}</p>
                      <p className="text-white">toryxai@outlook.com</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">{lang === "en" ? "Website" : "网站"}</p>
                      <p className="text-white">toryxai.com</p>
                    </div>
                  </div>
                </div>
              </div>
            </ReflectiveCard>

            {/* 9. 备案信息 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-teal-500/10 text-teal-400 shrink-0"><FileCheck className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "9. Filing Information" : "九、备案信息"}</h2>
                  <div className="grid sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <p className="text-gray-400 text-sm">{lang === "en" ? "ICP Filing Number" : "ICP备案号"}</p>
                      <p className="text-white">鄂ICP备2023007484号</p>
                    </div>
                  </div>
                </div>
              </div>
            </ReflectiveCard>

            {/* 10. 声明更新 */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-orange-500/10 text-orange-400 shrink-0"><RefreshCw className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "10. Statement Updates" : "十、声明更新"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'The Company reserves the right to modify this Legal Notice at any time. The modified Legal Notice will be published on this Platform and will take effect from the date of publication. If you continue to use the Platform services, it will be deemed that you have accepted the modified Legal Notice.' : '本公司保留随时修改本法律声明的权利。修改后的法律声明将在本平台公布，自公布之日起生效。如您继续使用本平台服务，即视为您接受修改后的法律声明。'}</p>
                </div>
              </div>
            </ReflectiveCard>

          </div>
        </div>
      </main>

      {/* 页脚 */}
      <footer className="relative z-10 border-t border-white/5 py-8 bg-black/30">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-gray-500 text-sm">
              © {new Date().getFullYear()} {lang === "en" ? "Wuhan Guanxing Cultural Media Co., Ltd. All rights reserved." : "武汉观星文化传媒有限公司 版权所有"}
            </div>
            <div className="flex items-center gap-6 text-gray-500 text-sm">
              <Link href="/terms" className="hover:text-white transition-colors">{lang === "en" ? "Terms of Service" : "服务条款"}</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">{lang === "en" ? "Privacy Policy" : "隐私政策"}</Link>
              <Link href="/legal" className="hover:text-white transition-colors">{lang === "en" ? "Legal Notice" : "法律声明"}</Link>
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
