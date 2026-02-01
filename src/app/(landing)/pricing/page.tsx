import PricingSection from "@/components/landing/sections/PricingSection";
import FooterSection from "@/components/landing/sections/FooterSection";

export const metadata = {
    title: "价格 - ToryX AI MCN",
    description: "选择适合你的方案，从个人创作者到企业团队，总有一款适合你",
};

export default function PricingPage() {
    return (
        <div className="bg-black text-white min-h-screen overflow-hidden">
            {/* 背景装饰 */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
                <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-b from-white/[0.02] to-transparent" />
            </div>

            {/* 主要内容 */}
            <main className="relative z-10 pt-20">
                <PricingSection />
                <FooterSection />
            </main>
        </div>
    );
}
