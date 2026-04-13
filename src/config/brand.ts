/**
 * Centralized brand configuration
 *
 * Single source of truth for brand-sensitive strings.
 * Use this instead of hardcoding brand names in components.
 *
 * Scope: App display name, legal document titles.
 * NOT a full-site i18n system — only brand/legal names.
 */

export const APP_BRAND = {
  /** Primary display name shown to users */
  appDisplayName: 'Star Gaze',

  /** Company legal name */
  companyName: 'Wuhan Guanxing Cultural Media Co., Ltd.',

  /** Privacy policy document name */
  privacyPolicyName: {
    en: 'Star Gaze Privacy Policy',
    zh: 'Star Gaze 隐私政策',
  },

  /** Terms of service document name */
  termsOfServiceName: {
    en: 'Star Gaze Terms of Service',
    zh: 'Star Gaze 服务条款',
  },

  /** Public website URL */
  appUrl: 'https://toryxai.com',

  /** Contact email */
  contactEmail: 'toryxai@outlook.com',
} as const

export type Lang = 'zh' | 'en'
