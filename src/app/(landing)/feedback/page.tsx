"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare, Mail, Shield } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLang } from "@/contexts/LangContext";

// 反馈类型：value 作为稳定内部值（中文 UI 直接展示），labelEn 为英文模式下的显示文案
const FEEDBACK_TYPES = [
    { value: "功能建议", labelEn: "Feature Request" },
    { value: "Bug 报告", labelEn: "Bug Report" },
    { value: "其他", labelEn: "Other" },
];

export default function FeedbackPage() {
    const { toast } = useToast();
    const { lang } = useLang();
    const [feedbackType, setFeedbackType] = useState("功能建议");
    const [description, setDescription] = useState("");
    const [contactEmail, setContactEmail] = useState("");

    // 英文模式下取英文标签，中文模式下沿用原中文 value
    const typeLabel = (value: string) => {
        const t = FEEDBACK_TYPES.find((x) => x.value === value);
        return lang === "en" && t ? t.labelEn : value;
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!description.trim()) {
            toast({
                variant: "destructive",
                title: lang === "en" ? "Please enter your feedback" : "请填写反馈内容",
                description: lang === "en" ? "The description cannot be empty" : "问题描述不能为空",
            });
            return;
        }

        // 组装邮件内容
        const subject = encodeURIComponent(
            lang === "en"
                ? `[Star Gaze Feedback] ${typeLabel(feedbackType)}`
                : `[Star Gaze 反馈] ${feedbackType}`
        );
        const body = encodeURIComponent(
            lang === "en"
                ? `Feedback Type: ${typeLabel(feedbackType)}\n\nDescription:\n${description}\n\nContact Email: ${contactEmail || "Not provided"}`
                : `反馈类型：${feedbackType}\n\n问题描述：\n${description}\n\n联系邮箱：${contactEmail || "未提供"}`
        );
        const mailtoLink = `mailto:toryxai@outlook.com?subject=${subject}&body=${body}`;

        window.open(mailtoLink, "_blank");

        toast({
            title: lang === "en" ? "📧 Opening your email client" : "📧 即将打开邮箱",
            description:
                lang === "en"
                    ? "Please send the feedback from your email client — we'll reply as soon as possible."
                    : "请通过邮箱客户端发送反馈，我们会尽快回复",
        });
    };

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
                            <span className="text-lg font-bold text-white drop-shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                Star Gaze
                            </span>
                        </Link>
                        <Link href="/">
                            <Button variant="ghost" className="text-gray-300 hover:text-white">
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                {lang === "en" ? "Back to Home" : "返回首页"}
                            </Button>
                        </Link>
                    </nav>
                </div>
            </header>

            {/* 内容 */}
            <main className="relative z-10 py-20 px-6">
                <div className="container max-w-2xl mx-auto">
                    <div className="text-center mb-12">
                        <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-6 text-white">
                            <MessageSquare className="h-8 w-8" />
                        </div>
                        <h1 className="text-4xl font-bold mb-4">
                            {lang === "en" ? "Feedback & Suggestions" : "反馈与建议"}
                        </h1>
                        <p className="text-gray-400">
                            {lang === "en"
                                ? "Your suggestions drive us forward. Found a bug or have a feature request? Let us know."
                                : "你的建议是我们进步的动力。如果发现 Bug 或有新的功能需求，请告诉我们。"}
                        </p>
                    </div>

                    <form className="space-y-6 bg-white/5 border border-white/10 rounded-2xl p-8" onSubmit={handleSubmit}>
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                {lang === "en" ? "Feedback Type" : "反馈类型"}
                            </label>
                            <div className="grid grid-cols-3 gap-3">
                                {FEEDBACK_TYPES.map((type) => (
                                    <label key={type.value} className="cursor-pointer">
                                        <input
                                            type="radio"
                                            name="type"
                                            className="peer sr-only"
                                            checked={feedbackType === type.value}
                                            onChange={() => setFeedbackType(type.value)}
                                        />
                                        <div className="text-center py-3 rounded-xl bg-black/20 border border-white/10 peer-checked:bg-white peer-checked:text-black peer-checked:border-white transition-all text-sm font-medium">
                                            {lang === "en" ? type.labelEn : type.value}
                                        </div>
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                {lang === "en" ? "Description" : "问题描述"}
                            </label>
                            <textarea
                                rows={5}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/30 transition-colors resize-none"
                                placeholder={lang === "en" ? "Describe the issue or suggestion in detail..." : "请详细描述你遇到的问题或建议..."}
                            ></textarea>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                {lang === "en" ? "Contact Email (optional)" : "联系邮箱 (选填)"}
                            </label>
                            <input
                                type="email"
                                value={contactEmail}
                                onChange={(e) => setContactEmail(e.target.value)}
                                className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-white/30 transition-colors"
                                placeholder="your@email.com"
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full h-12 bg-white text-black hover:bg-gray-200 font-bold text-lg rounded-xl mt-4 group"
                        >
                            <Mail className="w-5 h-5 mr-2" />
                            {lang === "en" ? "Send Feedback via Email" : "通过邮件发送反馈"}
                        </Button>

                        <p className="text-xs text-gray-500 text-center">
                            {lang === "en"
                                ? "This will open your email client with the feedback pre-filled."
                                : "点击后将打开您的邮箱客户端，反馈内容会自动填入邮件"}
                        </p>
                    </form>
                </div>
            </main>

            {/* 页脚 */}
            <footer className="relative z-10 border-t border-white/5 py-8 bg-black/30">
                <div className="container max-w-7xl mx-auto px-6">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="text-gray-500 text-sm">
                            © {new Date().getFullYear()} Star Gaze by Wuhan Guanxing Cultural Media Co., Ltd. All Rights Reserved.
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
