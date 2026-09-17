'use client'
import { useCallback } from 'react'
import { useLang } from '@/contexts/LangContext'
import { translateTikTokUi } from '@/lib/publish/tiktok-ui-translations'

export function useTikTokLanguage() {
  const { lang } = useLang()
  const tr = useCallback((text: string | number, ...values: unknown[]) => translateTikTokUi(lang, String(text), ...values), [lang])
  return { lang, tr, isEnglish: lang === 'en', locale: lang === 'en' ? 'en-US' : 'zh-CN' }
}
