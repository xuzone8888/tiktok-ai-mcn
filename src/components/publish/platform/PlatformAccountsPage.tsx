'use client'

/* eslint-disable @next/next/no-img-element */

import {
  AlertCircle,
  ArrowLeft,
  ArrowUpDown,
  CheckCircle,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useLang } from '@/contexts/LangContext'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type SortOption = 'followers_desc' | 'followers_asc' | 'auth_time_desc' | 'auth_time_asc'
type FilterOption = 'all' | 'active' | 'expiring' | 'expired'

interface PlatformAccount {
  id: string
  channel_id: string
  channel_title: string
  channel_handle: string | null
  thumbnail_url: string | null
  subscriber_count: number
  video_count: number
  view_count: number
  status: string
  access_token_expires_at: string | null
  scopes: string[]
  created_at: string
  updated_at: string
}

export interface PlatformAccountsConfig {
  platformName: string
  accountsPageTitle?: string
  accountsPageTitleEn?: string
  accountsPageDescription?: string
  accountsPageDescriptionEn?: string
  routeBase: string
  apiBase: string
  emptyAccountTitle: string
  emptyAccountTitleEn?: string
  emptyAccountDescription: string
  emptyAccountDescriptionEn?: string
  bindButtonText: string
  bindButtonTextEn?: string
  statsVideoLabel: string
  statsVideoLabelEn?: string
  icon?: ReactNode
  automaticallyRefreshesAccessTokens?: boolean
  requiredCommentScopes?: string[]
  disconnectConfirmation?: string
  disconnectConfirmationEn?: string
  requireLegalConsent?: boolean
  legalConsentText?: string
  legalConsentTextEn?: string
  deleteAllDataEndpoint?: string
  dataControlsTitle?: string
  dataControlsTitleEn?: string
  dataControlsDescription?: string
  dataControlsDescriptionEn?: string
  deleteAllDataLabel?: string
  deleteAllDataLabelEn?: string
  deleteAllDataConfirmation?: string
  deleteAllDataConfirmationEn?: string
}

interface PlatformAccountsPageProps {
  config: PlatformAccountsConfig
}

type AuthNotice = {
  type: 'success' | 'error'
  title: string
  description: string
}

const SORT_OPTIONS: { value: SortOption; label: { zh: string; en: string } }[] = [
  { value: 'followers_desc', label: { zh: '粉丝最多', en: 'Most followers' } },
  { value: 'followers_asc', label: { zh: '粉丝最少', en: 'Fewest followers' } },
  { value: 'auth_time_desc', label: { zh: '最近绑定', en: 'Recently connected' } },
  { value: 'auth_time_asc', label: { zh: '最早绑定', en: 'Earliest connected' } },
]

const FILTER_OPTIONS: { value: FilterOption; label: { zh: string; en: string } }[] = [
  { value: 'all', label: { zh: '全部账号', en: 'All accounts' } },
  { value: 'active', label: { zh: '已授权', en: 'Authorized' } },
  { value: 'expiring', label: { zh: '即将过期', en: 'Expiring soon' } },
  { value: 'expired', label: { zh: '已过期', en: 'Expired' } },
]

function t(isEnglish: boolean, zh: string, en: string) {
  return isEnglish ? en : zh
}

function formatNumber(num: number, isEnglish: boolean) {
  if (num >= 10000) return isEnglish ? `${(num / 1000).toFixed(1)}K` : `${(num / 10000).toFixed(1)}万`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
}

function localizeError(message: unknown, isEnglish: boolean, englishFallback: string) {
  const normalized = typeof message === 'string' ? message.trim() : ''
  if (!normalized) return englishFallback
  return isEnglish && /[\u3400-\u9fff]/.test(normalized) ? englishFallback : normalized
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false
  return new Date(expiresAt).getTime() <= Date.now()
}

