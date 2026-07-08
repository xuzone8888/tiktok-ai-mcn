"use client";

import Link from "next/link";
import ReflectiveCard from "@/components/ui/ReflectiveCard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock, Database, FileText, Globe, Mail, Shield, Trash2 } from "lucide-react";
import { useLang } from "@/contexts/LangContext";

export default function DataDeletionPage() {
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
            <h1 className="text-4xl font-bold mb-4">{lang === "en" ? "Data Deletion Instructions" : "数据删除说明"}</h1>
            <p className="text-gray-400">{lang === "en" ? "Updated Date: July 1, 2026" : "更新日期：2026年7月1日"}</p>
            <p className="text-gray-400">{lang === "en" ? "Effective Date: July 1, 2026" : "生效日期：2026年7月1日"}</p>
          </div>

          <div className="space-y-6 text-gray-300">
            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 shrink-0"><FileText className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Overview" : "概述"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? "This page explains how Star Gaze users may request deletion or anonymization of account data, connected platform authorization data, WhatsApp contacts, WhatsApp message records, and related operational metadata." : "本页面说明 Star Gaze 用户如何请求删除或匿名化账户数据、已连接平台授权数据、WhatsApp 联系人、WhatsApp 消息记录以及相关运营元数据。"}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? "These instructions apply to the current Star Gaze product configuration and may be updated as the service evolves." : "本说明适用于当前 Star Gaze 产品配置，并可能随服务变化进行更新。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 shrink-0"><Database className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Data Covered by a Deletion Request" : "删除请求覆盖的数据"}</h2>
                  <ul className="list-disc pl-6 space-y-2 text-gray-300">
                    <li>{lang === "en" ? "Star Gaze account profile data, workspace membership data, and related application settings." : "Star Gaze 账户资料、工作区成员数据和相关应用设置。"}</li>
                    <li>{lang === "en" ? "Connected platform authorization data, including access tokens, refresh tokens where applicable, account mappings, and platform account identifiers for TikTok, YouTube, Facebook, Instagram, LinkedIn where enabled, and WhatsApp/Meta." : "已连接平台授权数据，包括 TikTok、YouTube、Facebook、Instagram、已启用时的 LinkedIn 以及 WhatsApp/Meta 的访问令牌、适用的刷新令牌、账号映射和平台账号标识符。"}</li>
                    <li>{lang === "en" ? "Content publishing records and operational logs that are no longer required for security, billing, legal, or dispute handling." : "不再因安全、账务、法律或争议处理所需保留的内容发布记录和运营日志。"}</li>
                    <li>{lang === "en" ? "WhatsApp Inbox contacts, conversations, messages, delivery statuses, error records, timestamps, and webhook/API metadata associated with the requesting account or workspace." : "与请求账户或工作区相关的 WhatsApp Inbox 联系人、会话、消息、投递状态、错误记录、时间戳以及 webhook/API 元数据。"}</li>
                  </ul>
                </div>
              </div>
            </ReflectiveCard>

            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-green-500/10 text-green-400 shrink-0"><Shield className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "WhatsApp and Meta Data" : "WhatsApp 与 Meta 数据"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? "If WhatsApp Inbox is enabled, a deletion request may cover WhatsApp phone number ID, WhatsApp Business Account ID, customer phone number, wa_id, display name, country where available, inbound and outbound message text, media ID, media URL where stored, message status, error reason, sent or received timestamps, and webhook payload metadata." : "如果启用了 WhatsApp Inbox，删除请求可覆盖 WhatsApp phone number id、WhatsApp business account id、客户手机号、wa_id、显示名称、可用时的国家/地区、入站和出站消息文本、media id、已保存时的 media URL、消息状态、错误原因、发送或接收时间戳以及 webhook payload 元数据。"}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? "We use this data only for Inbox display, manual customer support replies initiated by authorized users, message status tracking, security review, and troubleshooting. We do not sell WhatsApp or Meta data and do not use WhatsApp Inbox for unsolicited automated marketing broadcasts." : "我们仅将这些数据用于 Inbox 展示、授权用户人工触发的客户支持回复、消息状态追踪、安全审查和故障排查。我们不会出售 WhatsApp 或 Meta 数据，也不会使用 WhatsApp Inbox 进行未经请求的自动营销群发。"}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? "When a WhatsApp or Meta authorization is disconnected, we delete related tokens and account mappings within 30 days unless retention is required by law or necessary for security, billing, or dispute records." : "当 WhatsApp 或 Meta 授权断开后，除法律要求或安全、账务、争议记录所需外，我们将在 30 天内删除相关令牌和账号映射。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-pink-500/10 text-pink-400 shrink-0"><Mail className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "How to Submit a Request" : "如何提交请求"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? "Email us at toryxai@outlook.com with the subject line \"Data Deletion Request\". Please include the Star Gaze account email, workspace or company name if applicable, connected platform account name or ID if applicable, and a short description of the data you want deleted." : "请发送邮件至 toryxai@outlook.com，邮件主题填写“数据删除请求”。请包含 Star Gaze 账户邮箱、适用时的工作区或公司名称、适用时的已连接平台账号名称或 ID，以及您希望删除的数据范围简述。"}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? "We may request additional information to verify that the requester is authorized to act for the relevant account or workspace. Please do not send passwords, payment credentials, or other secrets by email." : "我们可能要求补充信息，以核实请求人有权代表相关账户或工作区操作。请不要通过邮件发送密码、支付凭据或其他密钥。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-orange-500/10 text-orange-400 shrink-0"><Clock className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Processing Timeline" : "处理周期"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? "After receiving a valid deletion request and verifying authorization, we will delete or anonymize applicable data within 30 days unless a longer retention period is required by law, security, fraud prevention, billing, dispute handling, or backup recovery constraints." : "收到有效删除请求并完成授权核实后，除法律、安全、反欺诈、账务、争议处理或备份恢复限制要求更长保留期外，我们将在 30 天内删除或匿名化适用数据。"}</p>
                  <p className="leading-relaxed mt-3">{lang === "en" ? "Some records may remain in aggregated, de-identified, or backup form for a limited period before ordinary backup rotation completes." : "部分记录可能以聚合、去标识化或备份形式在有限期间内保留，直至常规备份轮转完成。"}</p>
                </div>
              </div>
            </ReflectiveCard>

            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-violet-500/10 text-violet-400 shrink-0"><Trash2 className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Platform Controls" : "平台控制入口"}</h2>
                  <p className="leading-relaxed">{lang === "en" ? "You may also revoke authorization directly from the relevant third-party platform. Platform revocation does not always delete data already stored in Star Gaze, so please email us if you also want Star Gaze records deleted or anonymized." : "您也可以直接从相关第三方平台撤回授权。平台撤权不一定会删除 Star Gaze 已保存的数据，因此如果您还希望删除或匿名化 Star Gaze 记录，请同时通过邮件联系我们。"}</p>
                  <ul className="list-disc pl-6 space-y-2 mt-3 text-gray-300">
                    <li><Link href="https://security.google.com/settings/security/permissions" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Google/YouTube connected app permissions" : "Google/YouTube 已连接应用权限"}</Link></li>
                    <li><Link href="https://www.facebook.com/privacy/policy" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "Meta Privacy Policy" : "Meta 隐私政策"}</Link></li>
                    <li><Link href="https://www.whatsapp.com/legal/privacy-policy" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "WhatsApp Privacy Policy" : "WhatsApp 隐私政策"}</Link></li>
                    <li><Link href="https://www.tiktok.com/legal/privacy-policy?lang=en" target="_blank" className="text-cyan-400 hover:underline">{lang === "en" ? "TikTok Privacy Policy" : "TikTok 隐私政策"}</Link></li>
                  </ul>
                </div>
              </div>
            </ReflectiveCard>

            <ReflectiveCard className="!rounded-xl">
              <div className="flex items-start gap-4 p-6">
                <div className="p-3 rounded-lg bg-white/10 text-white shrink-0"><Mail className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-xl font-bold text-white mb-3">{lang === "en" ? "Contact" : "联系方式"}</h2>
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
