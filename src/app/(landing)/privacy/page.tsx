"use client";

import Link from "next/link";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield, Globe, FileText, Eye, Database, Share2, Lock, UserCheck, Cookie, Users, RefreshCw, Phone, BookOpen, Server, Key, Settings, ExternalLink } from "lucide-react";
import { useState } from "react";

export default function PrivacyPage() {
  const [lang, setLang] = useState<"en" | "zh">("zh");

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-pink-500/5 rounded-full blur-[120px]" />
      </div>

      <header className="relative z-50 border-b border-white/5 backdrop-blur-xl bg-black/20">
        <div className="container max-w-7xl mx-auto px-6 py-4">
          <nav className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-purple-500 to-pink-500 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-pink-400 bg-clip-text text-transparent">TikTok AI MCN</span>
            </Link>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-white/10 rounded-lg p-1">
                <button onClick={() => setLang("en")} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${lang === "en" ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"}`}><Globe className="h-4 w-4" />EN</button>
                <button onClick={() => setLang("zh")} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${lang === "zh" ? "bg-white/20 text-white" : "text-gray-400 hover:text-white"}`}>中文</button>
              </div>
              <Link href="/"><Button variant="ghost" className="text-gray-300 hover:text-white"><ArrowLeft className="h-4 w-4 mr-2" />{lang === "en" ? "Back" : "返回首页"}</Button></Link>
            </div>
          </nav>
        </div>
      </header>

      <main className="relative z-10 py-16">
        <div className="container max-w-4xl mx-auto px-6">
          <div className="mb-12">
            <h1 className="text-4xl font-bold mb-4">{lang === "en" ? "Privacy Policy" : "隐私政策"}</h1>
            <p className="text-gray-400">{lang === "en" ? "Updated Date: January 22, 2026" : "更新日期：2026年1月22日"}</p>
            <p className="text-gray-400">{lang === "en" ? "Effective Date: January 22, 2026" : "生效日期：2026年1月22日"}</p>
          </div>

          <div className="space-y-6 text-gray-300">
            {/* Introduction */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0"><FileText className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Introduction" : "引言"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? '"ToryX" refers to the client application labeled "ToryX (AI Content Manufacturing Factory)" and the official website, as well as the Software Development Kit (SDK) and Application Programming Interface (API) for third-party websites and applications, legally owned and operated by Wuhan Guanxing Cultural Media Co., Ltd. and its affiliates (hereinafter referred to as "we").' : '"ToryX"是指武汉观星文化传媒有限公司及其关联方（以下简称"我们"）依法拥有并运营的标注名称为"ToryX（AI内容制造工厂）"的客户端应用程序及官方网站，以及为第三方网站和应用程序提供的软件开发工具包（SDK）和应用程序编程接口（API）。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'As the operator of ToryX, we are fully aware of the importance of personal information to you, and we will protect your personal information and privacy security in accordance with laws and regulations. We have formulated this Privacy Policy and specially prompt you: We hope you carefully read and understand this Privacy Policy before using ToryX and related services so as to make appropriate choices.' : '作为ToryX的运营者，我们充分意识到个人信息对您的重要性，我们将依法保护您的个人信息和隐私安全。我们特制定本隐私政策并特别提示您：希望您在使用ToryX及相关服务前仔细阅读并理解本隐私政策，以做出适当的选择。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* Summary */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400 shrink-0"><BookOpen className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Summary" : "摘要"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'We will introduce to you how we handle personal information in different scenarios through this Privacy Policy. When you open or use ToryX, to implement the functions and services you choose to use, or to comply with laws and regulations, we will handle relevant information. Except for information necessary for ToryX\'s basic functions and services, and information required by laws and regulations, you can refuse our processing of other information, but this may result in our inability to provide corresponding functions and services.' : '我们将通过本隐私政策向您介绍我们如何在不同场景中处理个人信息。当您打开或使用ToryX时，为了实现您选择使用的功能和服务，或为了遵守法律法规，我们会处理相关信息。除ToryX基本功能和服务所必需的信息以及法律法规要求的信息外，您可以拒绝我们处理其他信息，但这可能导致我们无法提供相应的功能和服务。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'Important terms regarding your personal information rights and interests are prompted in bold, please pay special attention. The following text will help you understand in detail how we collect, use, store, transfer, disclose, and protect personal information; and help you understand the ways to query, correct, supplement, delete, copy, and transfer personal information.' : '涉及您个人信息权益的重要条款以加粗形式提示，请特别关注。以下内容将帮助您详细了解我们如何收集、使用、存储、传输、披露和保护个人信息；并帮助您了解查询、更正、补充、删除、复制和转移个人信息的方式。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 1. How We Collect and Use Personal Information */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-pink-500/10 text-pink-400 shrink-0"><Eye className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "1. How We Collect and Use Personal Information" : "一、我们如何收集和使用个人信息"}</h2>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "1.1 Account Service" : "1.1 账户服务"}</h3>
                  <p className="leading-relaxed font-medium">{lang === "en" ? "1.1.1 Registration and Login" : "1.1.1 注册和登录"}</p>
                  <p className="leading-relaxed mt-2">{lang === "en" ? 'When you register, log in to ToryX, and use related services, you can create an account via mobile phone number or email, and you can complete relevant network identity identification information (name, avatar, password). Collecting mobile phone numbers is necessary to perform national laws and regulations on network real-name registration.' : '当您注册、登录ToryX并使用相关服务时，您可以通过手机号码或邮箱创建账户，并可以完成相关网络身份识别信息（姓名、头像、密码）。收集手机号码是履行国家网络实名注册法律法规的必要条件。'}</p>
                  <p className="leading-relaxed mt-2">{lang === "en" ? 'You can register and log in to ToryX using third-party accounts, but you need to authorize us to obtain your information on the third-party platform (avatar, nickname, and other public information) to generate a ToryX account bound to that third-party account.' : '您可以使用第三方账户注册和登录ToryX，但需要授权我们获取您在第三方平台上的信息（头像、昵称等公开信息），以生成绑定到该第三方账户的ToryX账户。'}</p>

                  <p className="leading-relaxed font-medium mt-4">{lang === "en" ? "1.1.2 Real-name Authentication" : "1.1.2 实名认证"}</p>
                  <p className="leading-relaxed mt-2">{lang === "en" ? 'When you use functions or services requiring real-name authentication, to comply with relevant legal and regulatory requirements, you need to provide real identity information (real name, ID number, or facial information) to complete real-name authentication.' : '当您使用需要实名认证的功能或服务时，为遵守相关法律法规要求，您需要提供真实身份信息（真实姓名、身份证号码或人脸信息）以完成实名认证。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "1.2 Content Generation and Browsing" : "1.2 内容生成和浏览"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'During your use of ToryX to generate or browse content, we will record your usage. When you use search, we will collect your search keyword information and log records. When providing location-based content or services, with your authorization, we will use geographic location information.' : '在您使用ToryX生成或浏览内容期间，我们会记录您的使用情况。当您使用搜索时，我们会收集您的搜索关键词信息和日志记录。在提供基于位置的内容或服务时，经您授权，我们会使用地理位置信息。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "1.3 Other Functions" : "1.3 其他功能"}</h3>
                  <ul className="list-disc pl-6 space-y-2 text-gray-300 text-sm">
                    <li><strong>{lang === "en" ? "Message Notifications:" : "消息通知："}</strong> {lang === "en" ? "We may use the contact information you provided to send you notifications." : "我们可能使用您提供的联系信息向您发送通知。"}</li>
                    <li><strong>{lang === "en" ? "Sharing Interaction:" : "分享互动："}</strong> {lang === "en" ? "We need to access your clipboard to read links or share codes for jumping and sharing functions." : "我们需要访问您的剪贴板以读取链接或分享码，用于跳转和分享功能。"}</li>
                    <li><strong>{lang === "en" ? "Orders and Payments:" : "订单和支付："}</strong> {lang === "en" ? "Payment functions are provided by third-party payment institutions who may collect your payment information." : "支付功能由第三方支付机构提供，可能收集您的支付信息。"}</li>
                  </ul>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "1.4 Operation and Security Running" : "1.4 运营和安全运行"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'To maintain safe operation and quality, we will collect: hardware model, operating system version, device identifier, IP address, software version, network access method and quality data, operation and usage logs, application crash situations and performance data.' : '为维护安全运行和质量，我们会收集：硬件型号、操作系统版本、设备标识符、IP地址、软件版本、网络访问方式和质量数据、操作和使用日志、应用崩溃情况和性能数据。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "1.5 Use of Cookie and Similar Technologies" : "1.5 Cookie及类似技术的使用"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'We use Cookie or similar technologies mainly for: Ensuring security, Improving experience, Recommending content. You can clear Cookies in your browser settings.' : '我们使用Cookie或类似技术主要用于：确保安全、改善体验、推荐内容。您可以在浏览器设置中清除Cookie。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "1.6 Exemption from Consent" : "1.6 无需同意的豁免情形"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'According to law, we do not need your consent in these cases: necessary for contract performance, necessary for legal duties, necessary for public health emergencies, necessary for public interest, legally disclosed information, etc.' : '根据法律规定，以下情况无需您的同意：合同履行所必需、法定职责所必需、公共卫生紧急事件所必需、公共利益所必需、已合法公开的信息等。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 2. Partners Involved in Data Use */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-green-500/10 text-green-400 shrink-0"><Share2 className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "2. Partners Involved in Data Use and Transfer" : "二、涉及数据使用和转移的合作方"}</h2>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "2.1 Use by Partners" : "2.1 合作方使用"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'We follow principles of lawfulness, legitimacy, necessity, and security prudence. We may cooperate with third parties to provide services (such as payment, message push, real-name authentication). During the cooperation, we require partners to strictly abide by laws and data security requirements.' : '我们遵循合法、正当、必要和安全审慎的原则。我们可能与第三方合作提供服务（如支付、消息推送、实名认证）。在合作期间，我们要求合作方严格遵守法律和数据安全要求。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "2.2 Change of Operation Subject" : "2.2 运营主体变更"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'In the event of a merger, acquisition, or asset transfer, your personal information may be transferred. We will require the successor to continue to fulfill the obligations of this Privacy Policy.' : '如发生合并、收购或资产转让，您的个人信息可能会被转移。我们将要求继承方继续履行本隐私政策的义务。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "2.3 Cessation of Operation" : "2.3 停止运营"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'If operation ceases, we will promptly stop collecting and delete or anonymize your personal information, and send you a notification.' : '如停止运营，我们将及时停止收集并删除或匿名化您的个人信息，并向您发送通知。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "2.4 Disclosure" : "2.4 披露"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'Unless complying with laws and regulations or obtaining your consent, we will not actively disclose your personal information.' : '除非遵守法律法规或获得您的同意，我们不会主动披露您的个人信息。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 3. Managing Your Personal Information */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400 shrink-0"><Settings className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "3. Managing Your Personal Information" : "三、管理您的个人信息"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'We guarantee your rights to query, copy, correct, supplement, delete, withdraw consent, and cancel your account regarding personal information.' : '我们保障您对个人信息的查询、复制、更正、补充、删除、撤回同意和注销账户的权利。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'You can manage your personal information through the settings function in the application or by contacting customer service.' : '您可以通过应用程序中的设置功能或联系客服来管理您的个人信息。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'For account cancellation, you can find the cancellation entrance in "Settings - Account Security". After cancellation, we will delete or anonymize your relevant data.' : '对于账户注销，您可以在"设置 - 账户安全"中找到注销入口。注销后，我们将删除或匿名化您的相关数据。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 4. How We Protect Security */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-400 shrink-0"><Lock className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "4. How We Protect the Security of Personal Information" : "四、我们如何保护个人信息安全"}</h2>
                  <p className="leading-relaxed"><strong>{lang === "en" ? "4.1 Security Measures:" : "4.1 安全措施："}</strong> {lang === "en" ? "We adopt technical means such as encryption and de-identification, as well as strict management systems to protect your personal information." : "我们采用加密、去标识化等技术手段以及严格的管理制度来保护您的个人信息。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "4.2 Emergency Plan:" : "4.2 应急预案："}</strong> {lang === "en" ? "We establish an emergency plan for security incidents. Once a leakage or other incident occurs, we will launch it promptly and inform you." : "我们建立安全事件应急预案。一旦发生泄露或其他事件，我们将及时启动并告知您。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "4.3 Security Prompt:" : "4.3 安全提示："}</strong> {lang === "en" ? "Please understand that the internet environment is not 100% secure. Please keep your account information properly." : "请理解互联网环境并非100%安全。请妥善保管您的账户信息。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 5. How We Store Personal Information */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-orange-500/10 text-orange-400 shrink-0"><Server className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "5. How We Store Personal Information" : "五、我们如何存储个人信息"}</h2>
                  <p className="leading-relaxed"><strong>{lang === "en" ? "5.1 Storage Location:" : "5.1 存储地点："}</strong> {lang === "en" ? "Your personal information will be stored within the territory of the People's Republic of China. If cross-border transmission is required, we will follow relevant laws and regulations." : "您的个人信息将存储在中华人民共和国境内。如需跨境传输，我们将遵循相关法律法规。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "5.2 Storage Period:" : "5.2 存储期限："}</strong> {lang === "en" ? "We only retain your personal information for the period necessary to provide services. After account cancellation, we will delete or anonymize your information, unless otherwise stipulated by laws." : "我们仅在提供服务所必需的期间内保留您的个人信息。账户注销后，我们将删除或匿名化您的信息，法律另有规定除外。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 6. How We Protect Minors */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-red-500/10 text-red-400 shrink-0"><Users className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "6. How We Protect Minors" : "六、我们如何保护未成年人"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'We attach great importance to the protection of minors.' : '我们非常重视对未成年人的保护。'}</p>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li>{lang === "en" ? "If you are a minor under the age of 18, you should read and agree to this policy under the guidance of a guardian." : "如您是未满18周岁的未成年人，应在监护人的指导下阅读并同意本政策。"}</li>
                    <li>{lang === "en" ? "We will only process minors' information when permitted by law, consented to by guardians, or necessary to protect minors." : "我们仅在法律允许、监护人同意或保护未成年人所必需时处理未成年人信息。"}</li>
                  </ul>
                </div>
              </div>
            </ReflectiveCard>

            {/* 7. Access and Revision of Privacy Policy */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0"><RefreshCw className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "7. Access and Revision of Privacy Policy" : "七、隐私政策的访问和修订"}</h2>
                  <p className="leading-relaxed"><strong>{lang === "en" ? "7.1 Access:" : "7.1 访问："}</strong> {lang === "en" ? "You can view this Privacy Policy in the footer of the ToryX website or in the application settings." : "您可以在ToryX网站页脚或应用程序设置中查看本隐私政策。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "7.2 Updates:" : "7.2 更新："}</strong> {lang === "en" ? "We will revise this policy in due course and notify you through announcements or internal messages." : "我们将适时修订本政策，并通过公告或站内消息通知您。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 8. Contact Us */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-teal-500/10 text-teal-400 shrink-0"><Phone className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "8. Contact Us" : "八、联系我们"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'If you have questions, suggestions, or complaints about personal information protection issues, you can contact us:' : '如您对个人信息保护问题有疑问、建议或投诉，可以联系我们：'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? "Email to: " : "发送邮件至："}<span className="text-cyan-400">toryxai@outlook.com</span></p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'We will verify your identity and reply within fifteen working days as soon as possible.' : '我们将核实您的身份并尽快在十五个工作日内回复。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 9. Others */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-violet-500/10 text-violet-400 shrink-0"><ExternalLink className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "9. Others (Third-Party Service Statement)" : "九、其他（第三方服务声明）"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'When ToryX integrates third-party services (such as TikTok, YouTube), it will follow the data policies of relevant platforms.' : '当ToryX集成第三方服务（如TikTok、YouTube）时，将遵循相关平台的数据政策。'}</p>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li>{lang === "en" ? "If you authorize a TikTok account, it means you agree to accept the " : "如您授权TikTok账户，即表示您同意接受"}<Link href="https://www.tiktok.com/legal/privacy-policy?lang=en" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "TikTok Privacy Policy" : "TikTok隐私政策"}</Link></li>
                    <li>{lang === "en" ? "ToryX will use Google/YouTube API services. If you authorize a YouTube account, it means you agree to accept the " : "ToryX将使用Google/YouTube API服务。如您授权YouTube账户，即表示您同意接受"}<Link href="https://www.google.com/policies/privacy" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google Privacy Policy" : "Google隐私政策"}</Link></li>
                    <li>{lang === "en" ? "To revoke Google/YouTube authorization: " : "如需撤销Google/YouTube授权："}<Link href="https://security.google.com/settings/security/permissions" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google Security Settings Page" : "Google安全设置页面"}</Link></li>
                  </ul>
                </div>
              </div>
            </ReflectiveCard>

            {/* Contact Info */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-white/10 text-white shrink-0"><Key className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Contact Information" : "联系信息"}</h2>
                  <div className="grid sm:grid-cols-2 gap-4 mt-4">
                    <div>
                      <p className="text-gray-400 text-sm">{lang === "en" ? "Company" : "公司"}</p>
                      <p className="text-white">{lang === "en" ? "Wuhan Guanxing Cultural Media Co., Ltd." : "武汉观星文化传媒有限公司"}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">{lang === "en" ? "Email" : "邮箱"}</p>
                      <p className="text-white">toryxai@outlook.com</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">{lang === "en" ? "Website" : "网站"}</p>
                      <p className="text-white">toryxai.com</p>
                    </div>
                    <div>
                      <p className="text-gray-400 text-sm">{lang === "en" ? "Address" : "地址"}</p>
                      <p className="text-white">{lang === "en" ? "Wuhan, Hubei Province, China" : "中国湖北省武汉市"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </ReflectiveCard>

          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/5 py-8 bg-black/30">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-gray-500 text-sm">© {new Date().getFullYear()} {lang === "en" ? "Wuhan Guanxing Cultural Media Co., Ltd. All Rights Reserved" : "武汉观星文化传媒有限公司 版权所有"}</div>
            <div className="flex items-center gap-6 text-gray-500 text-sm">
              <Link href="/terms" className="hover:text-white transition-colors">{lang === "en" ? "Terms" : "服务条款"}</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">{lang === "en" ? "Privacy" : "隐私政策"}</Link>
              <Link href="/legal" className="hover:text-white transition-colors">{lang === "en" ? "Legal" : "法律声明"}</Link>
              <Link href="https://beian.miit.gov.cn/" target="_blank" className="hover:text-white transition-colors flex items-center gap-1"><Shield className="h-4 w-4" />鄂ICP备2023007484号</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