function isTokenExpiringSoon(expiresAt: string | null) {
  if (!expiresAt || isExpired(expiresAt)) return false
  const daysUntilExpiry = (new Date(expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  return daysUntilExpiry < 30
}

function isAccountAuthorized(account: PlatformAccount, automaticallyRefreshesAccessTokens = false) {
  return account.status === 'active' && (automaticallyRefreshesAccessTokens || !isExpired(account.access_token_expires_at))
}

function isAccountExpiringSoon(account: PlatformAccount, automaticallyRefreshesAccessTokens = false) {
  if (automaticallyRefreshesAccessTokens) return false
  return isAccountAuthorized(account) && isTokenExpiringSoon(account.access_token_expires_at)
}

function isAccountStableAuthorized(account: PlatformAccount, automaticallyRefreshesAccessTokens = false) {
  return isAccountAuthorized(account, automaticallyRefreshesAccessTokens)
    && !isAccountExpiringSoon(account, automaticallyRefreshesAccessTokens)
}

function requiresReauthorization(account: PlatformAccount, automaticallyRefreshesAccessTokens = false) {
  return !isAccountAuthorized(account, automaticallyRefreshesAccessTokens)
}

function getAccountName(account: PlatformAccount) {
  return account.channel_handle || account.channel_title || account.channel_id
}

function getInitial(account: PlatformAccount) {
  return (account.channel_title || account.channel_handle || 'A').charAt(0).toUpperCase()
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null)
  return typeof data?.error === 'string' ? data.error : fallback
}

function matchesFilter(account: PlatformAccount, filter: FilterOption, automaticallyRefreshesAccessTokens = false) {
  switch (filter) {
    case 'active':
      return isAccountStableAuthorized(account, automaticallyRefreshesAccessTokens)
    case 'expiring':
      return isAccountExpiringSoon(account, automaticallyRefreshesAccessTokens)
    case 'expired':
      return requiresReauthorization(account, automaticallyRefreshesAccessTokens)
    default:
      return true
  }
}

function sortAccounts(accounts: PlatformAccount[], sortBy: SortOption) {
  return [...accounts].sort((a, b) => {
    switch (sortBy) {
      case 'followers_asc':
        return a.subscriber_count - b.subscriber_count
      case 'auth_time_asc':
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      case 'auth_time_desc':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      default:
        return b.subscriber_count - a.subscriber_count
    }
  })
}

function AccountAvatar({ account }: { account: PlatformAccount }) {
  if (account.thumbnail_url) {
    return <img src={account.thumbnail_url} alt={account.channel_title} className="h-12 w-12 rounded-full object-cover" />
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-sm font-semibold text-white/75">
      {getInitial(account)}
    </div>
  )
}

function StatusBadge({ account, isEnglish, automaticallyRefreshesAccessTokens = false }: { account: PlatformAccount; isEnglish: boolean; automaticallyRefreshesAccessTokens?: boolean }) {
  if (requiresReauthorization(account, automaticallyRefreshesAccessTokens)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
        <AlertCircle className="h-3 w-3" />
        {t(isEnglish, '需重新授权', 'Reconnect required')}
      </span>
    )
  }

  if (isAccountExpiringSoon(account, automaticallyRefreshesAccessTokens)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
        <AlertCircle className="h-3 w-3" />
        {t(isEnglish, '即将过期', 'Expiring soon')}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
      <CheckCircle className="h-3 w-3" />
      {t(isEnglish, '已授权', 'Authorized')}
    </span>
  )
}

