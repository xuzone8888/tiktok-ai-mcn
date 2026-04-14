/**
 * TikTok Shop module — centralized i18n dictionary
 *
 * All user-facing text for the Shop publish module lives here.
 * Components access via: SHOP_TEXT.section.key[lang]
 *
 * Brand names are injected from @/config/brand rather than hardcoded.
 */

import { APP_BRAND, type Lang } from '@/config/brand'

// Re-export Lang for convenience
export type { Lang }

// ============================================================
// Main dictionary — grouped by component / feature area
// ============================================================

const SHOP_TEXT = {
  // ====== page.tsx — page-level text ======
  page: {
    title:           { en: 'TikTok Shop Publishing',  zh: 'TikTok Shop 带货发布' },
    subtitle:        { en: 'Publish shoppable videos with product links to TikTok Shop',
                       zh: '发布带商品链接的带货视频到 TikTok Shop' },
    taskHistory:     { en: 'Publish Task History',    zh: '发布任务历史' },
    tabCreate:       { en: 'Create',                  zh: '创建发布' },
    tabTasks:        { en: 'Tasks',                   zh: '任务管理' },
    resetBtn:        { en: 'Reset',                   zh: '重置' },
  },

  // ====== Step labels (used in step indicator) ======
  steps: {
    selectVideo:     { en: 'Select Video',      zh: '选择视频' },
    selectAccount:   { en: 'Select Account',    zh: '选择账号' },
    selectProduct:   { en: 'Select Product',    zh: '选择商品' },
    settings:        { en: 'Settings',          zh: '发布设置' },
    reviewPublish:   { en: 'Review & Publish',  zh: '确认发布' },
  },

  // ====== Step 1 — Video selection ======
  video: {
    sectionTitle:    { en: 'Select Your Video',    zh: '选择你的视频' },
    sectionDesc:     { en: 'Upload a video file or provide a URL to an existing video',
                       zh: '上传视频文件或输入已有视频的 URL' },
    uploadTab:       { en: 'Upload Video',         zh: '上传视频' },
    urlTab:          { en: 'Video URL',             zh: '视频链接' },
    dropzoneTitle:   { en: 'Click to upload or drag and drop', zh: '点击上传或拖拽文件' },
    dropzoneFormats: { en: 'MP4, WebM or MOV',     zh: 'MP4、WebM 或 MOV 格式' },
    maxSize:         { en: `Max ${500}MB`,          zh: `最大 ${500}MB` },
    uploading:       { en: 'Uploading...',          zh: '上传中...' },
    urlPlaceholder:  { en: 'Enter video file URL...', zh: '输入视频文件链接...' },
    fetchBtn:        { en: 'Fetch',                 zh: '获取' },
    fetching:        { en: 'Fetching...',           zh: '获取中...' },
    changeVideo:     { en: 'Change',                zh: '更换' },
    removeVideo:     { en: 'Remove',                zh: '移除' },
    videoReady:      { en: 'Video ready',           zh: '视频就绪' },
    urlEntered:      { en: 'URL entered',           zh: '已输入链接' },
  },

  // ====== Step 2 — Account selection ======
  account: {
    sectionTitle:    { en: 'Select TikTok Shop Account', zh: '选择 TikTok Shop 账号' },
    sectionDesc:     { en: 'Choose a Shop account to publish the video', zh: '选择一个 Shop 账号发布视频' },
    loadingAccounts: { en: 'Loading accounts...',   zh: '加载账号中...' },
    noAccounts:      { en: 'No connected accounts', zh: '暂无已连接账号' },
    noAccountsHint:  { en: 'Please connect a TikTok Shop account first',
                       zh: '请先连接 TikTok Shop 账号' },
    manageAccounts:  { en: 'Manage Accounts',       zh: '管理账号' },
    tokenExpired:    { en: 'Token Expired',          zh: '令牌过期' },
    active:          { en: 'Active',                 zh: '有效' },
    selectFirst:     { en: 'Please select a Shop account first', zh: '请先选择 Shop 账号' },
    goSelectAccount: { en: 'Go to Account Selection', zh: '去上方选择账号' },
  },

  // ====== Step 3 — Product selection (ShopProductSelector) ======
  product: {
    loading:         { en: 'Loading showcase products...', zh: '加载橱窗商品中...' },
    noProducts:      { en: 'No Products in Showcase', zh: '橱窗暂无商品' },
    noProductsDesc:  { en: 'Please add products to your TikTok Shop showcase first',
                       zh: '请先在 TikTok Shop 橱窗中添加商品' },
    searchPlaceholder: { en: 'Search products...',   zh: '搜索商品...' },
    productCount:    { en: 'product',                zh: '件商品' },
    productsCount:   { en: 'products',               zh: '件商品' },
    selected:        { en: '1 product selected (click to deselect)',
                       zh: '已选择 1 件商品（点击取消选择）' },
    loadMore:        { en: 'Load More',              zh: '加载更多' },
    loadingMore:     { en: 'Loading...',              zh: '加载中...' },
    noMatch:         { en: 'No products matching',   zh: '没有匹配的商品' },
    retry:           { en: 'Retry',                  zh: '重试' },
    comm:            { en: 'comm.',                   zh: '佣金' },
    shopLabel:       { en: 'Shop',                    zh: '店铺' },
    productIdLabel:  { en: 'Product ID',              zh: '商品 ID' },
  },

  // ====== Step 4 — Settings (ShopPublishSettings) ======
  settings: {
    sectionTitle:    { en: 'Publish Settings',       zh: '发布设置' },
    videoTitle:      { en: 'Video Title',            zh: '视频标题' },
    required:        { en: '*',                      zh: '*' },
    titlePlaceholder:{ en: 'Enter a catchy title for your shoppable video...',
                       zh: '输入吸引人的带货视频标题...' },
    titleHint:       { en: 'The title directly impacts video visibility. Include product keywords and engaging phrases.',
                       zh: '标题直接影响视频可见度。请包含商品关键词和吸引人的短语。' },
    titleLimit:      { en: 'TikTok allows up to {max} characters.',
                       zh: 'TikTok 允许最多 {max} 个字符。' },
    anchorText:      { en: 'Product Anchor Text',    zh: '商品锚点文案' },
    anchorPlaceholder:{ en: 'e.g. Limited Offer — Shop Now', zh: '如：限时优惠 — 立即购买' },
    anchorHint:      { en: 'The anchor text appears on the product link overlay in your video, guiding viewers to click and purchase. Leave empty to use the video title.',
                       zh: '锚点文案显示在视频商品链接浮层上，引导观众点击购买。留空则使用视频标题。' },
    precheckLabel:   { en: 'Pre-Publish Compliance Check', zh: '发布前合规检查' },
    precheckDesc:    { en: 'Automatically verify your video meets TikTok Shop guidelines before publishing',
                       zh: '发布前自动检查视频是否符合 TikTok Shop 规范' },
  },

  // ====== Step 5 — Review & Confirm ======
  review: {
    sectionTitle:    { en: 'Review & Confirm',       zh: '确认并发布' },
    reviewDesc:      { en: 'Please review the details below before submitting',
                       zh: '请在提交前确认以下信息' },
    videoLabel:      { en: 'Video',                  zh: '视频' },
    productLabel:    { en: 'Product',                zh: '商品' },
    accountLabel:    { en: 'Account',                zh: '账号' },
    titleLabel:      { en: 'Title',                  zh: '标题' },
    anchorLabel:     { en: 'Anchor text',            zh: '锚点文案' },
    captionLabel:    { en: 'Caption',                zh: '文案' },
    confirmationLabel:{ en: 'Confirmation',          zh: '确认项' },
    previewTitle:    { en: 'Publish Preview',        zh: '发布预览' },
    previewNotice:   { en: 'Preview is for confirmation only. Actual delivery on TikTok may vary.',
                       zh: '预览仅用于确认发布内容，实际 TikTok 展示可能略有差异' },
    singleProductHint:{ en: 'Only 1 product can be attached per video', zh: '每条视频仅挂载 1 个商品' },
    completeFirst:   { en: 'Please complete first',  zh: '请先完成' },
    precheckOn:      { en: 'Precheck ON',            zh: '预检已开启' },
    platformNotice:  { en: 'Platform Notice',        zh: '平台声明' },
    guidelinesItems: {
      en: ['TikTok Community Guidelines', 'TikTok Shop Commerce Policies', 'Applicable advertising and consumer protection laws'],
      zh: ['TikTok 社区准则', 'TikTok Shop 电商政策', '适用的广告和消费者保护法规'],
    },
  },

  // ====== Navigation buttons ======
  nav: {
    previous:        { en: 'Previous',     zh: '上一步' },
    next:            { en: 'Next',         zh: '下一步' },
    continue:        { en: 'Continue',     zh: '继续' },
    submitting:      { en: 'Submitting...', zh: '提交中...' },
    createTask:      { en: 'Create Publish Task', zh: '创建发布任务' },
  },

  // ====== Toast messages ======
  toast: {
    loadFailed:      { en: 'Loading Failed',       zh: '加载失败' },
    loadFailedDesc:  { en: 'Unable to load Shop account list', zh: '无法加载 Shop 账号列表' },
    unsupportedFmt:  { en: 'Unsupported Format',   zh: '不支持的格式' },
    unsupportedDesc: { en: 'Please select an MP4, WebM, or MOV video file.', zh: '请选择 MP4、WebM 或 MOV 格式的视频文件。' },
    fileTooLarge:    { en: 'File Too Large',       zh: '文件过大' },
    uploadOk:        { en: 'Upload Successful',    zh: '上传成功' },
    uploadOkDesc:    { en: 'Video uploaded and ready for publishing', zh: '视频已上传，可以发布' },
    uploadFailed:    { en: 'Upload Failed',        zh: '上传失败' },
    tryAgain:        { en: 'Please try again',     zh: '请重试' },
    incomplete:      { en: 'Incomplete Information', zh: '信息不完整' },
    incompleteDesc:  { en: 'Please complete all steps before submitting', zh: '请完成所有步骤后再提交' },
    waitUpload:      { en: 'Please wait for the video upload to finish', zh: '请等待视频上传完成' },
    confirmRequired: { en: 'Confirmation Required', zh: '需要确认' },
    confirmDesc:     { en: 'Please review and confirm the platform notice before submitting', zh: '请先审阅并确认平台声明' },
    taskCreated:     { en: 'Task Created',         zh: '任务已创建' },
    taskCreatedDesc: { en: 'Your video publish task has been created and is now processing. Check progress below.',
                       zh: '视频发布任务已创建，正在处理中。请在下方查看进度。' },
    createFailed:    { en: 'Creation Failed',      zh: '创建失败' },
    taskFailed:      { en: 'Task creation failed',  zh: '任务创建失败' },
  },

  // ====== ShopTaskManager ======
  taskMgr: {
    // Status labels
    statusPending:   { en: 'Pending',       zh: '等待中' },
    statusProcessing:{ en: 'Processing',    zh: '处理中' },
    statusCompleted: { en: 'Completed',     zh: '已完成' },
    statusPartial:   { en: 'Partial Failure', zh: '部分失败' },
    statusFailed:    { en: 'Failed',        zh: '失败' },
    statusCancelled: { en: 'Cancelled',     zh: '已取消' },
    // Item status labels
    itemPending:     { en: 'Pending',       zh: '等待中' },
    itemUploading:   { en: 'Uploading',     zh: '上传中' },
    itemPrechecking: { en: 'Pre-checking',  zh: '预检中' },
    itemPublishing:  { en: 'Publishing',    zh: '发布中' },
    itemPublished:   { en: 'Published',     zh: '已发布' },
    itemFailed:      { en: 'Failed',        zh: '失败' },
    // Precheck status labels
    precheckSkipped: { en: 'Skipped',       zh: '已跳过' },
    precheckPending: { en: 'Pending',       zh: '待检查' },
    precheckPassed:  { en: 'Passed',        zh: '通过' },
    precheckWarning: { en: 'Warning',       zh: '警告' },
    precheckRejected:{ en: 'Rejected',      zh: '未通过' },
    // UI text
    noTasks:         { en: 'No publish tasks yet', zh: '暂无发布任务' },
    noTasksDesc:     { en: 'Created tasks will appear here', zh: '创建的任务会显示在这里' },
    items:           { en: 'items',          zh: '个子项' },
    confirmDeleteTitle: { en: 'Are you sure?',  zh: '确认删除？' },
    confirmDeleteDesc:  { en: 'This action cannot be undone. This will permanently delete the task and all its items.',
                          zh: '此操作不可撤销，将永久删除任务及其所有子项。' },
    cancel:          { en: 'Cancel',         zh: '取消' },
    deleteBtn:       { en: 'Delete',         zh: '删除' },
    deleting:        { en: 'Deleting...',    zh: '删除中...' },
    taskDeleted:     { en: 'Task Deleted',   zh: '任务已删除' },
    taskDeletedDesc: { en: 'The publish task has been removed', zh: '发布任务已移除' },
    deleteFailed:    { en: 'Delete Failed',  zh: '删除失败' },
    // Fetch error toasts (distinct from status labels)
    listLoadFailed:  { en: 'Loading Failed',             zh: '加载失败' },
    listLoadFailedDesc:{ en: 'Unable to load task list', zh: '无法加载任务列表' },
    detailLoadFailed:{ en: 'Detail Loading Failed',      zh: '详情加载失败' },
    detailLoadFailedDesc:{ en: 'Unable to load task details', zh: '无法加载任务详情' },
  },

  // ====== Validation errors (page.tsx validateSettings) ======
  validation: {
    titleRequired:   { en: 'Video title is required',   zh: '请输入视频标题' },
    titleMaxLen:     { en: 'Title cannot exceed 150 characters', zh: '标题不能超过 150 个字符' },
    anchorMaxLen:    { en: 'Anchor text cannot exceed 30 characters', zh: '锚点文案不能超过 30 个字符' },
  },

  // ====== accounts/page.tsx ======
  accounts: {
    title:           { en: 'TikTok Shop Accounts', zh: 'TikTok Shop 账号管理' },
    subtitle:        { en: 'Manage your connected TikTok Shop accounts for shoppable video publishing',
                       zh: '管理已连接的 TikTok Shop 账号，用于带货视频发布' },
    connectBtn:      { en: 'Connect TikTok Shop Account', zh: '连接 TikTok Shop 账号' },
    connecting:      { en: 'Connecting...',  zh: '连接中...' },
    noAccounts:      { en: 'No Connected Accounts', zh: '暂无已连接账号' },
    noAccountsDesc:  { en: 'Connect your first TikTok Shop account to start publishing shoppable videos.',
                       zh: '连接你的第一个 TikTok Shop 账号，开始发布带货视频。' },
    sortNewest:      { en: 'Authorized (Newest)', zh: '授权时间（最新）' },
    sortOldest:      { en: 'Authorized (Oldest)', zh: '授权时间（最早）' },
    sortName:        { en: 'Name (A-Z)',     zh: '名称（A-Z）' },
    // Toast
    connected:       { en: 'Shop Account Connected', zh: 'Shop 账号已连接' },
    connectedDesc:   { en: 'Successfully connected TikTok Shop account', zh: '已成功连接 TikTok Shop 账号' },
    connectFailed:   { en: 'Connection Failed', zh: '连接失败' },
    connectFailedDesc:{ en: 'Unable to connect. Please try again later.', zh: '无法连接，请稍后重试。' },
    loadFailed:      { en: 'Loading Failed',   zh: '加载失败' },
    loadFailedDesc:  { en: 'Unable to load account list. Please try again.', zh: '无法加载账号列表，请重试。' },
    authExpired:     { en: 'Authorization Expired', zh: '授权已过期' },
    authExpiredDesc: { en: 'Refresh token has expired. Please reconnect the account.', zh: '刷新令牌已过期，请重新连接账号。' },
    removed:         { en: 'Account Removed', zh: '账号已移除' },
    removeFailed:    { en: 'Removal Failed', zh: '移除失败' },
    removeFailedDesc:{ en: 'Unable to remove account. Please try again later.',
                       zh: '无法移除账号，请稍后重试。' },
    copied:          { en: 'Copied',         zh: '已复制' },
    copiedDesc:      { en: 'Username copied to clipboard', zh: '用户名已复制到剪贴板' },
    refreshOk:       { en: 'Token Refreshed', zh: '令牌已刷新' },
    refreshOkDesc:   { en: 'Access token has been refreshed successfully', zh: '访问令牌已刷新成功' },
    refreshFailed:   { en: 'Refresh Failed', zh: '刷新失败' },
    refreshFailedDesc:{ en: 'Unable to refresh token. Please try reconnecting.',
                        zh: '无法刷新令牌，请尝试重新连接。' },
    // Card labels
    followers:       { en: 'Followers',      zh: '粉丝' },
    following:       { en: 'Following',      zh: '关注' },
    videos:          { en: 'Videos',         zh: '视频' },
    likes:           { en: 'Likes',          zh: '点赞' },
    accessToken:     { en: 'Access Token',   zh: '访问令牌' },
    refreshToken:    { en: 'Refresh Token',  zh: '刷新令牌' },
    expires:         { en: 'Expires',        zh: '过期时间' },
    expired:         { en: 'Expired',        zh: '已过期' },
    expiresIn:       { en: 'expires in',     zh: '将在' },
    expiresInSuffix: { en: '',               zh: '后过期' },
    scopes:          { en: 'Scopes',         zh: '权限范围' },
    refreshBtn:      { en: 'Refresh Token',  zh: '刷新令牌' },
    refreshing:      { en: 'Refreshing...',  zh: '刷新中...' },
    removeBtn:       { en: 'Remove',         zh: '移除' },
    creatorAffiliate:{ en: 'Creator Affiliate', zh: '达人带货' },
    loadingAccounts: { en: 'Loading accounts...', zh: '加载账号中...' },
    // Sort & Summary
    sortLabel:       { en: 'Sort:',          zh: '排序：' },
    accountsSummary: { en: 'Shop account(s) connected', zh: '个 Shop 账号已连接' },
    creator:         { en: 'Creator',        zh: '创作者' },
    authorized:      { en: 'Authorized',     zh: '已授权' },
    reauthRequired:  { en: 'Re-auth Required', zh: '需重新授权' },
    usernameLabel:   { en: 'Username:',      zh: '用户名：' },
    copyUsername:    { en: 'Copy username',   zh: '复制用户名' },
    connectedAt:     { en: 'Connected:',     zh: '连接时间：' },
    expiredReauth:   { en: 'Expired — Re-auth required', zh: '已过期 — 需重新授权' },
    // Remove dialog
    removeDialogTitle:{ en: 'Remove Shop Account?', zh: '移除 Shop 账号？' },
    removeDialogCancel:{ en: 'Cancel',       zh: '取消' },
    removeDialogConfirm:{ en: 'Confirm Removal', zh: '确认移除' },
    // Info card
    infoCardTitle:   { en: 'About TikTok Shop Authorization', zh: '关于 TikTok Shop 授权' },
  },

  // ====== Error message mapping (frontend localization of API errors) ======
  errors: {
    'Failed to load products':       { en: 'Failed to load products',       zh: '加载商品失败' },
    'Failed to create task':         { en: 'Failed to create task',         zh: '创建任务失败' },
    'Failed to remove account':      { en: 'Failed to remove account',      zh: '移除账号失败' },
    'Failed to refresh token':       { en: 'Failed to refresh token',       zh: '刷新令牌失败' },
    'Failed to delete task':         { en: 'Failed to delete task',         zh: '删除任务失败' },
    'Failed to load tasks':          { en: 'Failed to load tasks',          zh: '加载任务失败' },
    'Network error':                 { en: 'Network error',                 zh: '网络错误' },
    'Upload failed':                 { en: 'Upload failed',                 zh: '上传失败' },
  },
} as const

