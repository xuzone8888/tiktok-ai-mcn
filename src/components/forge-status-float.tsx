"use client";

/**
 * 全局铸造状态浮窗
 * 
 * 当角色正在铸造中（VEO/Sora2）且用户不在角色创建页面时，
 * 在页面底部显示一个持久化浮动状态栏。
 * 点击可跳回角色创建页面查看进度。
 */

import { useCharacterStudioStore } from "@/stores/character-studio-store";
import { usePathname, useRouter } from "next/navigation";

export function ForgeStatusFloat() {
  const generationStatus = useCharacterStudioStore((s) => s.generationStatus);
  const forgeMode = useCharacterStudioStore((s) => s.forgeMode);
  const errorMessage = useCharacterStudioStore((s) => s.errorMessage);
  const sora2VideoUrl = useCharacterStudioStore((s) => s.sora2VideoUrl);
  const heroImageUrl = useCharacterStudioStore((s) => s.heroImageUrl);

  const pathname = usePathname();
  const router = useRouter();

  // 只在不在角色创建页面时、且正在生成/已完成未保存时显示
  const isOnCreatePage = pathname === "/character/create";
  const isActive = generationStatus === "polling" || generationStatus === "failed" || 
    (generationStatus === "completed" && (heroImageUrl || sora2VideoUrl));

  if (isOnCreatePage || !isActive) return null;

  const statusText = (() => {
    if (generationStatus === "polling") {
      return forgeMode === "sora2" ? "🎬 影视角色铸造中..." : "🖼️ 写真角色铸造中...";
    }
    if (generationStatus === "failed") {
      return `❌ 铸造失败: ${errorMessage || "未知错误"}`;
    }
    if (generationStatus === "completed") {
      return forgeMode === "sora2" ? "🎬 影视角色已就绪，待确认" : "🖼️ 写真角色已生成，待保存";
    }
    return "";
  })();

  return (
    <div
      onClick={() => router.push("/character/create")}
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 20px",
        borderRadius: 40,
        background: generationStatus === "failed"
          ? "linear-gradient(135deg, rgba(220,38,38,0.9), rgba(127,29,29,0.95))"
          : "linear-gradient(135deg, rgba(168,85,247,0.9), rgba(99,102,241,0.95))",
        border: "1px solid rgba(255,255,255,0.15)",
        backdropFilter: "blur(20px)",
        color: "#fff",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(168,85,247,0.2)",
        transition: "all 0.3s ease",
        animation: generationStatus === "polling" ? "forgeFloatPulse 2s ease-in-out infinite" : "none",
      }}
    >
      {generationStatus === "polling" && (
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "#fff", boxShadow: "0 0 8px #fff",
          animation: "dotBlink 1.5s ease-in-out infinite",
          display: "inline-block", flexShrink: 0,
        }} />
      )}
      <span>{statusText}</span>
      <span style={{ opacity: 0.7, fontSize: 12 }}>点击查看 →</span>

      <style>{`
        @keyframes forgeFloatPulse {
          0%, 100% { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(168,85,247,0.2); }
          50% { box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 30px rgba(168,85,247,0.4); }
        }
        @keyframes dotBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
