"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

// ============================================================================
// 语言 Context — 全局中英文切换
// 使用 localStorage 持久化，默认中文
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

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh");
  const [mounted, setMounted] = useState(false);

  // 客户端挂载后从 localStorage 读取，防止 SSR 水合错误
  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("toryx-lang") as Lang | null;
    if (saved === "en" || saved === "zh") {
      setLangState(saved);
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
