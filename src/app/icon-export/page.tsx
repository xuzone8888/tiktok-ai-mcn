import { Zap } from "lucide-react";

export default function IconExportPage() {
    return (
        <div className="min-h-screen bg-black flex items-center justify-center p-20">
            {/* 
        Original: w-10 (40px), rounded-[14px]
        Scale: 12.8x (512px)
        Radius: 14 * 12.8 = 179.2 -> 180px
      */}
            <div className="relative flex h-[512px] w-[512px] items-center justify-center rounded-[180px] bg-gradient-to-br from-[#d9ff00] via-[#00f2ea] to-[#ff0080] shadow-[0_100px_250px_rgba(0,242,234,0.3),inset_0_20px_50px_rgba(255,255,255,0.9),inset_0_-40px_120px_rgba(0,0,0,0.1)] ring-[12px] ring-white/30">

                {/* Internal Glass Cavity */}
                <div className="absolute inset-[25px] rounded-[155px] bg-white/10 blur-[6px] mix-blend-overlay" />

                {/* Top Specular Highlight */}
                <div className="absolute inset-x-0 top-0 h-[45%] bg-gradient-to-b from-white/90 to-transparent rounded-t-[165px] opacity-90" />

                {/* Bottom Refraction */}
                <div className="absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-t from-white/40 to-transparent rounded-b-[180px] mix-blend-overlay" />

                {/* Icon - Scaled Zap */}
                <Zap className="h-[256px] w-[256px] text-white drop-shadow-[0_25px_35px_rgba(0,0,0,0.2)] relative z-10" fill="white" strokeWidth={0} />
            </div>
        </div>
    );
}