export function PlatformAccountsPage({ config }: PlatformAccountsPageProps) {
  const router = useRouter()
  const { lang, isReady: languageReady } = useLang()
  const isEnglish = lang === 'en'
  const pageTitle = isEnglish
    ? config.accountsPageTitleEn || `${config.platformName} Account Management`
    : config.accountsPageTitle || `${config.platformName} 账号绑定`
  const pageDescription = isEnglish
    ? config.accountsPageDescriptionEn || `Connect and manage your ${config.platformName} accounts for video publishing.`
    : config.accountsPageDescription || `绑定和管理您的 ${config.platformName} 账号，用于发布视频内容`
  const emptyAccountTitle = isEnglish ? config.emptyAccountTitleEn || `No ${config.platformName} account connected yet` : config.emptyAccountTitle
  const emptyAccountDescription = isEnglish ? config.emptyAccountDescriptionEn || `Connect a ${config.platformName} account to publish videos.` : config.emptyAccountDescription
  const bindButtonText = isEnglish ? config.bindButtonTextEn || `Connect ${config.platformName} account` : config.bindButtonText
  const statsVideoLabel = isEnglish ? config.statsVideoLabelEn || 'Videos' : config.statsVideoLabel
  const automaticallyRefreshesAccessTokens = config.automaticallyRefreshesAccessTokens || false
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [binding, setBinding] = useState(false)
  const [legalAccepted, setLegalAccepted] = useState(false)
  const [legalDialogOpen, setLegalDialogOpen] = useState(false)
  const [deletingAllData, setDeletingAllData] = useState(false)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('followers_desc')
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null)
  const bindingInFlightRef = useRef(false)
  const accountsMissingCommentScopes = useMemo(() => {
    const required = config.requiredCommentScopes || []
    if (required.length === 0) return []
    return accounts.filter((account) => {
      const granted = new Set(account.scopes || [])
      return required.some((scope) => !granted.has(scope))
    })
  }, [accounts, config.requiredCommentScopes])

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch(`${config.apiBase}/accounts`)
      const data = await response.json().catch(() => null)
      if (response.status === 401) {
        const redirect = encodeURIComponent(`${config.routeBase}/accounts`)
        router.push(`/auth/login?redirect=${redirect}`)
        return
      }
      if (!response.ok) throw new Error(localizeError(data?.error, isEnglish, t(isEnglish, '加载账号失败', 'Failed to load accounts')))
      setAccounts(data.accounts || [])
    } catch (error) {
      toast({
        title: t(isEnglish, '加载失败', 'Load failed'),
        description: error instanceof Error ? localizeError(error.message, isEnglish, `Unable to get ${config.platformName} accounts`) : t(isEnglish, `无法获取 ${config.platformName} 账号`, `Unable to get ${config.platformName} accounts`),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [config.apiBase, config.platformName, config.routeBase, isEnglish, router, toast])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  useEffect(() => {
    if (!languageReady) return

    const params = new URLSearchParams(window.location.search)
    const success = params.get('success')
    const error = params.get('error')
    const name = params.get('name')

    if (success) {
      setAuthNotice({
        type: 'success',
        title: t(isEnglish, `${config.platformName} 账号已绑定`, `${config.platformName} account connected`),
        description: name ? t(isEnglish, `已连接账号：${name}`, `Connected account: ${name}`) : t(isEnglish, '授权完成', 'Authorization completed'),
      })
      toast({
        title: t(isEnglish, `${config.platformName} 账号已绑定`, `${config.platformName} account connected`),
        description: name ? t(isEnglish, `已连接账号：${name}`, `Connected account: ${name}`) : t(isEnglish, '授权完成', 'Authorization completed'),
      })
      window.history.replaceState({}, '', `${config.routeBase}/accounts`)
    } else if (error) {
      setAuthNotice({
        type: 'error',
        title: t(isEnglish, `${config.platformName} 授权未完成`, `${config.platformName} authorization incomplete`),
        description: localizeError(error, isEnglish, `${config.platformName} authorization was not completed`),
      })
      toast({
        title: t(isEnglish, `${config.platformName} 授权失败`, `${config.platformName} authorization failed`),
        description: localizeError(error, isEnglish, `${config.platformName} authorization failed`),
        variant: 'destructive',
      })
      window.history.replaceState({}, '', `${config.routeBase}/accounts`)
    }
  }, [config.platformName, config.routeBase, isEnglish, languageReady, toast])

  const overview = useMemo(() => ({
    total: accounts.length,
    active: accounts.filter((account) => isAccountStableAuthorized(account, automaticallyRefreshesAccessTokens)).length,
    expiring: accounts.filter((account) => isAccountExpiringSoon(account, automaticallyRefreshesAccessTokens)).length,
    expired: accounts.filter((account) => requiresReauthorization(account, automaticallyRefreshesAccessTokens)).length,
  }), [accounts, automaticallyRefreshesAccessTokens])

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = accounts.filter((account) => {
      if (!matchesFilter(account, filterBy, automaticallyRefreshesAccessTokens)) return false
      if (!query) return true
      return [account.channel_title, account.channel_handle, account.channel_id]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    })
    return sortAccounts(filtered, sortBy)
  }, [accounts, automaticallyRefreshesAccessTokens, filterBy, search, sortBy])

  const beginBinding = async () => {
    if (bindingInFlightRef.current) return

    bindingInFlightRef.current = true
    setBinding(true)
    try {
      const response = await fetch(`${config.apiBase}/auth/url`, { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(localizeError(data?.error, isEnglish, `Unable to create ${config.platformName} authorization link`))
      window.location.href = data.authUrl
    } catch (error) {
      bindingInFlightRef.current = false
      toast({
        title: t(isEnglish, '无法绑定', 'Unable to connect'),
        description: error instanceof Error ? localizeError(error.message, isEnglish, 'Failed to initialize authorization') : t(isEnglish, '初始化授权失败', 'Failed to initialize authorization'),
        variant: 'destructive',
      })
      setBinding(false)
    }
  }

  const startBinding = () => {
    if (bindingInFlightRef.current) return
    if (config.requireLegalConsent) {
      setLegalAccepted(false)
      setLegalDialogOpen(true)
      return
    }
    void beginBinding()
  }

  const confirmLegalConsentAndBind = () => {
    if (!legalAccepted || bindingInFlightRef.current) return
    setLegalDialogOpen(false)
    void beginBinding()
  }

  const refreshAccount = async (accountId: string) => {
    setBusyAccountId(accountId)
    try {
      const response = await fetch(`${config.apiBase}/accounts/${accountId}/refresh`, { method: 'POST' })
      if (!response.ok) throw new Error(await readApiError(response, t(isEnglish, '刷新失败', 'Refresh failed')))
      toast({ title: t(isEnglish, '授权已刷新', 'Authorization refreshed') })
      fetchAccounts()
    } catch (error) {
      toast({
        title: t(isEnglish, '刷新失败', 'Refresh failed'),
        description: error instanceof Error ? localizeError(error.message, isEnglish, 'Please reconnect this account') : t(isEnglish, '请重新绑定该账号', 'Please reconnect this account'),
        variant: 'destructive',
      })
    } finally {
      setBusyAccountId(null)
    }
  }

  const removeAccount = async (accountId: string) => {
    const confirmation = t(
      isEnglish,
      config.disconnectConfirmation || `确定解绑这个 ${config.platformName} 账号吗？`,
      config.disconnectConfirmationEn || `Disconnect this ${config.platformName} account?`,
    )
    if (!window.confirm(confirmation)) return
    setBusyAccountId(accountId)
    try {
      const response = await fetch(`${config.apiBase}/accounts/${accountId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiError(response, t(isEnglish, '解绑失败', 'Disconnect failed')))
      toast({ title: t(isEnglish, '账号已解绑', 'Account disconnected') })
      fetchAccounts()
    } catch (error) {
      toast({
        title: t(isEnglish, '解绑失败', 'Disconnect failed'),
        description: error instanceof Error ? localizeError(error.message, isEnglish, 'Please try again later') : t(isEnglish, '请稍后重试', 'Please try again later'),
        variant: 'destructive',
      })
    } finally {
      setBusyAccountId(null)
    }
  }

  const deleteAllPlatformData = async () => {
    if (!config.deleteAllDataEndpoint) return
    const confirmation = t(
      isEnglish,
      config.deleteAllDataConfirmation || `确定删除所有本地 ${config.platformName} 数据吗？`,
      config.deleteAllDataConfirmationEn || `Delete all locally stored ${config.platformName} data?`,
    )
    if (!window.confirm(confirmation)) return

    setDeletingAllData(true)
    try {
      const response = await fetch(config.deleteAllDataEndpoint, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiError(response, t(isEnglish, '删除失败', 'Deletion failed')))
      toast({
        title: t(isEnglish, `${config.platformName} 数据已删除`, `${config.platformName} data deleted`),
        description: t(isEnglish, '本地数据已删除；平台托管的视频和评论不会被删除。', 'Local data was deleted; platform-hosted videos and comments were not deleted.'),
      })
      await fetchAccounts()
    } catch (error) {
      toast({
        title: t(isEnglish, '删除失败', 'Deletion failed'),
        description: error instanceof Error ? localizeError(error.message, isEnglish, 'Please try again later') : t(isEnglish, '请稍后重试', 'Please try again later'),
        variant: 'destructive',
      })
    } finally {
      setDeletingAllData(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push(config.routeBase)} className="text-white/70 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
                {config.icon}
                {pageTitle}
              </h1>
              <p className="mt-0.5 text-sm text-white/50">
                {pageDescription}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="titanium-outline" onClick={fetchAccounts} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              {t(isEnglish, '刷新列表', 'Refresh list')}
            </Button>
            <Button variant="mermaid" onClick={startBinding} disabled={binding}>
              {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {bindButtonText}
            </Button>
          </div>
        </header>

        {authNotice && (
          <section
            className={cn(
              'rounded-2xl border p-4',
              authNotice.type === 'success'
                ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100'
                : 'border-amber-400/25 bg-amber-400/10 text-amber-100'
            )}
          >
            <div className="flex items-start gap-3">
              {authNotice.type === 'success' ? (
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              )}
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{authNotice.title}</h2>
                <p className="mt-1 text-sm opacity-80">{authNotice.description}</p>
              </div>
            </div>
          </section>
        )}

        {config.requireLegalConsent && (
          <Dialog
            open={legalDialogOpen}
            onOpenChange={(open) => {
              if (binding) return
              setLegalDialogOpen(open)
              if (!open) setLegalAccepted(false)
            }}
          >
            <DialogContent className="border-white/10 bg-zinc-950 text-white sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {t(isEnglish, `连接 ${config.platformName} 前请确认`, `Before connecting ${config.platformName}`)}
                </DialogTitle>
                <DialogDescription className="text-white/60">
                  {t(
                    isEnglish,
                    `Star Gaze 将跳转至 ${config.platformName} 完成账号授权。继续前，请阅读并确认以下政策。`,
                    `Star Gaze will redirect you to ${config.platformName} to authorize your account. Review and confirm the policies below before continuing.`,
                  )}
                </DialogDescription>
              </DialogHeader>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/75">
                <input
                  type="checkbox"
                  checked={legalAccepted}
                  onChange={(event) => setLegalAccepted(event.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span>
                  {t(
                    isEnglish,
                    config.legalConsentText || '我已阅读并同意当前隐私政策和服务条款。',
                    config.legalConsentTextEn || 'I have read and accept the current Privacy Policy and Terms of Service.',
                  )}{' '}
                  <a href="/privacy" target="_blank" rel="noreferrer" className="text-cyan-300 underline">
                    {t(isEnglish, '隐私政策', 'Privacy Policy')}
                  </a>
                  {' · '}
                  <a href="/terms" target="_blank" rel="noreferrer" className="text-cyan-300 underline">
                    {t(isEnglish, '服务条款', 'Terms of Service')}
                  </a>
                </span>
              </label>

              <DialogFooter>
                <Button
                  type="button"
                  variant="titanium-outline"
                  disabled={binding}
                  onClick={() => setLegalDialogOpen(false)}
                >
                  {t(isEnglish, '取消', 'Cancel')}
                </Button>
                <Button
                  type="button"
                  variant="mermaid"
                  disabled={!legalAccepted || binding}
                  onClick={confirmLegalConsentAndBind}
                >
                  {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  {t(isEnglish, '同意并继续', 'Agree and continue')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {accountsMissingCommentScopes.length > 0 && (
          <section className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
            {t(isEnglish, `有 ${accountsMissingCommentScopes.length} 个账号缺少评论读取或回复权限，请重新绑定并完成最新授权。`, `${accountsMissingCommentScopes.length} account(s) are missing comment read or reply permissions. Reconnect them and complete the latest authorization.`)}
          </section>
        )}

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-white/80">{t(isEnglish, '账号库', 'Accounts')} {overview.total}</span>
              <span className="text-white/35">{t(isEnglish, '已授权', 'Authorized')} {overview.active}</span>
              <span className="text-white/35">{t(isEnglish, '即将过期', 'Expiring soon')} {overview.expiring}</span>
              <span className="text-white/35">{t(isEnglish, '已过期', 'Expired')} {overview.expired}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t(isEnglish, '搜索账号', 'Search accounts')}
                  className="h-10 w-56 border-white/10 bg-black/25 pl-9 text-white"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="titanium-outline">
                    <Filter className="h-4 w-4" />
                    {FILTER_OPTIONS.find((option) => option.value === filterBy)?.label[isEnglish ? 'en' : 'zh']}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {FILTER_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option.value} onClick={() => setFilterBy(option.value)}>
                      {option.label[isEnglish ? 'en' : 'zh']}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="titanium-outline">
                    <ArrowUpDown className="h-4 w-4" />
                    {SORT_OPTIONS.find((option) => option.value === sortBy)?.label[isEnglish ? 'en' : 'zh']}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {SORT_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option.value} onClick={() => setSortBy(option.value)}>
                      {option.label[isEnglish ? 'en' : 'zh']}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
            <Loader2 className="h-6 w-6 animate-spin text-white/50" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.03] text-center">
            <UserPlus className="mb-4 h-12 w-12 text-cyan-300/70" />
            <h2 className="text-lg font-medium">{emptyAccountTitle}</h2>
            <p className="mt-2 max-w-md text-sm text-white/45">{emptyAccountDescription}</p>
            <Button variant="mermaid" className="mt-6" onClick={startBinding} disabled={binding}>
              {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {bindButtonText}
            </Button>
          </div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredAccounts.map((account) => {
              const busy = busyAccountId === account.id
              const missingCommentScopes = (config.requiredCommentScopes || []).filter(
                (scope) => !(account.scopes || []).includes(scope)
              )
              return (
                <div key={account.id} className="group relative flex h-[168px] flex-col overflow-hidden rounded-lg border border-white/[0.075] bg-white/[0.035] p-5 transition-all duration-300 hover:border-cyan-300/25 hover:bg-white/[0.055]">
                  <div className="absolute right-3 top-3 flex items-center gap-1 opacity-35 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => refreshAccount(account.id)}
                      disabled={busy}
                      className="rounded-md p-1.5 text-white/45 hover:bg-white/[0.08] hover:text-white"
                      title={t(isEnglish, '刷新授权', 'Refresh authorization')}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAccount(account.id)}
                      disabled={busy}
                      className="rounded-md p-1.5 text-white/45 hover:bg-rose-500/10 hover:text-rose-300"
                      title={t(isEnglish, '解绑账号', 'Disconnect account')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-start gap-3 pr-14">
                    <AccountAvatar account={account} />
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-bold text-white">{getAccountName(account)}</h3>
                      <p className="mt-1 truncate text-sm text-white/45">{account.channel_id}</p>
                      <div className="mt-2">
                        <StatusBadge
                          account={account}
                          isEnglish={isEnglish}
                          automaticallyRefreshesAccessTokens={automaticallyRefreshesAccessTokens}
                        />
                        {missingCommentScopes.length > 0 && (
                          <span className="ml-2 inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
                            {t(isEnglish, '评论权限缺失', 'Comment permissions missing')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 text-xs text-white/45">
                    <span>{t(isEnglish, '粉丝', 'Followers')} {formatNumber(account.subscriber_count, isEnglish)}</span>
                    <span>{statsVideoLabel} {formatNumber(account.video_count, isEnglish)}</span>
                    <span>{t(isEnglish, '浏览', 'Views')} {formatNumber(account.view_count, isEnglish)}</span>
                  </div>
                </div>
              )
            })}
            {filteredAccounts.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-white/10 py-12 text-center text-white/45">
                {t(isEnglish, '没有匹配的账号', 'No matching accounts')}
              </div>
            )}
          </section>
        )}

        {config.deleteAllDataEndpoint && (
          <section className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  {t(
                    isEnglish,
                    config.dataControlsTitle || `${config.platformName} 数据控制`,
                    config.dataControlsTitleEn || `${config.platformName} data controls`,
                  )}
                </h2>
                <p className="mt-1 text-xs text-white/50">
                  {t(
                    isEnglish,
                    config.dataControlsDescription || '删除全部本地 YouTube 账号、令牌、发布记录、评论缓存和操作日志。不会删除 YouTube 上的视频或评论。',
                    config.dataControlsDescriptionEn || 'Delete all local YouTube accounts, tokens, publishing history, cached comments, and action logs. This does not delete videos or comments hosted on YouTube.',
                  )}
                </p>
              </div>
              <Button variant="destructive" onClick={deleteAllPlatformData} disabled={deletingAllData}>
                {deletingAllData ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t(
                  isEnglish,
                  config.deleteAllDataLabel || '删除全部 YouTube 数据',
                  config.deleteAllDataLabelEn || 'Delete all YouTube data',
                )}
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
