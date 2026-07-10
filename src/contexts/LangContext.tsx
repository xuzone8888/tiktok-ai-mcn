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
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextValue>({
  lang: "zh",
  setLang: () => {},
});

// 按浏览器语言推断默认语言：中文环境 → zh，其余一律 → en
// 让美国审核员/海外用户首访即见英文，而中文用户仍默认中文
function detectBrowserLang(): Lang {
  if (typeof navigator === "undefined") return "zh";
  const candidates = [navigator.language, ...(navigator.languages || [])];
  const primary = candidates.find(Boolean)?.toLowerCase() ?? "";
  return primary.startsWith("zh") ? "zh" : "en";
}

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh");
  const [mounted, setMounted] = useState(false);

  // 客户端挂载后校正语言，防止 SSR 水合错误
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("toryx-lang") as Lang | null;
    if (saved === "en" || saved === "zh") {
      // 用户曾手动选择过，尊重其选择
      setLangState(saved);
    } else {
      // 首次访问、无历史选择：按浏览器语言自动检测（不写入 localStorage，
      // 以便用户后续手动切换才落盘为持久偏好）
      setLangState(detectBrowserLang());
    }
  }, []);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    if (mounted) {
      localStorage.setItem("toryx-lang", newLang);
    }
  };

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang(): LangContextValue {
  return useContext(LangContext);
}
