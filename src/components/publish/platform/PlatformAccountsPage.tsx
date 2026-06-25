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
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import type { PlatformPublishConfig } from '@/lib/publish/platform-config'
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

interface PlatformAccountsPageProps {
  config: PlatformPublishConfig
}

type AuthNotice = {
  type: 'success' | 'error'
  title: string
  description: string
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'followers_desc', label: '粉丝最多' },
  { value: 'followers_asc', label: '粉丝最少' },
  { value: 'auth_time_desc', label: '最近绑定' },
  { value: 'auth_time_asc', label: '最早绑定' },
]

const FILTER_OPTIONS: { value: FilterOption; label: string }[] = [
  { value: 'all', label: '全部账号' },
  { value: 'active', label: '已授权' },
  { value: 'expiring', label: '即将过期' },
  { value: 'expired', label: '已过期' },
]

function formatNumber(num: number) {
  if (num >= 10000) return `${(num / 10000).toFixed(1)}万`
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
  return num.toString()
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

function isAccountAuthorized(account: PlatformAccount) {
  return account.status === 'active' && !isExpired(account.access_token_expires_at)
}

function isAccountExpiringSoon(account: PlatformAccount) {
  return isAccountAuthorized(account) && isTokenExpiringSoon(account.access_token_expires_at)
}

function isAccountStableAuthorized(account: PlatformAccount) {
  return isAccountAuthorized(account) && !isAccountExpiringSoon(account)
}

function requiresReauthorization(account: PlatformAccount) {
  return !isAccountAuthorized(account)
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

function matchesFilter(account: PlatformAccount, filter: FilterOption) {
  switch (filter) {
    case 'active':
      return isAccountStableAuthorized(account)
    case 'expiring':
      return isAccountExpiringSoon(account)
    case 'expired':
      return requiresReauthorization(account)
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

function StatusBadge({ account }: { account: PlatformAccount }) {
  if (requiresReauthorization(account)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
        <AlertCircle className="h-3 w-3" />
        需重新授权
      </span>
    )
  }

  if (isAccountExpiringSoon(account)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
        <AlertCircle className="h-3 w-3" />
        即将过期
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
      <CheckCircle className="h-3 w-3" />
      已授权
    </span>
  )
}

export function PlatformAccountsPage({ config }: PlatformAccountsPageProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<PlatformAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [binding, setBinding] = useState(false)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('followers_desc')
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [authNotice, setAuthNotice] = useState<AuthNotice | null>(null)

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
      if (!response.ok) throw new Error(data?.error || '加载账号失败')
      setAccounts(data.accounts || [])
    } catch (error) {
      toast({
        title: '加载失败',
        description: error instanceof Error ? error.message : `无法获取 ${config.platformName} 账号`,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [config.apiBase, config.platformName, config.routeBase, router, toast])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const success = params.get('success')
    const error = params.get('error')
    const name = params.get('name')

    if (success) {
      setAuthNotice({
        type: 'success',
        title: `${config.platformName} 账号已绑定`,
        description: name ? `已连接账号：${name}` : '授权完成',
      })
      toast({
        title: `${config.platformName} 账号已绑定`,
        description: name ? `已连接账号：${name}` : '授权完成',
      })
      window.history.replaceState({}, '', `${config.routeBase}/accounts`)
    } else if (error) {
      setAuthNotice({
        type: 'error',
        title: `${config.platformName} 授权未完成`,
        description: error,
      })
      toast({
        title: `${config.platformName} 授权失败`,
        description: error,
        variant: 'destructive',
      })
      window.history.replaceState({}, '', `${config.routeBase}/accounts`)
    }
  }, [config.platformName, config.routeBase, toast])

  const overview = useMemo(() => ({
    total: accounts.length,
    active: accounts.filter(isAccountStableAuthorized).length,
    expiring: accounts.filter(isAccountExpiringSoon).length,
    expired: accounts.filter(requiresReauthorization).length,
  }), [accounts])

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = accounts.filter((account) => {
      if (!matchesFilter(account, filterBy)) return false
      if (!query) return true
      return [account.channel_title, account.channel_handle, account.channel_id]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    })
    return sortAccounts(filtered, sortBy)
  }, [accounts, filterBy, search, sortBy])

  const startBinding = async () => {
    setBinding(true)
    try {
      const response = await fetch(`${config.apiBase}/auth/url`, { method: 'POST' })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || `无法生成 ${config.platformName} 授权链接`)
      window.location.href = data.authUrl
    } catch (error) {
      toast({
        title: '无法绑定',
        description: error instanceof Error ? error.message : '初始化授权失败',
        variant: 'destructive',
      })
      setBinding(false)
    }
  }

  const refreshAccount = async (accountId: string) => {
    setBusyAccountId(accountId)
    try {
      const response = await fetch(`${config.apiBase}/accounts/${accountId}/refresh`, { method: 'POST' })
      if (!response.ok) throw new Error(await readApiError(response, '刷新失败'))
      toast({ title: '授权已刷新' })
      fetchAccounts()
    } catch (error) {
      toast({
        title: '刷新失败',
        description: error instanceof Error ? error.message : '请重新绑定该账号',
        variant: 'destructive',
      })
    } finally {
      setBusyAccountId(null)
    }
  }

  const removeAccount = async (accountId: string) => {
    if (!window.confirm(`确定解绑这个 ${config.platformName} 账号吗？`)) return
    setBusyAccountId(accountId)
    try {
      const response = await fetch(`${config.apiBase}/accounts/${accountId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await readApiError(response, '解绑失败'))
      toast({ title: '账号已解绑' })
      fetchAccounts()
    } catch (error) {
      toast({
        title: '解绑失败',
        description: error instanceof Error ? error.message : '请稍后重试',
        variant: 'destructive',
      })
    } finally {
      setBusyAccountId(null)
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
                {config.platformName} 账号绑定
              </h1>
              <p className="mt-0.5 text-sm text-white/50">绑定和管理您的 {config.platformName} 账号，用于发布视频内容</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="titanium-outline" onClick={fetchAccounts} disabled={loading}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              刷新列表
            </Button>
            <Button variant="mermaid" onClick={startBinding} disabled={binding}>
              {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {config.bindButtonText}
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

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-white/80">账号库 {overview.total}</span>
              <span className="text-white/35">已授权 {overview.active}</span>
              <span className="text-white/35">即将过期 {overview.expiring}</span>
              <span className="text-white/35">已过期 {overview.expired}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索账号"
                  className="h-10 w-56 border-white/10 bg-black/25 pl-9 text-white"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="titanium-outline">
                    <Filter className="h-4 w-4" />
                    {FILTER_OPTIONS.find((option) => option.value === filterBy)?.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {FILTER_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option.value} onClick={() => setFilterBy(option.value)}>
                      {option.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="titanium-outline">
                    <ArrowUpDown className="h-4 w-4" />
                    {SORT_OPTIONS.find((option) => option.value === sortBy)?.label}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {SORT_OPTIONS.map((option) => (
                    <DropdownMenuItem key={option.value} onClick={() => setSortBy(option.value)}>
                      {option.label}
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
            <h2 className="text-lg font-medium">{config.emptyAccountTitle}</h2>
            <p className="mt-2 max-w-md text-sm text-white/45">{config.emptyAccountDescription}</p>
            <Button variant="mermaid" className="mt-6" onClick={startBinding} disabled={binding}>
              {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {config.bindButtonText}
            </Button>
          </div>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredAccounts.map((account) => {
              const busy = busyAccountId === account.id
              return (
                <div key={account.id} className="group relative flex h-[168px] flex-col overflow-hidden rounded-lg border border-white/[0.075] bg-white/[0.035] p-5 transition-all duration-300 hover:border-cyan-300/25 hover:bg-white/[0.055]">
                  <div className="absolute right-3 top-3 flex items-center gap-1 opacity-35 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => refreshAccount(account.id)}
                      disabled={busy}
                      className="rounded-md p-1.5 text-white/45 hover:bg-white/[0.08] hover:text-white"
                      title="刷新授权"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeAccount(account.id)}
                      disabled={busy}
                      className="rounded-md p-1.5 text-white/45 hover:bg-rose-500/10 hover:text-rose-300"
                      title="解绑账号"
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
                        <StatusBadge account={account} />
                      </div>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 text-xs text-white/45">
                    <span>粉丝 {formatNumber(account.subscriber_count)}</span>
                    <span>{config.statsVideoLabel} {formatNumber(account.video_count)}</span>
                    <span>浏览 {formatNumber(account.view_count)}</span>
                  </div>
                </div>
              )
            })}
            {filteredAccounts.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-white/10 py-12 text-center text-white/45">
                没有匹配的账号
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
