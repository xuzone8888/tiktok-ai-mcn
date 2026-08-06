"use client";

import Link from "next/link";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles, Shield, Globe, FileText, Eye, Database, Share2, Lock, UserCheck, Cookie, Users, RefreshCw, Phone, BookOpen, Server, Key, Settings, ExternalLink, ShoppingBag, Cpu, Youtube } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

export default function PrivacyPage() {
  const { lang, setLang } = useLang();

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
              <span className="text-lg font-bold text-white drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                Star Gaze
              </span>
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
            <h1 className="text-4xl font-bold mb-4">{lang === "en" ? "Privacy Policy - Wuhan Guanxing Cultural Media Co., Ltd. (Star Gaze)" : "隐私政策 - 武汉观星文化传媒有限公司 (Star Gaze)"}</h1>
            <p className="text-gray-400">{lang === "en" ? "Updated Date: July 23, 2026" : "更新日期：2026年7月23日"}</p>
            <p className="text-gray-400">{lang === "en" ? "Effective Date: July 23, 2026" : "生效日期：2026年7月23日"}</p>
          </div>

          <div className="space-y-6 text-gray-300">
            {/* Introduction */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0"><FileText className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Introduction" : "引言"}</h2>
                  <p className="leading-relaxed font-semibold text-white/80 mb-4">{lang === "en" ? 'This Privacy Policy explains how Wuhan Guanxing Cultural Media Co., Ltd. ("Company", "we", "us"), operating under the brand name Star Gaze, collects, uses, stores, and protects personal information when users access our website, services, and integrations with TikTok, Facebook, YouTube, and other supported platforms.' : '本隐私政策说明武汉观星文化传媒有限公司（以下简称"本公司"）作为 Star Gaze 品牌运营方，在用户访问本网站、使用本服务及 TikTok、Facebook、YouTube 和其他受支持平台的集成能力时，如何收集、使用、存储和保护个人信息。'}</p>
                  <p className="leading-relaxed">{lang === "en" ? '"Star Gaze" refers to the client application labeled "Star Gaze" and the official website, as well as the Software Development Kit (SDK) and Application Programming Interface (API) for third-party websites and applications, legally owned and operated by Wuhan Guanxing Cultural Media Co., Ltd. and its affiliates (hereinafter referred to as "we").' : '"Star Gaze"是指武汉观星文化传媒有限公司及其关联方（以下简称"我们"）依法拥有并运营的标注名称为"Star Gaze"的客户端应用程序及官方网站，以及为第三方网站和应用程序提供的软件开发工具包（SDK）和应用程序编程接口（API）。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'As the operator of Star Gaze, we are fully aware of the importance of personal information to you, and we will protect your personal information and privacy security in accordance with laws and regulations. We have formulated this Privacy Policy and specially prompt you: We hope you carefully read and understand this Privacy Policy before using Star Gaze and related services so as to make appropriate choices.' : '作为 Star Gaze 的运营者，我们充分意识到个人信息对您的重要性，我们将依法保护您的个人信息和隐私安全。我们特制定本隐私政策并特别提示您：希望您在使用 Star Gaze 及相关服务前仔细阅读并理解本隐私政策，以做出适当的选择。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* Summary */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400 shrink-0"><BookOpen className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Summary" : "摘要"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'We will introduce to you how we handle personal information in different scenarios through this Privacy Policy. When you open or use Star Gaze, to implement the functions and services you choose to use, or to comply with laws and regulations, we will handle relevant information. Except for information necessary for Star Gaze\'s basic functions and services, and information required by laws and regulations, you can refuse our processing of other information, but this may result in our inability to provide corresponding functions and services.' : '我们将通过本隐私政策向您介绍我们如何在不同场景中处理个人信息。当您打开或使用 Star Gaze 时，为了实现您选择使用的功能和服务，或为了遵守法律法规，我们会处理相关信息。除Star Gaze 基本功能和服务所必需的信息以及法律法规要求的信息外，您可以拒绝我们处理其他信息，但这可能导致我们无法提供相应的功能和服务。'}</p>
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
                  <p className="leading-relaxed mt-2">{lang === "en" ? 'When you register, log in to Star Gaze, and use related services, you can create an account via mobile phone number or email, and you can complete relevant network identity identification information (name, avatar, password). Collecting mobile phone numbers is necessary to perform national laws and regulations on network real-name registration.' : '当您注册、登录 Star Gaze并使用相关服务时，您可以通过手机号码或邮箱创建账户，并可以完成相关网络身份识别信息（姓名、头像、密码）。收集手机号码是履行国家网络实名注册法律法规的必要条件。'}</p>
                  <p className="leading-relaxed mt-2">{lang === "en" ? 'You can register and log in to Star Gaze using third-party accounts, but you need to authorize us to obtain your information on the third-party platform (avatar, nickname, and other public information) to generate a Star Gaze account bound to that third-party account.' : '您可以使用第三方账户注册和登录 Star Gaze，但需要授权我们获取您在第三方平台上的信息（头像、昵称等公开信息），以生成绑定到该第三方账户的 Star Gaze 账户。'}</p>

                  <p className="leading-relaxed font-medium mt-4">{lang === "en" ? "1.1.2 Real-name Authentication" : "1.1.2 实名认证"}</p>
                  <p className="leading-relaxed mt-2">{lang === "en" ? 'When you use functions or services requiring real-name authentication, to comply with relevant legal and regulatory requirements, you need to provide real identity information (real name, ID number, or facial information) to complete real-name authentication.' : '当您使用需要实名认证的功能或服务时，为遵守相关法律法规要求，您需要提供真实身份信息（真实姓名、身份证号码或人脸信息）以完成实名认证。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "1.2 Content Generation and Browsing" : "1.2 内容生成和浏览"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'During your use of Star Gaze to generate or browse content, we will record your usage. When you use search, we will collect your search keyword information and log records. When providing location-based content or services, with your authorization, we will use geographic location information.' : '在您使用 Star Gaze 生成或浏览内容期间，我们会记录您的使用情况。当您使用搜索时，我们会收集您的搜索关键词信息和日志记录。在提供基于位置的内容或服务时，经您授权，我们会使用地理位置信息。'}</p>

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
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'Where an in-product account cancellation control is available, you may use it to submit a cancellation request. You may also contact toryxai@outlook.com. After identity verification, we will delete or anonymize relevant data subject to applicable law and the service-specific periods stated in this Policy.' : '如产品内提供账户注销入口，您可以通过该入口提交注销请求；也可以联系 toryxai@outlook.com。完成身份核验后，我们将根据适用法律及本政策所述各项服务期限删除或匿名化相关数据。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? '3.4 TikTok Authorization Revocation: You may revoke Star Gaze\'s access to your TikTok account at any time through your TikTok account settings. Once authorization is revoked, we will delete all associated TikTok data (including access tokens and user identifiers) within 30 days.' : '3.4 TikTok 授权撤回：您可以随时通过 TikTok 账户设置撤回 Star Gaze 对您 TikTok 账户的访问授权。授权撤回后，我们将在 30 天内删除所有相关的 TikTok 数据（包括访问令牌和用户标识符）。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 4. How We Protect Security */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-400 shrink-0"><Lock className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "4. How We Protect the Security of Personal Information" : "四、我们如何保护个人信息安全"}</h2>
                  <p className="leading-relaxed"><strong>{lang === "en" ? "4.1 Security Measures:" : "4.1 安全措施："}</strong> {lang === "en" ? "We adopt technical means such as encryption and de-identification, as well as strict management systems to protect your personal information. Data in transit is encrypted using TLS 1.2 or above. Data at rest is encrypted using AES-256 standard. Access to sensitive data follows the principle of least privilege." : "我们采用加密、去标识化等技术手段以及严格的管理制度来保护您的个人信息。传输中的数据使用 TLS 1.2 及以上协议加密。静态数据使用 AES-256 标准加密。敏感数据的访问遵循最小权限原则。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "4.2 Emergency Plan:" : "4.2 应急预案："}</strong> {lang === "en" ? "We establish an emergency plan for security incidents. Once a leakage or other incident occurs, we will launch it promptly, inform affected users within 72 hours, and report to relevant authorities as required by law." : "我们建立安全事件应急预案。一旦发生泄露或其他事件，我们将及时启动并在 72 小时内告知受影响的用户，并按法律要求向相关机构报告。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "4.3 Network Security:" : "4.3 网络安全："}</strong> {lang === "en" ? "We implement network segregation, anti-virus software, multi-factor authentication, and strict password policies to protect our systems and your data." : "我们实施网络隔离、防病毒软件、多因素认证和严格的密码策略来保护我们的系统和您的数据。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "4.4 Security Prompt:" : "4.4 安全提示："}</strong> {lang === "en" ? "Please understand that the internet environment is not 100% secure. Please keep your account information properly." : "请理解互联网环境并非100%安全。请妥善保管您的账户信息。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 5. How We Store Personal Information */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-orange-500/10 text-orange-400 shrink-0"><Server className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "5. How We Store Personal Information" : "五、我们如何存储个人信息"}</h2>
                  <p className="leading-relaxed"><strong>{lang === "en" ? "5.1 Storage Location:" : "5.1 存储地点："}</strong> {lang === "en" ? "Your personal information is stored and processed on servers located in the United States. Platform-related data, including TikTok, YouTube, Facebook, Instagram, and Meta/WhatsApp authorization tokens, account identifiers, message records, and operational metadata, may be stored and processed on US-based infrastructure. We apply appropriate safeguards to protect data handled in connection with our services." : "您的个人信息存储并处理于位于美国的服务器上。平台相关数据（包括 TikTok、YouTube、Facebook、Instagram 以及 Meta/WhatsApp 的授权令牌、账号标识符、消息记录和运营元数据）可能存储并处理于美国基础设施。我们对与本服务相关的数据采取适当的安全保护措施。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "5.2 Storage Period:" : "5.2 存储期限："}</strong> {lang === "en" ? "We only retain your personal information for the period necessary to provide services. Specific retention periods include: OAuth access tokens are stored until expiration and refreshed only where supported; product or account data may be fetched through platform APIs for enabled features; video files are deleted from our servers after successful upload where the feature requires temporary processing; WhatsApp conversation records are retained while the Inbox service is active or as needed for customer support history and troubleshooting. After account cancellation, we will delete or anonymize your information within 30 days, unless otherwise stipulated by laws." : "我们仅在提供服务所必需的期间内保留您的个人信息。具体保留期限包括：OAuth 访问令牌存储至过期，并仅在平台支持时刷新；商品或账号数据可能通过平台 API 为已启用功能获取；视频文件在相关功能需要临时处理并成功上传后从我们的服务器删除；WhatsApp 会话记录会在 Inbox 服务启用期间或客户支持历史、故障排查所需期间保留。账户注销后，除法律另有规定外，我们将在 30 天内删除或匿名化您的信息。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "5.3 Data Deletion:" : "5.3 数据删除："}</strong> {lang === "en" ? "You may request deletion of your personal data at any time by contacting us at toryxai@outlook.com. Upon receiving a valid deletion request, we will delete or anonymize applicable account, platform authorization, WhatsApp contact, and message data within 30 days unless retention is required by law. You may also review our Data Deletion Instructions." : "您可以随时通过联系 toryxai@outlook.com 请求删除您的个人数据。收到有效的删除请求后，除法律要求保留外，我们将在 30 天内删除或匿名化适用的账户、平台授权、WhatsApp 联系人和消息数据。您也可以查看我们的数据删除说明。"} <Link href="/data-deletion" className="text-cyan-400 hover:underline">{lang === "en" ? "Data Deletion Instructions" : "数据删除说明"}</Link></p>
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
                  <p className="leading-relaxed"><strong>{lang === "en" ? "7.1 Access:" : "7.1 访问："}</strong> {lang === "en" ? "You can view this Privacy Policy in the footer of the Star Gaze website or in the application settings." : "您可以在Star Gaze 网站页脚或应用程序设置中查看本隐私政策。"}</p>
                  <p className="leading-relaxed mt-3"><strong>{lang === "en" ? "7.2 Updates:" : "7.2 更新："}</strong> {lang === "en" ? "We will revise this policy in due course and notify you through announcements or internal messages." : "我们将适时修订本政策，并通过公告或站内消息通知您。"}</p>
                </div>
              </div>
            </ReflectiveCard>


            {/* 8. TikTok Platform Data Integration */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-violet-500/10 text-violet-400 shrink-0"><ShoppingBag className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "8. TikTok Platform Data Integration" : "八、TikTok 平台数据集成"}</h2>
                  <p className="leading-relaxed mb-3 text-sm bg-white/5 rounded-lg p-3 border border-white/10">{lang === "en" ? 'Note: Star Gaze is registered as "Wuhan Guanxing Cultural Media" on TikTok for Developers (Content Posting API), and used under the TikTok Shop service provider account name "Star Gaze".' : '说明：Star Gaze 在 TikTok for Developers（内容发布 API）的注册应用名称为 "Wuhan Guanxing Cultural Media"，在 TikTok Shop 的服务商账户名称为 "Star Gaze"。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "8.1 OAuth Authorization" : "8.1 OAuth 授权"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'Star Gaze integrates with TikTok via OAuth 2.0 authorization. Depending on the features you use, you may authorize the following permissions:' : 'Star Gaze 通过 OAuth 2.0 授权与 TikTok 集成。根据您使用的功能，您可能授权以下权限：'}</p>
                  <p className="leading-relaxed mt-3 text-sm text-gray-400">{lang === "en" ? 'Content Posting API (TikTok for Developers):' : '内容发布 API (TikTok for Developers)：'}</p>
                  <ul className="list-disc pl-6 space-y-2 mt-1 text-gray-300">
                    <li><strong>video.publish</strong> — {lang === "en" ? "Permission to directly post videos and photos to your TikTok account" : "直接向您的 TikTok 账户发布视频和图片的权限"}</li>
                    <li><strong>user.info.basic</strong> — {lang === "en" ? "Permission to access your basic profile information (username, avatar)" : "访问您的基本个人资料信息（用户名、头像）的权限"}</li>
                  </ul>
                  <p className="leading-relaxed mt-3 text-sm text-gray-400">{lang === "en" ? 'TikTok Shop API (Affiliate Creator):' : 'TikTok Shop API (联盟创作者)：'}</p>
                  <ul className="list-disc pl-6 space-y-2 mt-1 text-gray-300">
                    <li><strong>creator.video.write</strong> — {lang === "en" ? "Permission to publish shoppable videos with product links on your behalf" : "代您发布带商品链接的橱窗带货视频的权限"}</li>
                    <li><strong>creator.affiliate.info</strong> — {lang === "en" ? "Permission to access your product showcase information" : "访问您的橱窗商品信息的权限"}</li>
                  </ul>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'You may revoke any of these authorizations at any time through your TikTok account settings.' : '您可以随时通过 TikTok 账户设置撤回任何这些授权。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "8.2 Data We Access" : "8.2 我们访问的数据"}</h3>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li><strong>{lang === "en" ? "Basic Profile:" : "基本个人资料："}</strong> {lang === "en" ? "Username, display name, avatar (for identifying connected accounts within Star Gaze)" : "用户名、显示名称、头像（用于在 Star Gaze 内识别已连接的账号）"}</li>
                    <li><strong>{lang === "en" ? "Content Publishing (Direct Post):" : "内容发布（Direct Post）："}</strong> {lang === "en" ? "We directly publish AI-generated videos and photos to your TikTok account on your behalf, with your confirmation" : "经您确认后，我们代您将 AI 生成的视频和图片直接发布到您的 TikTok 账户"}</li>
                    <li><strong>{lang === "en" ? "Showcase Products (TikTok Shop):" : "橱窗商品 (TikTok Shop)："}</strong> {lang === "en" ? "Product ID, name, price, commission rate, images (to enable product selection for shoppable video creation)" : "商品 ID、名称、价格、佣金率、图片（用于带货视频创作时的商品选择）"}</li>
                    <li><strong>{lang === "en" ? "Shoppable Video Publishing:" : "带货视频发布："}</strong> {lang === "en" ? "We upload and publish shoppable content with product links to TikTok on your behalf" : "我们代您上传并发布带商品链接的带货内容到 TikTok"}</li>
                  </ul>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "8.3 How We Use This Data" : "8.3 数据使用方式"}</h3>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li>{lang === "en" ? "Basic profile information is displayed within Star Gaze to identify connected accounts" : "基本个人资料信息在 Star Gaze 内展示，用于标识已连接的账号"}</li>
                    <li>{lang === "en" ? "AI-generated videos are published directly to your TikTok account via the Content Posting API (Direct Post mode)" : "AI 生成的视频通过内容发布 API（Direct Post 模式）直接发布到您的 TikTok 账户"}</li>
                    <li>{lang === "en" ? "Showcase product data is used to help you select products for shoppable video creation" : "橱窗商品数据用于帮助您选择商品进行带货视频创作"}</li>
                    <li>{lang === "en" ? "Video files are temporarily processed on our servers and uploaded to TikTok, then deleted from our servers" : "视频文件在我们的服务器上临时处理并上传至 TikTok，然后从我们的服务器中删除"}</li>
                  </ul>
                  <p className="leading-relaxed mt-3 font-semibold">{lang === "en" ? 'We do not sell, share, or transfer your TikTok data to any third party.' : '我们不会向任何第三方出售、共享或转让您的 TikTok 数据。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "8.4 Data Retention for TikTok Data" : "8.4 TikTok 数据保留"}</h3>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li>{lang === "en" ? "OAuth tokens: stored until expiration; access tokens are automatically refreshed, refresh tokens require re-authorization upon expiration" : "OAuth 令牌：存储至过期；访问令牌自动刷新，刷新令牌到期后需重新授权"}</li>
                    <li>{lang === "en" ? "Showcase product information: fetched in real-time via API, not permanently stored" : "橱窗商品信息：通过 API 实时获取，不做持久化存储"}</li>
                    <li>{lang === "en" ? "Video files: deleted from our servers after successful upload to TikTok" : "视频文件：成功上传至 TikTok 后从我们的服务器删除"}</li>
                    <li>{lang === "en" ? "Upon authorization revocation: all TikTok-related data is deleted within 30 days" : "授权撤回后：所有 TikTok 相关数据在 30 天内删除"}</li>
                  </ul>
                </div>
              </div>
            </ReflectiveCard>

            {/* 9. YouTube, Facebook, and Instagram Integrations */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-sky-500/10 text-sky-400 shrink-0"><Users className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "9. YouTube, Facebook, and Instagram Integrations" : "九、YouTube、Facebook 和 Instagram 集成"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? "When you connect YouTube, Facebook, or Instagram accounts to Star Gaze, we process only the account, authorization, media, publishing, and status data needed to provide the features you enable." : "当您将 YouTube、Facebook 或 Instagram 账号连接到 Star Gaze 时，我们仅处理为提供您启用功能所需的账号、授权、媒体、发布和状态数据。"}</p>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li>{lang === "en" ? "Account identifiers, display names, profile images, page/channel/account IDs, access tokens, and authorization status used to identify connected accounts." : "账号标识符、显示名称、头像、主页/频道/账号 ID、访问令牌和授权状态，用于识别已连接账号。"}</li>
                    <li>{lang === "en" ? "Content drafts, captions, media URLs or temporary upload metadata, scheduled publish time, platform response IDs, and publishing status used to publish content at your direction." : "内容草稿、标题/文案、媒体 URL 或临时上传元数据、计划发布时间、平台响应 ID 和发布状态，用于按您的指令发布内容。"}</li>
                    <li>{lang === "en" ? "Operational logs and API response metadata used for troubleshooting, security, audit, and support." : "运营日志和 API 响应元数据，用于故障排查、安全、审计和支持。"}</li>
                  </ul>
                  <p className="leading-relaxed mt-3 font-semibold">{lang === "en" ? "We do not sell YouTube, Facebook, Instagram, or other connected platform data." : "我们不会出售 YouTube、Facebook、Instagram 或其他已连接平台的数据。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 10. WhatsApp Business Cloud API and Inbox Data */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0"><Database className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "10. WhatsApp Business Cloud API and Inbox Data" : "十、WhatsApp Business Cloud API 与 Inbox 数据"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? "If WhatsApp Inbox is enabled for your workspace, Star Gaze uses the WhatsApp Business Cloud API to receive customer messages and support manual replies from your authorized business account." : "如果您的工作区启用了 WhatsApp Inbox，Star Gaze 会使用 WhatsApp Business Cloud API 接收客户消息，并支持从您授权的业务账号进行人工回复。"}</p>
                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "Data We Process" : "我们处理的数据"}</h3>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li>{lang === "en" ? "WhatsApp phone number ID and WhatsApp Business Account ID used to route webhook events to the correct workspace." : "WhatsApp phone number id 和 WhatsApp business account id，用于将 webhook 事件路由到正确工作区。"}</li>
                    <li>{lang === "en" ? "Customer contact data such as phone number, wa_id, display name, country where available, source platform, assignment status, and last message time." : "客户联系人数据，例如手机号、wa_id、显示名称、可用时的国家/地区、来源平台、分配状态和最后消息时间。"}</li>
                    <li>{lang === "en" ? "Inbound and outbound message records, including text, message type, media ID or media URL when applicable, message status, error reason, timestamps, and WhatsApp message ID." : "入站和出站消息记录，包括文本、消息类型、适用时的 media id 或 media URL、消息状态、错误原因、时间戳和 WhatsApp message id。"}</li>
                    <li>{lang === "en" ? "Webhook payload metadata and API response metadata retained for troubleshooting, delivery status tracking, security review, and support." : "webhook payload 元数据和 API 响应元数据，用于故障排查、投递状态追踪、安全审查和支持。"}</li>
                  </ul>
                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "How We Use WhatsApp Data" : "我们如何使用 WhatsApp 数据"}</h3>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li>{lang === "en" ? "Display customer conversations in the Inbox for authorized users." : "在 Inbox 中向授权用户展示客户会话。"}</li>
                    <li>{lang === "en" ? "Support manual customer service replies initiated by your team." : "支持由您的团队人工触发的客户服务回复。"}</li>
                    <li>{lang === "en" ? "Track message delivery status, failures, timestamps, and troubleshooting information." : "追踪消息投递状态、失败原因、时间戳和故障排查信息。"}</li>
                  </ul>
                  <p className="leading-relaxed mt-3 font-semibold">{lang === "en" ? "We do not sell WhatsApp or Meta data, and we do not use WhatsApp Inbox for unsolicited automated marketing broadcasts." : "我们不会出售 WhatsApp 或 Meta 数据，也不会使用 WhatsApp Inbox 进行未经用户触发的自动营销群发。"}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? "When you disconnect a WhatsApp account or revoke authorization, we delete related tokens and account mappings within 30 days unless retention is required by law or needed for security and dispute records." : "当您断开 WhatsApp 账号或撤回授权时，除法律要求或安全、争议记录所需外，我们将在 30 天内删除相关令牌和账号映射。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 11. AIGC Content Disclosure */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-fuchsia-500/10 text-fuchsia-400 shrink-0"><Cpu className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "11. AIGC Content Disclosure" : "十一、AIGC 内容披露"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'Star Gaze is an AI-powered content creation platform. Videos generated through our platform are created using artificial intelligence technology, including AI-generated characters, voiceovers, and scripts.' : 'Star Gaze 是一个 AI 驱动的内容创作平台。通过我们平台生成的视频使用人工智能技术创建，包括 AI 生成的角色、配音和脚本。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'In compliance with TikTok\'s content policies, all AI-generated videos published through Star Gaze to TikTok will be automatically labeled as AIGC (AI-Generated Content). This labeling ensures transparency and compliance with platform regulations regarding synthetic media.' : '为遵守 TikTok 的内容政策，通过 Star Gaze 发布到 TikTok 的所有 AI 生成视频将自动标注为 AIGC（AI 生成内容）。此标注确保了合成媒体相关平台法规的透明度和合规性。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'Users acknowledge and agree that AI-generated content published through Star Gaze will carry appropriate AIGC disclosures as required by applicable platform rules and regulations.' : '用户确认并同意，通过 Star Gaze 发布的 AI 生成内容将按照适用的平台规则和法规附带适当的 AIGC 披露标注。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* Facebook Platform Data */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400 shrink-0"><Share2 className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Facebook Platform Data" : "Facebook 平台数据"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? "With your authorization, Star Gaze uses Meta Platform APIs to connect Facebook Pages you manage, display Page information, publish or schedule Page videos and posts, synchronize Page comments through API calls and webhooks, and send replies that you initiate or confirm. We do not request or store your Facebook password." : "在您授权后，Star Gaze 使用 Meta 平台 API 绑定您管理的 Facebook Page、展示 Page 信息、发布或预约发布 Page 视频与帖子、通过 API 调用和 webhook 同步 Page 评论，以及发送由您主动发起或确认的回复。我们不会请求或存储您的 Facebook 密码。"}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "Data We Process" : "我们处理的数据"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? "Depending on the features you use, we may process the Facebook user ID that granted authorization; OAuth access tokens, granted permissions, expiration and authorization status; Page ID, name, category, profile image, link, tasks and aggregate Page statistics; video or post source, title, description, schedule, Facebook content IDs, watch URLs and publishing status; Page comments and replies, their identifiers, text, author display information supplied by Facebook, timestamps, counts and permalinks; and account-linkage, synchronization, webhook receipt, action, diagnostic and security records." : "根据您使用的功能，我们可能处理授予授权的 Facebook 用户 ID；OAuth 访问令牌、已授予权限、到期时间及授权状态；Page ID、名称、类别、头像、链接、任务权限及汇总统计；视频或帖子来源、标题、描述、预约时间、Facebook 内容 ID、观看链接及发布状态；Page 评论与回复的标识、正文、Facebook 提供的作者展示信息、时间、数量及永久链接；以及账号绑定、同步、webhook 接收、操作、诊断和安全记录。"}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "Purpose, Permissions, and Sharing" : "目的、权限与共享"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? "We request only the Facebook Page permissions needed to list Pages you manage, maintain webhook subscriptions, read Page and Page-content information, publish Page content, read user comments on Page content, and submit Page comment replies. We use Facebook Platform Data only to provide the features you select, maintain synchronization, prevent duplicate actions, secure and troubleshoot the service, provide support, and comply with law and Meta requirements." : "我们仅请求用于列出您管理的 Page、维护 webhook 订阅、读取 Page 与 Page 内容信息、发布 Page 内容、读取 Page 内容下的用户评论及提交 Page 评论回复所需的 Facebook Page 权限。我们仅将 Facebook 平台数据用于提供您选择的功能、维护同步、防止重复操作、保护与排查服务、提供支持，以及遵守法律和 Meta 要求。"}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? "We do not sell Facebook Platform Data or use it for unrelated advertising, surveillance, or training general-purpose AI models. Infrastructure, database, security, monitoring, and support providers receive only the information reasonably necessary to provide their services and are subject to appropriate confidentiality and security obligations." : "我们不会出售 Facebook 平台数据，也不会将其用于无关广告、监控或训练通用人工智能模型。基础设施、数据库、安全、监控及支持服务提供商仅接收履行其服务所合理需要的信息，并受到适当的保密和安全义务约束。"}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "Retention, Revocation, and Deletion" : "保留、撤权与删除"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? "We retain Facebook tokens and Platform Data only while reasonably necessary to provide actively authorized features, maintain security and diagnostics, or satisfy legal requirements. When authorization is revoked, Meta sends a deauthorization or deletion request, or you use a Star Gaze deletion control, we stop the affected access and delete the associated Facebook Page bindings, tokens, cached comments, publishing records, and applicable logs under our control." : "我们仅在提供持续获得授权的功能、维护安全与诊断或履行法律要求所合理需要的期间内保留 Facebook 令牌和平台数据。当授权被撤销、Meta 发送取消授权或删除请求，或您使用 Star Gaze 的删除功能时，我们会停止相关访问，并删除由我们控制的关联 Facebook Page 绑定、令牌、评论缓存、发布记录及适用日志。"}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? "You may disconnect one Page or use “Delete all Facebook data” in Facebook Account Management, revoke access in Facebook Apps and Websites settings, follow the confirmation link returned by Meta’s data-deletion callback, or contact toryxai@outlook.com. Deleting data stored by Star Gaze does not delete videos, posts, comments, replies, or other content hosted by Facebook; Facebook-hosted content must be managed through Facebook or another authorized client that supports the relevant deletion action." : "您可以在 Facebook 账号管理中解绑单个 Page 或使用“删除全部 Facebook 数据”，通过 Facebook“应用和网站”设置撤销访问，使用 Meta 数据删除回调返回的确认链接，或联系 toryxai@outlook.com。删除 Star Gaze 保存的数据不会删除 Facebook 平台保存的视频、帖子、评论、回复或其他内容；Facebook 平台内容必须通过 Facebook 或其他支持相应删除操作的授权客户端进行管理。"}</p>

                  <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-sm">
                    <Link href="https://developers.facebook.com/terms/" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Meta Platform Terms" : "Meta 平台条款"}</Link>
                    <Link href="https://www.facebook.com/privacy/policy/" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Meta Privacy Policy" : "Meta 隐私政策"}</Link>
                    <Link href="https://www.facebook.com/settings?tab=applications" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Facebook Apps and Websites settings" : "Facebook 应用和网站设置"}</Link>
                  </div>
                </div>
              </div>
            </ReflectiveCard>

            {/* 10. YouTube API Services and Google User Data */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-red-500/10 text-red-400 shrink-0"><Youtube className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "10. YouTube API Services and Google User Data" : "十、YouTube API 服务与 Google 用户数据"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'Star Gaze uses YouTube API Services to connect and identify a channel, display channel information, upload and schedule videos, manage publishing metadata and visibility, synchronize comments, translate comments when requested, and send replies initiated or confirmed by the user. We do not request or store your Google or YouTube password.' : 'Star Gaze 使用 YouTube API 服务绑定并识别频道、展示频道信息、上传和定时发布视频、管理发布元数据与可见性、同步评论、按请求翻译评论，以及发送由用户主动发起或确认的回复。我们不会请求或存储您的 Google 或 YouTube 密码。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "10.1 Data We Process" : "10.1 我们处理的数据"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'Depending on the features you use, we may process OAuth access and refresh tokens, granted scopes and expiration data; channel ID, title, handle, thumbnail and channel statistics; video files or source URLs, titles, descriptions, tags, categories, audience and synthetic-media settings, visibility, schedules, YouTube video IDs, watch URLs and publishing status; comments, replies, comment and thread identifiers, text, author display information supplied by YouTube, timestamps, counts and permalinks; and account linkage, synchronization, action, diagnostic and security records.' : '根据您使用的功能，我们可能处理 OAuth 访问令牌与刷新令牌、已授予权限和到期信息；频道 ID、名称、账号标识、缩略图及频道统计；视频文件或来源地址、标题、描述、标签、分类、受众与合成媒体设置、可见性、定时信息、YouTube 视频 ID、观看链接及发布状态；评论、回复、评论与评论串标识、正文、YouTube 提供的作者展示信息、时间、数量及永久链接；以及账号绑定、同步、操作、诊断和安全记录。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'We request youtube.force-ssl because YouTube provides no narrower scope for user-initiated comment replies. We use it only for the visible channel, publishing, comment-reading, and user-confirmed reply features described in this Policy.' : '我们请求 youtube.force-ssl，是因为 YouTube 没有支持用户主动回复评论的更窄权限。我们仅将其用于本政策所述的频道、发布、评论读取和用户确认回复等可见功能。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "10.2 Use and Sharing" : "10.2 使用与共享"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'We use YouTube and Google user data only to provide the features you select, maintain synchronization, prevent duplicate actions, secure and troubleshoot the service, provide support, and comply with law and platform requirements. We do not sell this data or use it for unrelated advertising, surveillance, or training general-purpose AI models.' : '我们仅将 YouTube 与 Google 用户数据用于提供您选择的功能、维护同步、防止重复操作、保护与排查服务、提供支持，以及遵守法律和平台要求。我们不会出售该数据，也不会将其用于无关广告、监控或训练通用人工智能模型。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'When you expressly request comment translation, the relevant text may be sent over an encrypted connection to our configured translation processor solely to return the requested translation. Infrastructure, database, security, monitoring, support and translation providers receive only the information reasonably necessary to provide their services and are subject to appropriate confidentiality and security obligations.' : '当您明确请求评论翻译时，相关文本可能通过加密连接发送至我们配置的翻译处理服务，其唯一目的为返回所请求的译文。基础设施、数据库、安全、监控、支持及翻译服务提供商仅接收履行其服务所合理需要的信息，并受到适当的保密和安全义务约束。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "10.3 Retention, Revocation, and Deletion" : "10.3 保留、撤权与删除"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'We retain OAuth tokens only while reasonably necessary to provide features authorized by an active user. Except where YouTube policies allow a different period, cached YouTube API data is refreshed or deleted within 30 calendar days. If we can no longer verify valid authorization, we stop access and delete or refresh affected YouTube API data no later than 30 calendar days unless applicable law requires retention.' : '我们仅在为持续获得授权的用户提供相关功能所合理需要的期间内保留 OAuth 令牌。除 YouTube 政策允许其他期限外，缓存的 YouTube API 数据将在 30 个自然日内刷新或删除。当我们无法继续确认授权有效时，将停止访问，并在不超过 30 个自然日内删除或刷新受影响的 YouTube API 数据，适用法律要求保留的除外。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'You may disconnect one YouTube account or use the “Delete all YouTube data” control in YouTube Account Management, or revoke access through Google Account third-party connections. Local account data is deleted transactionally. If Google is temporarily unavailable, the refresh token is retained in a service-role-only revocation queue solely to retry revocation and is deleted immediately after success or no later than seven (7) calendar days. You may also request deletion at toryxai@outlook.com. After reasonable identity verification, YouTube-related user data under our control will be deleted as soon as possible and no later than seven (7) calendar days, unless retention is legally required.' : '您可以在 YouTube 账号管理中解绑单个账号或使用“删除全部 YouTube 数据”功能，也可以通过 Google 账号第三方连接页面撤销访问。本地账号数据通过事务删除。如 Google 暂时不可用，刷新令牌将仅为重试撤权而暂存于仅服务角色可访问的队列中，并在撤权成功后立即删除或最迟不超过七（7）个自然日删除。您也可以通过 toryxai@outlook.com 请求删除数据。在合理核验身份后，我们将尽快删除由我们控制的 YouTube 相关用户数据，且最迟不超过七（7）个自然日，法律要求保留的除外。'}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? 'Deleting data stored by Star Gaze does not delete videos, comments, replies or other data stored by YouTube. YouTube-hosted data must be managed through YouTube or another authorized client that supports the relevant deletion action.' : '删除 Star Gaze 保存的数据不会删除 YouTube 平台保存的视频、评论、回复或其他数据。YouTube 平台数据必须通过 YouTube 或其他支持相应删除操作的授权客户端进行管理。'}</p>

                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "10.4 Google Policies and Limited Use" : "10.4 Google 政策与有限使用"}</h3>
                  <p className="leading-relaxed">{lang === "en" ? 'Star Gaze’s use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.' : 'Star Gaze 对从 Google API 获取的信息的使用及传输，将遵守 Google API 服务用户数据政策，包括其中的有限使用（Limited Use）要求。'}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-sm">
                    <Link href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google API Services User Data Policy" : "Google API 服务用户数据政策"}</Link>
                    <Link href="https://policies.google.com/privacy" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google Privacy Policy" : "Google 隐私政策"}</Link>
                    <Link href="https://security.google.com/settings/security/permissions" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google Account third-party connections" : "Google 账号第三方连接"}</Link>
                  </div>
                </div>
              </div>
            </ReflectiveCard>

            {/* 11. Third-Party Services */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0"><ExternalLink className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "11. Third-Party Services" : "十一、第三方服务"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'When Star Gaze integrates third-party services, it will follow the data policies of relevant platforms.' : '当 Star Gaze 集成第三方服务时，将遵循相关平台的数据政策。'}</p>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li>{lang === "en" ? "TikTok: " : "TikTok："}<Link href="https://www.tiktok.com/legal/privacy-policy?lang=en" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "TikTok Privacy Policy" : "TikTok 隐私政策"}</Link></li>
                    <li>{lang === "en" ? "TikTok Developer: " : "TikTok 开发者："}<Link href="https://www.tiktok.com/legal/tik-tok-developer-terms-of-service?lang=en" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "TikTok Developer Terms of Service" : "TikTok 开发者服务条款"}</Link></li>
                    <li>{lang === "en" ? "TikTok Shop Developer: " : "TikTok Shop 开发者："}<Link href="https://partner.tiktokshop.com/docv2/page/6507ead7b99d5302be949ba9" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "TikTok Shop Developer Terms" : "TikTok Shop 开发者条款"}</Link></li>
                    <li>{lang === "en" ? "Google/YouTube: " : "Google/YouTube："}<Link href="https://www.google.com/policies/privacy" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google Privacy Policy" : "Google 隐私政策"}</Link></li>
                    <li>{lang === "en" ? "To revoke Google/YouTube authorization: " : "撤销 Google/YouTube 授权："}<Link href="https://security.google.com/settings/security/permissions" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google Security Settings" : "Google 安全设置"}</Link></li>
                    <li>{lang === "en" ? "Meta/Facebook: " : "Meta/Facebook："}<Link href="https://www.facebook.com/privacy/policy/" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Meta Privacy Policy" : "Meta 隐私政策"}</Link></li>
                    <li>{lang === "en" ? "To revoke Facebook authorization: " : "撤销 Facebook 授权："}<Link href="https://www.facebook.com/settings?tab=applications" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Facebook Apps and Websites settings" : "Facebook 应用和网站设置"}</Link></li>
                  </ul>
                </div>
              </div>
            </ReflectiveCard>

            {/* 12. Contact Us */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-teal-500/10 text-teal-400 shrink-0"><Phone className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "12. Contact Us" : "十二、联系我们"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? 'If you have questions, suggestions, or complaints about personal information protection, data deletion requests, or any privacy-related matters, you can contact us:' : '如您对个人信息保护、数据删除请求或任何隐私相关事项有疑问、建议或投诉，可以联系我们：'}</p>
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
                  <p className="leading-relaxed mt-4">{lang === "en" ? 'We will verify your identity and respond within fifteen (15) working days.' : '我们将核实您的身份并在十五 (15) 个工作日内回复。'}</p>
                </div>
              </div>
            </ReflectiveCard>

          </div>
        </div>
      </main>

      <footer className="relative z-10 border-t border-white/5 py-8 bg-black/30">
        <div className="container max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-gray-500 text-sm">© {new Date().getFullYear()} {lang === "en" ? "Star Gaze by Wuhan Guanxing Cultural Media Co., Ltd. All Rights Reserved" : "Star Gaze · 武汉观星文化传媒有限公司 版权所有"}</div>
            <div className="flex items-center gap-6 text-gray-500 text-sm">
              <Link href="/terms" className="hover:text-white transition-colors">{lang === "en" ? "Terms" : "服务条款"}</Link>
              <Link href="/privacy" className="hover:text-white transition-colors">{lang === "en" ? "Privacy" : "隐私政策"}</Link>
              <Link href="/data-deletion" className="hover:text-white transition-colors">{lang === "en" ? "Data Deletion" : "数据删除"}</Link>
              <Link href="/legal" className="hover:text-white transition-colors">{lang === "en" ? "Legal" : "法律声明"}</Link>
              <Link href="https://beian.miit.gov.cn/" target="_blank" className="hover:text-white transition-colors flex items-center gap-1"><Shield className="h-4 w-4" />鄂ICP备2023007484号</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