// ============================================================
// Helper: localize API error messages
// ============================================================

/**
 * Map an API error message to the current language.
 * Falls back to the original message if no mapping exists.
 */
export function localizeError(message: string, lang: Lang): string {
  const mapping = SHOP_TEXT.errors as Record<string, { en: string; zh: string } | undefined>
  const entry = mapping[message]
  if (entry) return entry[lang]
  // No exact match — return as-is
  return message
}

// ============================================================
// Helper: get platform notice text with brand name injected
// ============================================================

export function getPlatformNoticeText(lang: Lang) {
  const brand = APP_BRAND.appDisplayName
  return {
    text1: lang === 'en'
      ? `${brand} is an AI-powered content management platform that helps creators streamline their publishing workflow.`
      : `${brand} 是一个AI驱动的内容管理平台，帮助创作者简化发布流程。`,
    text2: lang === 'en'
      ? 'By publishing, you acknowledge that you have reviewed this video and its associated content for accuracy and compliance. You are solely responsible for ensuring all published material meets:'
      : '提交发布即表示您已审阅视频及关联内容的准确性和合规性。您需确保所有发布内容符合：',
    confirmText: lang === 'en'
      ? "I have reviewed the content and confirm it complies with TikTok's guidelines and policies."
      : '我已审阅内容，确认其符合 TikTok 的指南和政策。',
    disclaimer: lang === 'en'
      ? `${brand} solely assists in creating publish tasks and does not represent official TikTok.`
      : `${brand} 仅协助创建发布任务，不代表 TikTok 官方。`
  }
}

