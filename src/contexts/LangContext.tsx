"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

// ============================================================================
// 语言 Context — 全局中英文切换
// 优先级：用户手动选择(localStorage) > 浏览器语言自动检测 > 默认中文
// SSR 首屏渲染中文，客户端挂载后再按上述优先级校正（沿用既有防水合错误模式）
// ============================================================================

type Lang = "zh" | "en";

interface LangContextValue {
  lang: Lang;
  isReady: boolean;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextValue>({
  lang: "zh",
  isReady: false,
  setLang: () => {},
});

// 按浏览器语言推断默认语言：中文环境 → zh，其余一律 → en
// 让美国审核员/海外用户首访即见英文，而中文用户仍默认中文
function detectBrowserLang(): Lang {
  if (typeof navigator === "undefined") return "zh";
  const candidates = [navigator.language, ...(navigator.languages || [])];
  const primary = candidates.find(Boolean)?.toLowerCase() ?? "";
  if (!primary) return "zh"; // 浏览器未暴露任何语言信息 → 回落到文档默认中文
  return primary.startsWith("zh") ? "zh" : "en";
}

// 保持 <html lang> 与实际渲染语言一致（root layout 静态为 en，此处按解析结果校正）
function syncHtmlLang(next: Lang) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh");
  const [mounted, setMounted] = useState(false);

  // 客户端挂载后校正语言，防止 SSR 水合错误
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("toryx-lang") as Lang | null;
    // 用户曾手动选择过则尊重其选择；否则按浏览器语言自动检测
    // （检测结果不写入 localStorage，以便仅在用户手动切换时才落盘为持久偏好）
    const resolved: Lang = saved === "en" || saved === "zh" ? saved : detectBrowserLang();
    setLangState(resolved);
    syncHtmlLang(resolved);
  }, []);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    syncHtmlLang(newLang);
    if (mounted) {
      localStorage.setItem("toryx-lang", newLang);
    }
  };

  return (
    <LangContext.Provider value={{ lang, isReady: mounted, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}
