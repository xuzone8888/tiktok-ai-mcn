"use client";

import { NextIntlClientProvider } from "next-intl";

import { useLang } from "@/contexts/LangContext";
import { appMessages } from "@/i18n/messages";

export function AppIntlProvider({ children }: { children: React.ReactNode }) {
  const { lang } = useLang();

  return (
    <NextIntlClientProvider
      locale={lang === "zh" ? "zh-CN" : "en"}
      messages={appMessages[lang]}
      timeZone="Asia/Shanghai"
    >
      {children}
    </NextIntlClientProvider>
  );
}
