import PricingSection from "@/components/landing/sections/PricingSection";
import FooterSection from "@/components/landing/sections/FooterSection";
import PricingTopNav from "@/components/landing/sections/PricingTopNav";

export const metadata = {
    title: "Pricing - Star Gaze",
    description: "Choose the plan that fits you — from solo creators to enterprise teams.",
};

export default function PricingPage() {
    return (
        <div className="bg-black text-white min-h-screen overflow-hidden">
            {/* 背景装饰 */}
            <div className="fixed inset-0 pointer-events-none">
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px]" />
                <div className="absolute top-0 left-0 right-0 h-[500px] bg-gradient-to-b from-white/[0.02] to-transparent" />
            </div>

            {/* 导航栏（客户端组件，随语言切换） */}
            <PricingTopNav />

            {/* 主要内容 */}
            <main className="relative z-10 pt-8">
                <PricingSection />
                <FooterSection />
            </main>
        </div>
    );
}