// ============================================================
// Helper: get brand-aware account removal description
// ============================================================

export function getAccountRemovedDesc(lang: Lang): string {
  const brand = APP_BRAND.appDisplayName
  return lang === 'en'
    ? `TikTok Shop account has been removed from ${brand}`
    : `TikTok Shop 账号已从 ${brand} 移除`
}

// ============================================================
// Helper: get brand-aware remove dialog description
// ============================================================

export function getRemoveDialogDesc(lang: Lang) {
  const brand = APP_BRAND.appDisplayName
  return {
    main: lang === 'en'
      ? `This will remove the account connection from ${brand}. Pending publish tasks for this account will fail.`
      : `此操作将从 ${brand} 移除该账号连接。该账号待处理的发布任务将失败。`,
    note: lang === 'en'
      ? `Note: This only removes the connection from ${brand}. It does not revoke your TikTok Shop authorization. To fully revoke access, go to your TikTok Shop settings and manage authorized applications.`
      : `注意：此操作仅从 ${brand} 移除连接，不会撤销 TikTok Shop 授权。如需完全撤销，请在 TikTok Shop 设置中管理已授权的应用。`,
  }
}

// ============================================================
// Helper: get info card description about Shop authorization
// ============================================================

export function getInfoCardDesc(lang: Lang): string {
  return lang === 'en'
    ? 'Shop Access Tokens are valid for approximately 7 days and can be renewed using the "Refresh Token" button. The Refresh Token validity depends on the authorization duration set in your TikTok Shop settings. When the Refresh Token expires, you will need to reconnect the account.'
    : 'Shop 访问令牌有效期约为 7 天，可通过"刷新令牌"按钮续期。刷新令牌有效期取决于 TikTok Shop 设置中的授权时长。当刷新令牌过期时，需要重新连接账号。'
}

export default SHOP_TEXT
