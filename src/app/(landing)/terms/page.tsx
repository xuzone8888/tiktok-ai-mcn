"use client";

import { ArrowLeft, Sparkles, Shield, Globe, FileText, Users, UserCheck, AlertTriangle, BookOpen, Scale, Gavel, RefreshCw, Phone, CreditCard, Megaphone, Receipt, ShieldX, Layers, Baby, MoreHorizontal, Music2, DollarSign, Share2 } from "lucide-react";
import Link from "next/link";

import { YouTubeBrandIcon } from "@/components/brand/YouTubeBrandIcon";
import { Button } from "@/components/ui/button";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { useLang } from "@/contexts/LangContext";

export default function TermsPage() {
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
            <h1 className="text-4xl font-bold mb-4">{lang === "en" ? "Terms of Service - Wuhan Guanxing Cultural Media Co., Ltd. (Star Gaze)" : "服务条款 - 武汉观星文化传媒有限公司 (Star Gaze)"}</h1>
            <p className="text-gray-400">{lang === "en" ? "Last Updated: July 23, 2026" : "最后更新日期：2026年7月23日"}</p>
            <p className="text-gray-400">{lang === "en" ? "Effective Date: July 23, 2026" : "生效日期：2026年7月23日"}</p>
          </div>

          <div className="space-y-8 text-gray-300">
            {/* 1. Introduction */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0"><FileText className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "1. Introduction" : "一、引言"}</h2>
                  <p className="leading-loose font-semibold text-white/80 mb-4">{lang === "en" ? "Star Gaze is a service brand operated by Wuhan Guanxing Cultural Media Co., Ltd." : "Star Gaze 为武汉观星文化传媒有限公司运营品牌。"}</p>
                  <p className="leading-loose">{lang === "en" ? 'Welcome to "Star Gaze" software and related services!' : '欢迎使用"Star Gaze"软件及相关服务！'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '"Star Gaze" software and related services refer to the products and services provided to you by Wuhan Guanxing Cultural Media Co., Ltd. and its affiliates (hereinafter referred to as "Company"), which legally own and operate the client application labeled "Star Gaze" and the related website (toryxai.com). This Agreement is entered into between you and the Company regarding your download, installation, registration, login, use of "Star Gaze" software, and access to related services.' : '"Star Gaze"软件及相关服务是指武汉观星文化传媒有限公司及其关联方（以下简称"公司"）依法拥有并运营的标注名称为"Star Gaze"的客户端应用程序及相关网站（toryxai.com）向您提供的产品与服务。本协议是您与公司就您下载、安装、注册、登录、使用"Star Gaze"软件及获取相关服务所订立的协议。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? 'To better provide services to you, please strictly read and fully understand this Agreement before you start using "Star Gaze" software and related services, especially terms involving exemption or limitation of liability, licensing of rights and use of information, terms regarding consent to activate and use special individual services, governing law and dispute resolution terms, etc. Among them, important contents such as exemption or limitation of liability terms will be prompted in bold for your attention.' : '为了更好地为您提供服务，请您在开始使用"Star Gaze"软件及相关服务之前，严格阅读并充分理解本协议，特别是涉及免除或限制责任的条款、权利许可和信息使用的条款、同意开通和使用特殊单项服务的条款、法律适用和争议解决条款等。其中，免除或限制责任条款等重要内容将以加粗形式提示您注意。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? 'If you do not agree to this Agreement, we will be unable to provide you with complete products and services, and you may choose to stop using them. If you voluntarily choose to agree to or use "Star Gaze" software and related services, it shall be deemed that you have fully understood this Agreement and agreed to accept the constraints of this Agreement.' : '如您不同意本协议，我们将无法为您提供完整的产品和服务，您可以选择停止使用。如果您自愿选择同意或使用"Star Gaze"软件及相关服务，即视为您已充分理解本协议，并同意接受本协议的约束。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 2. Platform Software and Related Services */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-purple-500/10 text-purple-400 shrink-0"><BookOpen className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? '2. "Star Gaze" Software and Related Services' : '二、"Star Gaze"软件及相关服务'}</h2>
                  <p className="leading-loose">{lang === "en" ? '2.1 You may use "Star Gaze" software and related services in the form of clients, webpages, etc. on terminals such as computers and mobile phones. The specific form provided by the Company shall prevail.' : '2.1 您可以在计算机、手机等终端设备上以客户端、网页等形式使用"Star Gaze"软件及相关服务，具体以公司提供的为准。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '2.2 The Company grants you a personal, non-transferable, and non-exclusive license to use "Star Gaze" software and related services. Without prior written authorization from the Company, you may not use it for commercial purposes.' : '2.2 公司授予您一项个人的、不可转让的、非独占的许可以使用"Star Gaze"软件及相关服务。未经公司事先书面授权，您不得将其用于商业目的。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '2.3 You can obtain this software from the Company\'s website or a third party authorized by the Company. If you obtain this software from a third party not authorized by the Company, the Company cannot guarantee that the software can be used normally.' : '2.3 您可以从公司网站或经公司授权的第三方获取该软件。如果您从未经公司授权的第三方获取本软件，公司无法保证该软件能够正常使用。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '2.4 In order to improve user experience and improve service content, the Company will continuously strive to develop new services and provide you with software updates from time to time.' : '2.4 为了改善用户体验和完善服务内容，公司将不断努力开发新服务，并不时向您提供软件更新。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '2.5 Unless you have prior written authorization from the Company, you may not access or use "Star Gaze" software and related services in any unauthorized form.' : '2.5 未经公司事先书面授权，您不得以任何未经授权的形式访问或使用"Star Gaze"软件及相关服务。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 3. About "Account" */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-pink-500/10 text-pink-400 shrink-0"><Users className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? '3. About "Account"' : '三、关于"账户"'}</h2>
                  <p className="leading-loose">{lang === "en" ? '3.1 "Star Gaze" software and related services provide you with a registration channel. You have the right to choose a legal character combination as your account and set a password that meets security requirements on your own.' : '3.1 "Star Gaze"软件及相关服务为您提供注册通道，您有权选择合法的字符组合作为自己的账户，并自行设定符合安全要求的密码。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '3.2 You understand and assume that the account you set shall not violate national laws and regulations and the relevant rules of the Company. Your account name, avatar, profile, and other registration information shall not contain illegal or undesirable information.' : '3.2 您理解并承诺，您设置的账户不得违反国家法律法规及公司的相关规则。您的账户名称、头像、简介等注册信息不得含有违法或不良信息。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '3.3 Your account is limited to your personal use. Without the written consent of the Company, it is prohibited to donate, borrow, rent, transfer, sell, or permit others to use the account in any other way.' : '3.3 您的账户仅限于您本人使用，未经公司书面同意，禁止以任何形式赠与、借用、出租、转让、售卖或许可他人使用该账户。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '3.4 You are responsible for maintaining the security and confidentiality of your personal account and password, and assume full legal responsibility for activities engaged in the name of your registered account.' : '3.4 您应负责维护个人账户和密码的安全性和保密性，对您以注册账户名义所从事的活动承担全部法律责任。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '3.5 If your account is lost or you forget your password, you can follow the Company\'s appeal channel to appeal for retrieval of the account or password.' : '3.5 如您的账户丢失或忘记密码，可以按公司的申诉通道进行申诉找回账户或密码。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '3.6 When registering, using, and managing your account, you should ensure the authenticity of the identity information filled in during registration.' : '3.6 在注册、使用和管理账户时，您应确保注册时填写的身份信息的真实性。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '3.7 In addition to self-registering an account, users can also authorize the use of user accounts of third-party software legally owned by them to log in and use "Star Gaze" software and related services.' : '3.7 除自行注册账户外，用户还可以授权使用其合法拥有的第三方软件用户账户登录使用"Star Gaze"软件及相关服务。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '3.8 After you complete account registration and login, you can browse and modify the submitted personal identity information at any time. You can also apply to cancel your account.' : '3.8 您完成账户注册和登录后，可随时浏览、修改自己提交的个人身份信息。您也可以申请注销您的账户。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '3.9 You understand and agree that in order to fully utilize account resources, if you fail to log in for the first time in time after registration or fail to log in and use the account for more than two consecutive months, the Company has the right to recall your account.' : '3.9 您理解并同意，为了充分利用账户资源，如您注册后未及时首次登录或连续超过两个月未登录使用账户，公司有权回收您的账户。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 4. User Personal Information Protection */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-green-500/10 text-green-400 shrink-0"><Shield className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "4. User Personal Information Protection" : "四、用户个人信息保护"}</h2>
                  <p className="leading-loose">{lang === "en" ? 'The Company is committed to the protection of your personal information together with you. Protecting user personal information is one of the Company\'s basic principles. The Company will protect your rights to browse, modify, delete relevant personal information, withdraw authorization, and cancel your account in accordance with the law, and will use encryption technology, anonymization processing, and other technical measures and other security measures matching "Star Gaze" software and related services to protect your personal information.' : '公司致力于与您一起保护您的个人信息。保护用户个人信息是公司的基本原则之一。公司将依法保护您浏览、修改、删除相关个人信息以及撤回授权、注销账户的权利，并将采用加密技术、匿名化处理等技术措施及其他与"Star Gaze"软件及相关服务相匹配的安全措施保护您的个人信息。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? 'For more content on your personal information protection, please refer to the "Star Gaze Privacy Policy".' : '有关您个人信息保护的更多内容，请参见《Star Gaze 隐私政策》。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* PLACEHOLDER_REMAINING_SECTIONS */}

            {/* 5. User Conduct Code */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-yellow-500/10 text-yellow-400 shrink-0"><AlertTriangle className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "5. User Conduct Code" : "五、用户行为规范"}</h2>
                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "5.1 User Conduct Requirements" : "5.1 用户行为要求"}</h3>
                  <p className="leading-loose">{lang === "en" ? 'You shall be responsible for your use of "Star Gaze" software and related services. Unless permitted by law or with prior written permission from the Company, your use shall not involve: using any unauthorized tools to interfere with normal operation, engaging in acts endangering computer network security, maliciously registering accounts, etc.' : '您应对您使用"Star Gaze"软件及相关服务的行为负责。除法律允许或经公司事先书面许可外，您使用不得涉及：使用未经授权的工具干扰正常操作、从事危害计算机网络安全的行为、恶意注册账户等。'}</p>
                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "5.2 Information Content Norms" : "5.2 信息内容规范"}</h3>
                  <p className="leading-loose">{lang === "en" ? 'The information you create, comment on, publish, and disseminate shall consciously abide by the "Seven Bottom Lines" requirements. You agree not to create, reproduce, publish, or disseminate the following information:' : '您创作、评论、发布、传播的信息应自觉遵守"七条底线"要求。您同意不创作、复制、发布、传播以下信息：'}</p>
                  <ul className="list-disc pl-6 space-y-1 mt-3 text-gray-300 text-sm">
                    <li>{lang === "en" ? "Opposing the basic principles established by the Constitution" : "反对宪法所确定的基本原则的"}</li>
                    <li>{lang === "en" ? "Endangering national security or divulging state secrets" : "危害国家安全、泄露国家秘密的"}</li>
                    <li>{lang === "en" ? "Subverting state power, overthrowing the socialist system, undermining national unity" : "颠覆国家政权、推翻社会主义制度、破坏国家统一的"}</li>
                    <li>{lang === "en" ? "Advocating terrorism or extremism" : "宣扬恐怖主义、极端主义的"}</li>
                    <li>{lang === "en" ? "Inciting ethnic hatred or discrimination, undermining ethnic unity" : "煽动民族仇恨、民族歧视、破坏民族团结的"}</li>
                    <li>{lang === "en" ? "Undermining state religious policies or propagating cults and feudal superstitions" : "破坏国家宗教政策、宣扬邪教和封建迷信的"}</li>
                    <li>{lang === "en" ? "Fabricating or spreading rumors or false information to disturb social order" : "编造或散布谣言或虚假信息扰乱社会秩序的"}</li>
                    <li>{lang === "en" ? "Disseminating obscenity, pornography, gambling, violence, terror, or abetting crimes" : "传播淫秽、色情、赌博、暴力、恐怖或教唆犯罪的"}</li>
                    <li>{lang === "en" ? "Infringing upon the legitimate rights and interests of minors or harming their physical and mental health" : "侵害未成年人合法权益或损害其身心健康的"}</li>
                    <li>{lang === "en" ? "Insulting or defaming others or infringing upon their legitimate rights and interests" : "侮辱或诽谤他人或侵犯其合法权益的"}</li>
                    <li>{lang === "en" ? "Infringing upon others' privacy rights, reputation rights, portrait rights, intellectual property rights" : "侵犯他人隐私权、名誉权、肖像权、知识产权等合法权益的"}</li>
                    <li>{lang === "en" ? "Other information violating laws, regulations, policies, and public order and good customs" : "其他违反法律法规、政策及公序良俗的信息"}</li>
                  </ul>
                  <h3 className="text-lg font-medium text-white mt-4 mb-2">{lang === "en" ? "5.3" : "5.3"}</h3>
                  <p className="leading-loose">{lang === "en" ? 'If the Company has reason to believe that your behavior violates or may violate the above agreement, the Company may verify and handle it independently, and has the right to terminate the provision of services to you without prior notice and pursue relevant legal responsibilities.' : '如公司有理由认为您的行为违反或可能违反上述约定，公司可独立进行核实和处理，有权在不事先通知的情况下终止向您提供服务，并追究相关法律责任。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 6. Platform Information Content Usage Norms */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400 shrink-0"><BookOpen className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? '6. "Star Gaze" Information Content Usage Norms' : '六、"Star Gaze"信息内容使用规范'}</h2>
                  <p className="leading-loose">{lang === "en" ? '6.1 Without written permission from the Company, you may not copy, read, adopt, or use the information content in "Star Gaze" software for commercial purposes, either by yourself or by authorizing, allowing, or assisting any third party.' : '6.1 未经公司书面许可，您不得自行或授权、允许、协助任何第三方复制、阅读、采用"Star Gaze"软件中的信息内容用于商业目的。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '6.2 With written permission from the Company, your sharing and forwarding of the information content shall also comply with relevant norms, and the original content shall not be tampered with or obscured.' : '6.2 经公司书面许可，您分享和转发信息内容时也应遵守相关规范，不得篡改或遮蔽原始内容。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 7. Breach Handling */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-red-500/10 text-red-400 shrink-0"><Gavel className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "7. Breach Handling" : "七、违规处理"}</h2>
                  <p className="leading-loose">{lang === "en" ? '7.1 In response to your violation of this Agreement or other service terms, the Company has the right to independently judge and take measures such as prior warning, refusal to publish, immediate cessation of information transmission, deletion of posts, short-term prohibition of speaking, restriction of some or all account functions, up to permanent closure of the account.' : '7.1 对于您违反本协议或其他服务条款的行为，公司有权独立判断并采取事先警告、拒绝发布、立即停止信息传输、删除帖子、短期禁言、限制部分或全部账户功能直至永久关闭账户等措施。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '7.2 If your violation causes third-party complaints or litigation claims, you shall handle it yourself and bear all resulting legal responsibilities. If your illegal or breach behavior causes the Company to compensate any third party, you shall fully compensate the Company for all losses.' : '7.2 如果您的违规行为导致第三方投诉或诉讼索赔，您应自行处理并承担由此产生的全部法律责任。如果您的违法或违约行为导致公司需向第三方赔偿，您应全额赔偿公司的全部损失。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '7.3 The Company respects and protects intellectual property rights, reputation rights, name rights, privacy rights, and other legitimate rights. You guarantee that the content you upload does not infringe any third party\'s legitimate rights.' : '7.3 公司尊重并保护知识产权、名誉权、姓名权、隐私权等合法权益。您保证您上传的内容不侵犯任何第三方的合法权益。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 8. Changes, Interruption, and Termination */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-orange-500/10 text-orange-400 shrink-0"><RefreshCw className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "8. Changes, Interruption, and Termination of Services" : "八、服务的变更、中断和终止"}</h2>
                  <p className="leading-loose">{lang === "en" ? '8.1 You understand and agree that "Star Gaze" software and related services are provided based on the status quo achievable by existing technology and conditions. The Company will do its best to ensure the continuity and security of services. You understand that the Company cannot foresee and prevent risks at any time, including but not limited to service interruptions caused by force majeure, network reasons, third-party service defects, etc.' : '8.1 您理解并同意，"Star Gaze"软件及相关服务是基于现有技术和条件所能达到的现状提供的。公司将尽最大努力确保服务的连续性和安全性。您理解公司无法随时预见和防范风险，包括但不限于因不可抗力、网络原因、第三方服务缺陷等导致的服务中断。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '8.2 You understand and agree that for the needs of overall service operation and platform operation security, the Company has the right to decide service/function settings and scope, and to modify, interrupt, suspend, or terminate "Star Gaze" software and related services based on specific circumstances.' : '8.2 您理解并同意，为了整体服务运营和平台运营安全的需要，公司有权决定服务/功能设置及范围，并根据具体情况修改、中断、暂停或终止"Star Gaze"软件及相关服务。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 9. Advertising */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0"><Megaphone className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "9. Advertising" : "九、广告"}</h2>
                  <p className="leading-loose">{lang === "en" ? '9.1 You understand and agree that the Company may push relevant information, advertising releases, or brand promotion services to you during your use of "Star Gaze" software and related services.' : '9.1 您理解并同意，公司可能在您使用"Star Gaze"软件及相关服务期间向您推送相关信息、广告发布或品牌推广服务。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '9.2 The Company fulfills relevant obligations for advertising and promotion. You should judge the authenticity and reliability of such advertising or promotion information yourself and be responsible for your own judgment.' : '9.2 公司履行广告和推广的相关义务。您应自行判断此类广告或推广信息的真实性和可靠性，并对您自己的判断负责。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 10. Intellectual Property */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-teal-500/10 text-teal-400 shrink-0"><Scale className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "10. Intellectual Property" : "十、知识产权"}</h2>
                  <p className="leading-loose">{lang === "en" ? '10.1 The intellectual property rights of the content provided by the Company in "Star Gaze" software (including but not limited to software, technology, programs, webpages, text, pictures, images, audio, video, charts, layout design, electronic documents, etc.) belong to the Company. No one may use them without permission.' : '10.1 公司在"Star Gaze"软件中提供的内容（包括但不限于软件、技术、程序、网页、文字、图片、图像、音频、视频、图表、版面设计、电子文档等）的知识产权归公司所有。未经许可，任何人不得使用。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '10.2 You understand and agree that the content you publish and upload when using "Star Gaze" is originally created by you or has been legally authorized. The intellectual property rights of any content you upload or publish belong to you or the original copyright owner.' : '10.2 您理解并同意，您使用"Star Gaze"时发布和上传的内容由您原创或已获得合法授权。您上传或发布的任何内容的知识产权归您或原著作权人所有。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '10.3 You know, understand, and agree that for the content you publish through "Star Gaze", you grant the Company a worldwide, free, non-exclusive, sublicensable right.' : '10.3 您知悉、理解并同意，对于您通过"Star Gaze"发布的内容，您授予公司全球范围内免费的、非独占的、可分许可的权利。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '10.4 You confirm and agree to authorize the Company to defend rights against infringement of the intellectual property rights of the content you upload and publish in the Company\'s own name or by entrusting a professional third party.' : '10.4 您确认并同意授权公司以自己的名义或委托专业第三方对您上传和发布的内容的知识产权侵权进行维权。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 11. Taxation */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-lime-500/10 text-lime-400 shrink-0"><Receipt className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "11. Taxation" : "十一、税务"}</h2>
                  <p className="leading-loose">{lang === "en" ? '11.1 Your income (if any) in "Star Gaze" software and related services will be withdrawn directly in cash or equivalent form. You understand and agree that the Company has the right to withhold and pay taxes for you, and declare and pay to the tax authorities in accordance with national laws and regulations.' : '11.1 您在"Star Gaze"软件及相关服务中的收入（如有）将以现金或等值形式直接提取。您理解并同意，公司有权为您代扣代缴税款，并根据国家法律法规向税务机关申报和缴纳。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 12. Disclaimer */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-rose-500/10 text-rose-400 shrink-0"><ShieldX className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "12. Disclaimer" : "十二、免责声明"}</h2>
                  <p className="leading-loose">{lang === "en" ? '12.1 You understand and agree that "Star Gaze" software and related services may be affected or interfered with by various factors, and the Company does not guarantee that:' : '12.1 您理解并同意，"Star Gaze"软件及相关服务可能受到各种因素的影响或干扰，公司不保证：'}</p>
                  <ul className="list-disc pl-6 space-y-1 mt-3 text-gray-300 text-sm">
                    <li>{lang === "en" ? '"Star Gaze" software and related services fully meet user requirements' : '"Star Gaze"软件及相关服务完全满足用户需求'}</li>
                    <li>{lang === "en" ? '"Star Gaze" software and related services are undisturbed, timely, safe, reliable, or error-free' : '"Star Gaze"软件及相关服务不受干扰、及时、安全、可靠或无错误'}</li>
                    <li>{lang === "en" ? 'Any errors in "Star Gaze" software and related services will be corrected' : '"Star Gaze"软件及相关服务中的任何错误都将得到纠正'}</li>
                  </ul>
                  <p className="leading-loose mt-3">{lang === "en" ? '12.2 You understand and agree that during the use of "Star Gaze" software and related services, force majeure factors may be encountered, including but not limited to natural disasters, government actions, wars, strikes, riots, etc. When force majeure occurs, the Company will strive to repair it in time, but is exempted from liability for losses caused by force majeure within the scope of laws and regulations.' : '12.2 您理解并同意，在使用"Star Gaze"软件及相关服务期间，可能会遇到不可抗力因素，包括但不限于自然灾害、政府行为、战争、罢工、暴乱等。不可抗力发生时，公司将尽力及时修复，但对于法律法规范围内因不可抗力造成的损失免除责任。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '12.3 In no event shall the Company be liable for any indirect, consequential, punitive, incidental, special, or penal damages, including loss of profits suffered by you due to your use of "Star Gaze" software and related services.' : '12.3 在任何情况下，公司均不对任何间接的、后果性的、惩罚性的、附带的、特殊的或惩戒性的损害承担责任，包括因您使用"Star Gaze"软件及相关服务而遭受的利润损失。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 13. Special Agreement on Individual Services and Third-Party Services */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-violet-500/10 text-violet-400 shrink-0"><Layers className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "13. Special Agreement on Individual Services and Third-Party Services" : "十三、单项服务及第三方服务特别约定"}</h2>
                  <p className="leading-loose">{lang === "en" ? '13.1 "Star Gaze" software and related services contain information obtained by the Company in various legal ways, and also include other individual services legally operated by the Company and its affiliates. Certain individual services may require you to accept agreements specially formulated for such services.' : '13.1 "Star Gaze"软件及相关服务包含公司通过各种合法途径获取的信息，也包括公司及其关联方合法运营的其他单项服务。某些单项服务可能需要您接受专门为此类服务制定的协议。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '13.2 When you use software and related services provided by third parties in "Star Gaze", in addition to abiding by this Agreement, you may also need to agree to and abide by the third party\'s agreements and privacy policies. Disputes arising from third-party software and related services shall be resolved by you and the third party.' : '13.2 当您在"Star Gaze"中使用第三方提供的软件及相关服务时，除遵守本协议外，您可能还需要同意并遵守第三方的协议和隐私政策。因第三方软件及相关服务产生的争议由您与第三方解决。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '13.3 "Star Gaze" integrates and uses third-party services including but not limited to TikTok and cloud infrastructure or platform service providers. When you use these services, you agree to abide by their relevant terms of service.' : '13.3 "Star Gaze"集成并使用第三方服务，包括但不限于 TikTok 以及云基础设施或平台服务提供商。当您使用这些服务时，您同意遵守其相关服务条款。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 14. Minors Use Terms */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-amber-500/10 text-amber-400 shrink-0"><Baby className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "14. Minors Use Terms" : "十四、未成年人使用条款"}</h2>
                  <p className="leading-loose">{lang === "en" ? '14.1 If you are a minor under the age of 18, you should use "Star Gaze" software and related services under the guardianship and guidance of your guardian and with the consent of your guardian, after carefully reading and agreeing to this Agreement.' : '14.1 如您是未满18周岁的未成年人，应在监护人的监护和指导下，在仔细阅读并同意本协议后，经监护人同意后使用"Star Gaze"软件及相关服务。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '14.2 The Company attaches importance to the protection of minors\' personal information. Minor users should strengthen their awareness of personal protection and treat it specifically when filling in personal information.' : '14.2 公司重视对未成年人个人信息的保护。未成年用户应增强个人保护意识，在填写个人信息时特别对待。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '14.3 Minor users and their guardians understand and confirm that if you violate laws and regulations or the content of this Agreement, you and your guardians shall bear all legal responsibilities that may result therefrom according to the law.' : '14.3 未成年用户及其监护人理解并确认，如您违反法律法规或本协议内容，您及您的监护人应依法承担由此可能产生的全部法律责任。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '14.4 Special Note for Minor Users: Teenagers should use "Star Gaze" software and related services correctly within a reasonable range under the supervision and guidance of their guardians, avoid addiction to virtual cyberspace, and develop good internet surfing habits.' : '14.4 未成年用户特别提示：青少年应在监护人的监督和指导下，在合理范围内正确使用"Star Gaze"软件及相关服务，避免沉迷网络虚拟空间，养成良好的上网习惯。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 15. Others */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-slate-500/10 text-slate-400 shrink-0"><MoreHorizontal className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "15. Others" : "十五、其他"}</h2>
                  <p className="leading-loose">{lang === "en" ? '15.1 The conclusion, effectiveness, performance, interpretation, and dispute resolution of this Agreement shall be governed by the laws of the People\'s Republic of China. If any provision is invalid or unenforceable, these terms shall be re-interpreted as closely as possible to the original intent.' : '15.1 本协议的订立、效力、履行、解释及争议解决均适用中华人民共和国法律。如有任何条款无效或不可执行，该条款应尽可能接近原意重新解释。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '15.2 The signing place of this Agreement is Wuhan, Hubei Province. If any dispute arises, both parties shall try to resolve it through friendly negotiation. If negotiation fails, you agree to submit the dispute to the People\'s Court where the Company is located.' : '15.2 本协议签订地为湖北省武汉市。如发生任何争议，双方应首先通过友好协商解决。如协商不成，您同意将争议提交至公司所在地的人民法院。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '15.3 In order to provide you with better services or due to adjustments in national laws, regulations, and policies, "Star Gaze" software and related services will be updated and changed from time to time, and we will revise this Agreement in due course. If you continue to use "Star Gaze", it means you have agreed to accept the revised content.' : '15.3 为向您提供更好的服务或因应国家法律法规及政策的调整，"Star Gaze"软件及相关服务将不时更新和变更，我们将适时修订本协议。如您继续使用"Star Gaze"，即表示您已同意接受修订后的内容。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '15.4 The headings in this Agreement are set for convenience and reading only and do not affect the meaning or interpretation of any provision.' : '15.4 本协议中的标题仅为方便阅读而设置，不影响任何条款的含义或解释。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '15.5 You and the Company are independent subjects. In no case does this Agreement constitute any form of express or implied guarantee, nor does it constitute an agency, partnership, joint venture, or employment relationship between the parties.' : '15.5 您与公司为独立主体。本协议在任何情况下均不构成任何形式的明示或暗示保证，也不构成双方之间的代理、合伙、合资或雇佣关系。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '15.6 The copyright of this Agreement belongs to the Company, and the Company reserves all rights of interpretation and modification.' : '15.6 本协议的著作权归公司所有，公司保留所有解释和修改的权利。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 16. TikTok Platform Integration Terms */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-fuchsia-500/10 text-fuchsia-400 shrink-0"><Music2 className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "16. TikTok Platform Integration Terms" : "十六、TikTok 平台集成条款"}</h2>
                  <p className="leading-loose mb-3 text-sm bg-white/5 rounded-lg p-3 border border-white/10">{lang === "en" ? 'Note: Star Gaze is registered as "Wuhan Guanxing Cultural Media" on TikTok for Developers (Content Posting API), and used under the TikTok Shop service provider account name "Star Gaze".' : '说明：Star Gaze 在 TikTok for Developers（内容发布 API）的注册应用名称为 "Wuhan Guanxing Cultural Media"，在 TikTok Shop 的服务商账户名称为 "Star Gaze"。'}</p>
                  <p className="leading-loose">{lang === "en" ? '16.1 Service Description: Star Gaze integrates with the TikTok platform through two API systems: (a) Content Posting API — for directly publishing AI-generated videos and photos to your TikTok account (Direct Post mode); (b) TikTok Shop API — for publishing shoppable videos with product links from your product showcase. You must authorize the corresponding TikTok account before using each service.' : '16.1 服务描述：Star Gaze 通过两套 API 系统与 TikTok 平台集成：(a) 内容发布 API — 将 AI 生成的视频和图片直接发布到您的 TikTok 账户（Direct Post 模式）；(b) TikTok Shop API — 发布带有橱窗商品链接的带货视频。您需要先授权相应的 TikTok 账户才能使用各项服务。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '16.2 User Responsibilities: You are solely responsible for all content published through Star Gaze to TikTok. You must ensure that content complies with TikTok\'s Community Guidelines, Terms of Service, and applicable laws. You are responsible for compliance with all AIGC content disclosure requirements.' : '16.2 用户责任：您对通过 Star Gaze 发布到 TikTok 的所有内容承担全部责任。您必须确保内容符合 TikTok 的社区准则、服务条款和适用法律。您有责任遵守所有 AIGC 内容披露要求。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '16.3 Content Publishing: Star Gaze publishes content to TikTok on your behalf using the Direct Post mode. Once published, review and management of the content are subject to TikTok platform rules. Star Gaze does not guarantee that content will pass TikTok\'s review process. Content posted during the Sandbox/testing phase may be restricted to private visibility until the app is fully approved.' : '16.3 内容发布：Star Gaze 使用 Direct Post 模式代您将内容发布到 TikTok。发布后，内容的审核和管理遵循 TikTok 平台规则。Star Gaze 不保证内容一定通过 TikTok 的审核流程。在 Sandbox/测试阶段发布的内容可能被限制为私密可见，直到应用通过完整审核。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '16.4 Showcase Product Data (TikTok Shop): Product information displayed on the platform is sourced from your TikTok Shop showcase, including product name, price, commission rate, and images. This information is used solely to help you select products for shoppable video creation and is not stored permanently on our servers.' : '16.4 橱窗商品数据（TikTok Shop）：平台展示的商品信息来源于您的 TikTok Shop 橱窗，包括商品名称、价格、佣金率和图片。此信息仅用于帮助您选择商品进行带货视频创作，不会永久存储在我们的服务器上。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '16.5 Branded/Commercial Content Disclosure: If your published content promotes a brand, product, or service — whether through paid partnerships, gifted collaborations, or any form of compensation — you must enable TikTok\'s "Disclose commercial content" setting. Star Gaze may apply this setting automatically when publishing shoppable videos with product links.' : '16.5 品牌/商业内容披露：如果您发布的内容推广品牌、产品或服务 — 无论是通过付费合作、赠品合作还是任何形式的报酬 — 您必须启用 TikTok 的"披露商业内容"设置。当发布带商品链接的带货视频时，Star Gaze 可能会自动应用此设置。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '16.6 Data and Authorization Revocation: You may revoke Star Gaze\'s access to your TikTok account at any time. Upon revocation, we will delete all associated TikTok data within 30 days. Please refer to our Privacy Policy for detailed data handling practices.' : '16.6 数据和授权撤回：您可以随时撤回 Star Gaze 对您 TikTok 账户的访问权限。撤回后，我们将在 30 天内删除所有相关的 TikTok 数据。详细的数据处理方式请参见我们的隐私政策。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? "16.7 Related Terms:" : "16.7 相关条款："}</p>
                  <ul className="list-disc pl-6 space-y-1 mt-2 text-gray-300 text-sm">
                    <li><Link href="https://www.tiktok.com/legal/page/row/terms-of-service/en" target="_blank" className="text-cyan-400 hover:underline">TikTok Terms of Service</Link></li>
                    <li><Link href="https://www.tiktok.com/legal/tik-tok-developer-terms-of-service?lang=en" target="_blank" className="text-cyan-400 hover:underline">TikTok Developer Terms of Service</Link></li>
                    <li><Link href="https://partner.tiktokshop.com/docv2/page/6507ead7b99d5302be949ba9" target="_blank" className="text-cyan-400 hover:underline">TikTok Shop Developer Terms of Service</Link></li>
                    <li><Link href="https://www.tiktok.com/legal/privacy-policy?lang=en" target="_blank" className="text-cyan-400 hover:underline">TikTok Privacy Policy</Link></li>
                  </ul>
                </div>
              </div>
            </ReflectiveCard>

            {/* 17. Subscription */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0"><DollarSign className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "17. Subscription" : "十七、订阅"}</h2>
                  <p className="leading-loose">{lang === "en" ? '17.1 Subscription Upgrade and Downgrade: When changing from one paid plan to another, the new plan will be prorated by calculating the remaining days of the two plans and their respective daily rates.' : '17.1 订阅升级和降级：从一个付费计划更改为另一个付费计划时，新计划将通过计算两个计划的剩余天数及其各自的日费率进行按比例计算。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '17.2 Fee Changes: We may change plan fees from time to time and will notify you in advance. Price changes will take effect at the beginning of the next subscription period. If you do not agree to the price change, you must cancel your subscription before the price change takes effect.' : '17.2 费用变更：我们可能会不时更改计划费用，并会提前通知您。价格变更将在下一个订阅期开始时生效。如果您不同意价格变更，您必须在价格变更生效前取消订阅。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '17.3 Subscription Cancellation: You can cancel your subscription at any time. After cancellation, your subscription will expire at the end of the current cycle. Paid fees are non-refundable.' : '17.3 订阅取消：您可以随时取消订阅。取消后，您的订阅将在当前周期结束时到期。已付费用不予退还。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 18. AIGC Content Terms */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0"><Sparkles className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "18. AIGC Content Terms" : "十八、AIGC 内容条款"}</h2>
                  <p className="leading-loose">{lang === "en" ? '18.1 Star Gaze uses artificial intelligence technology to generate video content, including AI characters, voiceovers, and scripts. All content generated through Star Gaze is AI-generated content (AIGC).' : '18.1 Star Gaze 使用人工智能技术生成视频内容，包括 AI 角色、配音和脚本。通过 Star Gaze 生成的所有内容均为 AI 生成内容 (AIGC)。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '18.2 AI-generated videos published through Star Gaze to TikTok will be automatically labeled as AIGC in compliance with TikTok\'s content policies. You authorize Star Gaze to apply this labeling to your published content.' : '18.2 通过 Star Gaze 发布到 TikTok 的 AI 生成视频将按照 TikTok 的内容政策自动标注为 AIGC。您授权 Star Gaze 对您发布的内容应用此标注。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '18.3 AI characters created on Star Gaze are original AI-generated artwork with no real-person likeness concerns, and are safe for commercial use. However, you shall not use AI-generated content to mislead, deceive, or impersonate real individuals.' : '18.3 在 Star Gaze 上创建的 AI 角色是原创的 AI 生成艺术作品，不涉及真人肖像权问题，可安全用于商业场景。但您不得使用 AI 生成内容来误导、欺骗或冒充真实个人。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '18.4 You understand and agree that AI-generated content may not be perfect and may contain errors. Star Gaze does not guarantee the accuracy, quality, or suitability of AI-generated content for any specific purpose.' : '18.4 您理解并同意，AI 生成的内容可能不完美并可能包含错误。Star Gaze 不保证 AI 生成内容的准确性、质量或适合任何特定目的。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 19. Data Hosting and Transfer */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400 shrink-0"><Globe className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "19. Data Hosting and Transfer" : "十九、数据存储与传输"}</h2>
                  <p className="leading-loose">{lang === "en" ? '19.1 Star Gaze stores and processes user data on infrastructure located in the United States. TikTok-related data, including OAuth tokens and user identifiers, is stored and processed on US-based servers.' : '19.1 Star Gaze 将用户数据存储并处理于位于美国的基础设施上。TikTok 相关数据，包括 OAuth 令牌和用户标识符，存储并处理于美国服务器上。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '19.2 All data transmission between systems is encrypted using TLS 1.2 or above. We apply appropriate safeguards to protect data handled through our services.' : '19.2 系统之间的所有数据传输均使用 TLS 1.2 及以上协议加密。我们对通过本服务处理的数据采取适当的安全保护措施。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '19.3 By using Star Gaze, you consent to the transfer and processing of your data as described in this section and in our Privacy Policy.' : '19.3 使用 Star Gaze 即表示您同意按照本条款和我们的隐私政策中描述的方式传输和处理您的数据。'}</p>
                </div>
              </div>
            </ReflectiveCard>

            {/* 20. YouTube Platform Integration Terms */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <Link href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" aria-label="YouTube Terms of Service" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]"><YouTubeBrandIcon compact className="h-[38px] w-11" /></Link>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "20. YouTube Platform Integration Terms" : "二十、YouTube 平台集成条款"}</h2>
                  <p className="leading-loose">{lang === "en" ? '20.1 Service Description: Subject to availability and your authorization, Star Gaze uses YouTube API Services to connect a channel, display channel information, upload and schedule videos, select metadata and visibility, synchronize comments, translate comments at your request, and submit replies that you initiate or confirm.' : '20.1 服务说明：在相关功能可用且您已完成授权的前提下，Star Gaze 使用 YouTube API 服务绑定频道、展示频道信息、上传和定时发布视频、选择元数据与可见性、同步评论、按您的请求翻译评论，以及提交由您主动发起或确认的回复。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '20.2 YouTube Terms: By accessing or using YouTube API Services through Star Gaze, you also agree to be bound by the YouTube Terms of Service. Your use is additionally subject to applicable YouTube and Google policies.' : '20.2 YouTube 条款：当您通过 Star Gaze 访问或使用 YouTube API 服务时，即表示您同时同意受 YouTube 服务条款约束。您的使用还应遵守适用的 YouTube 与 Google 政策。'}</p>
                  <p className="leading-loose mt-2"><Link href="https://www.youtube.com/t/terms" target="_blank" className="text-cyan-400 hover:underline">YouTube Terms of Service</Link></p>
                  <p className="leading-loose mt-3">{lang === "en" ? '20.3 Authorization: You represent that you own or are lawfully authorized to manage every Google account and YouTube channel you connect. Star Gaze requests the youtube.force-ssl permission because YouTube provides no narrower scope for user-initiated comment replies. Although that scope can technically permit broad actions, Star Gaze uses it only for the visible channel, publishing, comment-reading, and user-confirmed reply features described here and in our Privacy Policy.' : '20.3 授权：您声明并保证，您拥有或有权合法管理所绑定的每个 Google 账号和 YouTube 频道。Star Gaze 请求 youtube.force-ssl 权限，是因为 YouTube 没有支持用户主动回复评论的更窄权限。尽管该权限在技术上可支持较广泛操作，Star Gaze 仅将其用于本条款及隐私政策所述的频道、发布、评论读取和用户确认回复等可见功能。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '20.4 User Control: You retain final control over the selected channel, video, title, description, tags, category, audience and synthetic-media settings, privacy status, publication time, and reply text. A video publication or comment reply is submitted only after you initiate or confirm it. You must review translated text before using it in a reply.' : '20.4 用户控制：您对所选频道、视频、标题、描述、标签、分类、受众与合成媒体设置、可见性、发布时间及回复文本保留最终控制权。视频发布或评论回复仅在您主动发起或确认后提交。您必须在使用翻译文本回复前自行审核。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '20.5 User Responsibility: You are responsible for the legality, accuracy, rights, licenses, disclosures, and platform compliance of all content and replies submitted through Star Gaze. You must comply with applicable law, the YouTube Terms of Service, YouTube Community Guidelines, copyright and publicity rights, and rules for advertising, commercial content, and synthetic or altered media.' : '20.5 用户责任：您对通过 Star Gaze 提交的所有内容与回复的合法性、准确性、权利许可、披露及平台合规性负责。您必须遵守适用法律、YouTube 服务条款、YouTube 社区准则、著作权与肖像权规则，以及广告、商业内容和合成或修改媒体的相关规定。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '20.6 Platform Decisions: YouTube independently controls processing, moderation, availability, visibility, monetization, removal, and other treatment of content. Star Gaze does not guarantee that a video or reply will be accepted, displayed, made public, recommended, monetized, or retained. An API project that has not completed a required YouTube compliance audit may be restricted by YouTube, including private-only uploads.' : '20.6 平台决定：YouTube 独立决定内容的处理、审核、可用性、可见性、商业化、删除及其他处置方式。Star Gaze 不保证视频或回复一定会被接受、展示、公开、推荐、商业化或保留。尚未完成 YouTube 要求的合规审计的 API 项目可能受到限制，包括上传内容仅限私密可见。'}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? '20.7 Privacy, Revocation, and Deletion: Our handling of YouTube and Google user data is described in the Star Gaze Privacy Policy. You may disconnect one account, use the “Delete all YouTube data” control, or revoke access through Google Account settings. Local deletion is completed independently of Google availability; if a remote revocation attempt is temporarily unsuccessful, Star Gaze retries it for no more than seven calendar days. Disconnecting Star Gaze or deleting locally stored data does not delete content stored by YouTube; YouTube-hosted content must be managed through YouTube or another authorized client that supports deletion.' : '20.7 隐私、撤权与删除：我们对 YouTube 与 Google 用户数据的处理方式详见 Star Gaze 隐私政策。您可以解绑单个账号、使用“删除全部 YouTube 数据”功能，或通过 Google 账号设置撤销访问。本地删除不依赖 Google 是否可用；如远程撤权暂时失败，Star Gaze 将在不超过七个自然日的期限内重试。解绑 Star Gaze 或删除本地保存的数据不会删除 YouTube 平台保存的内容；YouTube 平台内容必须通过 YouTube 或其他支持删除的授权客户端进行管理。'}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-sm">
                    <Link href="/privacy" className="text-cyan-400 hover:underline">{lang === "en" ? "Star Gaze Privacy Policy" : "Star Gaze 隐私政策"}</Link>
                    <Link href="https://security.google.com/settings/security/permissions" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google Account third-party connections" : "Google 账号第三方连接"}</Link>
                    <Link href="https://policies.google.com/privacy" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google Privacy Policy" : "Google 隐私政策"}</Link>
                  </div>
                </div>
              </div>
            </ReflectiveCard>

            {/* 21. Facebook Platform Integration Terms */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-blue-500/10 text-blue-400 shrink-0"><Share2 className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "21. Facebook Platform Integration Terms" : "二十一、Facebook 平台集成条款"}</h2>
                  <p className="leading-loose">{lang === "en" ? "21.1 Service Description: Subject to availability and your authorization, Star Gaze uses Meta Platform APIs to connect Facebook Pages you manage, display Page information, publish or schedule Page videos and posts, synchronize Page comments through API calls and webhooks, and submit replies that you initiate or confirm." : "21.1 服务说明：在相关功能可用且您已完成授权的前提下，Star Gaze 使用 Meta 平台 API 绑定您管理的 Facebook Page、展示 Page 信息、发布或预约发布 Page 视频与帖子、通过 API 调用和 webhook 同步 Page 评论，以及提交由您主动发起或确认的回复。"}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? "21.2 Meta Terms: By accessing Facebook features through Star Gaze, you agree to comply with applicable Meta terms, policies, Page rules, community standards, and developer requirements." : "21.2 Meta 条款：当您通过 Star Gaze 使用 Facebook 功能时，您同意遵守适用的 Meta 条款、政策、Page 规则、社群守则及开发者要求。"}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? "21.3 Authorization: You represent that you own or are lawfully authorized to manage every Facebook Page you connect. You decide which available Pages to connect. Star Gaze requests Page permissions only for the visible Page listing, metadata and webhook subscription, content reading, publishing, comment reading, and user-confirmed reply features described here and in our Privacy Policy." : "21.3 授权：您声明并保证，您拥有或有权合法管理所绑定的每个 Facebook Page。您自行决定绑定哪些可用 Page。Star Gaze 仅为本条款及隐私政策所述的可见 Page 列表、元数据与 webhook 订阅、内容读取、发布、评论读取及用户确认回复功能请求 Page 权限。"}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? "21.4 User Control: You retain final control over the selected Page, source media, text, publication timing, and reply text. Star Gaze submits a publication or reply only after you initiate or confirm the action. You are responsible for reviewing content before submission." : "21.4 用户控制：您对所选 Page、源媒体、文本、发布时间及回复文本保留最终控制权。Star Gaze 仅在您主动发起或确认操作后提交发布或回复。您有责任在提交前审核内容。"}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? "21.5 User Responsibility: You are responsible for the legality, accuracy, rights, licenses, disclosures, and platform compliance of all content and replies submitted through Star Gaze, including compliance with copyright, publicity, advertising, commercial-content, and synthetic-media requirements." : "21.5 用户责任：您对通过 Star Gaze 提交的所有内容与回复的合法性、准确性、权利许可、披露及平台合规性负责，包括遵守著作权、肖像权、广告、商业内容及合成媒体相关要求。"}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? "21.6 Platform Decisions: Meta independently controls processing, moderation, availability, visibility, recommendation, monetization, removal, and other treatment of Facebook content. Star Gaze does not guarantee that a publication or reply will be accepted, displayed, recommended, monetized, or retained." : "21.6 平台决定：Meta 独立决定 Facebook 内容的处理、审核、可用性、可见性、推荐、商业化、删除及其他处置方式。Star Gaze 不保证发布内容或回复一定会被接受、展示、推荐、商业化或保留。"}</p>
                  <p className="leading-loose mt-3">{lang === "en" ? "21.7 Privacy, Revocation, and Deletion: Our handling of Facebook Platform Data is described in the Star Gaze Privacy Policy. You may disconnect one Page, use “Delete all Facebook data,” revoke access through Facebook Apps and Websites settings, use Meta’s data-deletion mechanism, or contact us. Deleting locally stored data does not delete content hosted by Facebook." : "21.7 隐私、撤权与删除：我们对 Facebook 平台数据的处理方式详见 Star Gaze 隐私政策。您可以解绑单个 Page、使用“删除全部 Facebook 数据”、通过 Facebook“应用和网站”设置撤销访问、使用 Meta 的数据删除机制，或联系我们。删除本地保存的数据不会删除 Facebook 平台托管的内容。"}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-sm">
                    <Link href="/privacy" className="text-cyan-400 hover:underline">{lang === "en" ? "Star Gaze Privacy Policy" : "Star Gaze 隐私政策"}</Link>
                    <Link href="https://developers.facebook.com/terms/" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Meta Platform Terms" : "Meta 平台条款"}</Link>
                    <Link href="https://www.facebook.com/settings?tab=applications" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Facebook Apps and Websites settings" : "Facebook 应用和网站设置"}</Link>
                  </div>
                </div>
              </div>
            </ReflectiveCard>

            {/* Contact Info */}
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-white/10 text-white shrink-0"><Phone className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Contact Information" : "联系方式"}</h2>
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
            <div className="text-gray-500 text-sm">© {new Date().getFullYear()} {lang === "en" ? "Star Gaze by Wuhan Guanxing Cultural Media Co., Ltd. All Rights Reserved" : "Star Gaze · 武汉观星文化传媒有限公司 版权所有"}</div>
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
