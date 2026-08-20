import type { ReactNode } from 'react'

export type MetaPublishPlatform = 'facebook' | 'instagram'
export type PlatformPrivacyStatus = 'private' | 'public'

export interface PlatformPrivacyOption {
  value: PlatformPrivacyStatus
  label: string
  desc: string
}

export interface PlatformCategoryOption {
  value: string
  label: string
}

export interface PlatformPublishConfig {
  platform: MetaPublishPlatform
  platformName: string
  pageTitle?: string
  pageTitleEn?: string
  pageDescription?: string
  pageDescriptionEn?: string
  accountsPageTitle?: string
  accountsPageTitleEn?: string
  accountsPageDescription?: string
  accountsPageDescriptionEn?: string
  accountManagementLabel?: string
  accountManagementLabelEn?: string
  routeBase: string
  accountManagePath?: string
  apiBase: string
  accountNoun: string
  accountNounPlural: string
  emptyAccountTitle: string
  emptyAccountTitleEn?: string
  emptyAccountDescription: string
  emptyAccountDescriptionEn?: string
  bindButtonText: string
  bindButtonTextEn?: string
  statsVideoLabel: string
  statsVideoLabelEn?: string
  preferChannelTitle?: boolean
  requiredCommentScopes?: string[]
  disconnectConfirmation?: string
  disconnectConfirmationEn?: string
  requireLegalConsent?: boolean
  legalConsentText?: string
  legalConsentTextEn?: string
  providerLanguageNotice?: string
  providerLanguageNoticeEn?: string
  providerLanguageSettingsUrl?: string
  providerLanguageSettingsLabel?: string
  providerLanguageSettingsLabelEn?: string
  localizeLegalDialogClose?: boolean
  deleteAllDataEndpoint?: string
  dataControlsTitle?: string
  dataControlsTitleEn?: string
  dataControlsDescription?: string
  dataControlsDescriptionEn?: string
  deleteAllDataLabel?: string
  deleteAllDataLabelEn?: string
  deleteAllDataConfirmation?: string
  deleteAllDataConfirmationEn?: string
  maxTitleLength: number
  maxDescriptionLength: number
  maxTagsLength: number
  maxCombinedTextLength?: number
  maxFileSizeBytes?: number
  maxFileSizeLabel?: string
  acceptedVideoExtensions?: string[]
  videoFormatsLabel?: string
  privacyLabel?: string
  privacyPlaceholder?: string
  privacyMissingMessage?: string
  minScheduleLeadMinutes?: number
  maxScheduleAheadDays?: number
  titleDescriptionHint?: string
  tagsHint?: string
  scheduleLabel?: string
  scheduleHint?: string
  showSyntheticContentSetting?: boolean
  categoryOptions?: PlatformCategoryOption[]
  privacyOptions: PlatformPrivacyOption[]
  accent: {
    softBg: string
    text: string
    border: string
    hoverBorder: string
  }
  icon?: ReactNode
}

export const FACEBOOK_CONTENT_CATEGORY_OPTIONS: PlatformCategoryOption[] = [
  { value: 'OTHER', label: '其他' },
  { value: 'BEAUTY_FASHION', label: '美妆时尚' },
  { value: 'BUSINESS', label: '商业' },
  { value: 'CARS_TRUCKS', label: '汽车卡车' },
  { value: 'COMEDY', label: '喜剧' },
  { value: 'CUTE_ANIMALS', label: '萌宠' },
  { value: 'ENTERTAINMENT', label: '娱乐' },
  { value: 'FAMILY', label: '家庭' },
  { value: 'FOOD_HEALTH', label: '美食健康' },
  { value: 'HOME', label: '家居' },
  { value: 'LIFESTYLE', label: '生活方式' },
  { value: 'MUSIC', label: '音乐' },
  { value: 'NEWS', label: '新闻' },
  { value: 'POLITICS', label: '政治' },
  { value: 'SCIENCE', label: '科学' },
  { value: 'SPORTS', label: '体育' },
  { value: 'TECHNOLOGY', label: '科技' },
  { value: 'VIDEO_GAMING', label: '游戏' },
]

export const META_PLATFORM_CONFIGS: Record<MetaPublishPlatform, Omit<PlatformPublishConfig, 'icon'>> = {
  facebook: {
    platform: 'facebook',
    platformName: 'Facebook',
    pageTitle: 'Facebook 视频管理',
    pageTitleEn: 'Facebook Video Management',
    pageDescription: '管理 Facebook 视频发布、预约发布、任务历史和评论。',
    pageDescriptionEn: 'Manage Facebook video publishing, scheduled publishing, task history, and comments.',
    accountsPageTitle: 'Facebook 账号管理',
    accountsPageTitleEn: 'Facebook Account Management',
    accountsPageDescription: '绑定和管理 Facebook Page、授权状态与账号数据。',
    accountsPageDescriptionEn: 'Connect and manage Facebook Pages, authorization status, and account data.',
    accountManagementLabel: '账号管理',
    accountManagementLabelEn: 'Account Management',
    routeBase: '/facebook-publish',
    apiBase: '/api/facebook',
    accountNoun: 'Page',
    accountNounPlural: 'Page',
    emptyAccountTitle: '还没有绑定 Facebook Page',
    emptyAccountTitleEn: 'No Facebook Page connected yet',
    emptyAccountDescription: '绑定 Facebook Page 后，可以直接发布视频内容',
    emptyAccountDescriptionEn: 'Connect a Facebook Page to publish video content directly.',
    bindButtonText: '绑定 Facebook Page',
    bindButtonTextEn: 'Connect Facebook Page',
    statsVideoLabel: '视频',
    statsVideoLabelEn: 'Videos',
    // Meta localizes Page categories (stored as channel_handle). Use the Page's
    // actual title as the account-card name so UI language does not leak into it.
    preferChannelTitle: true,
    requiredCommentScopes: [
      'pages_read_user_content',
      'pages_manage_engagement',
    ],
    requireLegalConsent: true,
    legalConsentText: '绑定 Facebook 前，我已阅读并同意当前隐私政策与服务条款，并授权 Star Gaze 按所述方式处理 Facebook Page 数据。',
    legalConsentTextEn: 'Before connecting Facebook, I have read and accept the current Privacy Policy and Terms, and authorize Star Gaze to process Facebook Page data as described.',
    providerLanguageNotice: 'Meta 授权页面由 Facebook 托管，并使用你的 Facebook 账号语言。为了保持中文，请先确认 Facebook 账号语言为“中文（简体）”。',
    providerLanguageNoticeEn: 'Meta hosts the authorization screens and uses the language selected in your Facebook account. To keep the full flow in English, set your Facebook account language to English (US) before continuing.',
    providerLanguageSettingsUrl: 'https://www.facebook.com/settings/?tab=language_and_region',
    providerLanguageSettingsLabel: '打开 Facebook 语言设置',
    providerLanguageSettingsLabelEn: 'Open Facebook language settings',
    localizeLegalDialogClose: true,
    disconnectConfirmation: '解绑将移除此 Page 的 webhook 订阅，并删除它在 Star Gaze 中的账号令牌、评论缓存和关联发布记录。其他已绑定 Page 不受影响；Facebook 上已发布的内容不会被删除。是否继续？',
    disconnectConfirmationEn: 'Disconnecting removes this Page’s webhook subscription and deletes its tokens, cached comments, and related publishing history from Star Gaze. Other connected Pages are not affected, and Facebook-hosted content is not deleted. Continue?',
    deleteAllDataEndpoint: '/api/facebook/data',
    dataControlsTitle: 'Facebook 数据控制',
    dataControlsTitleEn: 'Facebook data controls',
    dataControlsDescription: '删除全部本地 Facebook Page 绑定、令牌、发布记录、评论缓存和操作日志。不会删除 Facebook 上已发布的视频、帖子、评论或回复。',
    dataControlsDescriptionEn: 'Delete all locally stored Facebook Page bindings, tokens, publishing history, cached comments, and action logs. This does not delete videos, posts, comments, or replies hosted on Facebook.',
    deleteAllDataLabel: '删除全部 Facebook 数据',
    deleteAllDataLabelEn: 'Delete all Facebook data',
    deleteAllDataConfirmation: '这会永久删除你在 Star Gaze 中的全部 Facebook Page 绑定、令牌、发布记录、评论缓存和操作日志，并尝试撤销 Facebook 授权。Facebook 上已发布的内容不会被删除。此操作不可恢复，是否继续？',
    deleteAllDataConfirmationEn: 'This permanently deletes all your Facebook Page bindings, tokens, publishing history, cached comments, and action logs from Star Gaze and attempts to revoke Facebook authorization. Content hosted on Facebook will not be deleted. Continue?',
    maxTitleLength: 255,
    maxDescriptionLength: 63206,
    maxTagsLength: 500,
    maxFileSizeBytes: 500 * 1024 * 1024,
    maxFileSizeLabel: '500MB',
    privacyLabel: '发布状态',
    privacyPlaceholder: '请选择发布状态',
    privacyMissingMessage: '请选择 Facebook 发布状态',
    maxScheduleAheadDays: 183,
    tagsHint: '话题/标签将追加到 Facebook 视频描述中，不会作为独立 API 字段发送。',
    scheduleLabel: '本地预约队列',
    scheduleHint: '到达所选时间后由本地队列处理发布任务。',
    showSyntheticContentSetting: false,
    privacyOptions: [
      { value: 'public', label: '公开', desc: '创建并发布到 Facebook Page' },
    ],
    categoryOptions: FACEBOOK_CONTENT_CATEGORY_OPTIONS,
    accent: {
      softBg: 'bg-cyan-500/10',
      text: 'text-cyan-300',
      border: 'border-cyan-300/50',
      hoverBorder: 'hover:border-cyan-300/40',
    },
  },
  instagram: {
    platform: 'instagram',
    platformName: 'Instagram',
    pageTitle: 'Instagram 视频管理',
    pageTitleEn: 'Instagram Video Management',
    pageDescription: '管理 Instagram 视频发布、预约发布和任务历史。',
    pageDescriptionEn: 'Manage Instagram video publishing, scheduled publishing, and task history.',
    accountsPageTitle: 'Instagram 账号管理',
    accountsPageTitleEn: 'Instagram Account Management',
    accountsPageDescription: '绑定和管理 Instagram 账号、授权状态与账号数据。',
    accountsPageDescriptionEn: 'Connect and manage Instagram accounts, authorization status, and account data.',
    accountManagementLabel: '账号管理',
    accountManagementLabelEn: 'Account Management',
    routeBase: '/instagram-publish',
    apiBase: '/api/instagram',
    accountNoun: '账号',
    accountNounPlural: '账号',
    emptyAccountTitle: '还没有绑定 Instagram 账号',
    emptyAccountTitleEn: 'No Instagram account connected yet',
    emptyAccountDescription: '绑定账号后，可以直接从平台发布视频内容',
    emptyAccountDescriptionEn: 'Connect an account to publish video content directly.',
    bindButtonText: '绑定 Instagram 账号',
    bindButtonTextEn: 'Connect Instagram account',
    statsVideoLabel: '媒体',
    statsVideoLabelEn: 'Media',
    maxTitleLength: 255,
    maxDescriptionLength: 2200,
    maxTagsLength: 500,
    maxCombinedTextLength: 2200,
    maxFileSizeBytes: 1024 * 1024 * 1024,
    maxFileSizeLabel: '1GB',
    acceptedVideoExtensions: ['.mp4', '.mov'],
    videoFormatsLabel: '.mp4 .mov',
    titleDescriptionHint: '发布到 Instagram 时，标题与描述会合并为 caption。',
    tagsHint: '话题/标签将追加到 Instagram caption 中，不会作为独立 API 字段发送。',
    scheduleLabel: '本地预约队列',
    scheduleHint: 'Instagram 没有独立预约发布参数，到达所选时间后由本地队列处理。',
    showSyntheticContentSetting: false,
    privacyOptions: [
      { value: 'public', label: '公开', desc: '发布到 Instagram 账号' },
    ],
    accent: {
      softBg: 'bg-pink-500/10',
      text: 'text-pink-300',
      border: 'border-pink-300/50',
      hoverBorder: 'hover:border-pink-300/40',
    },
  },
}
