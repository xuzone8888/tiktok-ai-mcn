"use client"

import {
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  Youtube,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { YouTubeAccount } from "@/types/youtube-publish"

type ViewMode = "accounts" | "groups"

function formatNumber(value: number) {
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}亿`
  if (value >= 10000) return `${(value / 10000).toFixed(1)}万`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`
  return String(value)
}

function isTokenExpired(expiresAt: string | null) {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() <= Date.now()
}

function getStatusText(account: YouTubeAccount) {
  if (account.status !== "active") return "需重新授权"
  if (isTokenExpired(account.access_token_expires_at)) return "可刷新"
  return "已授权"
}

function isAccountReady(account: YouTubeAccount) {
  return account.status === "active"
}

export default function YouTubeAccountsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<YouTubeAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [binding, setBinding] = useState(false)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("accounts")

  const overview = useMemo(() => {
    const readyAccounts = accounts.filter(isAccountReady)
    return {
      total: accounts.length,
      ready: readyAccounts.length,
      refreshable: accounts.filter((account) => account.status === "active" && isTokenExpired(account.access_token_expires_at)).length,
      groups: readyAccounts.length > 0 ? 1 : 0,
    }
  }, [accounts])

  const accountGroups = useMemo(() => {
    const readyAccounts = accounts.filter(isAccountReady)
    if (readyAccounts.length === 0) return []
    return [
      {
        id: "all-ready",
        name: "全部可发布账号",
        accounts: readyAccounts,
      },
    ]
  }, [accounts])

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/youtube/accounts")
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "加载 YouTube 账号失败")
      setAccounts(data.accounts || [])
    } catch (error) {
      toast({
        title: "加载失败",
        description: error instanceof Error ? error.message : "无法获取 YouTube 账号",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const success = params.get("success")
    const error = params.get("error")
    const name = params.get("name")

    if (success) {
      toast({
        title: "账号绑定成功",
        description: name ? `已连接账号：${name}` : "授权完成",
      })
      window.history.replaceState({}, "", "/youtube-publish/accounts")
    } else if (error) {
      toast({
        title: "账号绑定失败",
        description: error,
        variant: "destructive",
      })
      window.history.replaceState({}, "", "/youtube-publish/accounts")
    }
  }, [toast])

  const startBinding = async () => {
    setBinding(true)
    try {
      const response = await fetch("/api/youtube/auth/url", { method: "POST" })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || "无法生成 YouTube 授权链接")
      window.location.href = data.authUrl
    } catch (error) {
      toast({
        title: "无法绑定",
        description: error instanceof Error ? error.message : "初始化授权失败",
        variant: "destructive",
      })
      setBinding(false)
    }
  }

  const refreshAccount = async (accountId: string) => {
    setBusyAccountId(accountId)
    try {
      const response = await fetch(`/api/youtube/accounts/${accountId}/refresh`, { method: "POST" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "刷新失败")
      toast({ title: "账号授权已刷新" })
      fetchAccounts()
    } catch (error) {
      toast({
        title: "刷新失败",
        description: error instanceof Error ? error.message : "请重新绑定该账号",
        variant: "destructive",
      })
    } finally {
      setBusyAccountId(null)
    }
  }

  const removeAccount = async (accountId: string) => {
    if (!window.confirm("确认解绑账号？解绑后将无法向该账号创建发布任务。")) return
    setBusyAccountId(accountId)
    try {
      const response = await fetch(`/api/youtube/accounts/${accountId}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "移除失败")
      toast({ title: "账号已解绑" })
      setAccounts((prev) => prev.filter((account) => account.id !== accountId))
    } catch (error) {
      toast({
        title: "解绑失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setBusyAccountId(null)
    }
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push("/youtube-publish")} className="text-white/70 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
                  <Youtube className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-normal">YouTube 账号绑定</h1>
                  <p className="mt-1 text-sm text-white/45">绑定和管理您的 YouTube 账号，用于发布视频内容</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="titanium-outline" onClick={fetchAccounts} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新账号
            </Button>
            <Button variant="mermaid" onClick={startBinding} disabled={binding}>
              {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              绑定 YouTube 账号
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          {[
            ["账号库", overview.total],
            ["可发布账号", overview.ready],
            ["可刷新账号", overview.refreshable],
            ["账号组", overview.groups],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <div className="text-xs text-white/45">{label}</div>
              <div className="mt-2 text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </div>

        {!loading && accounts.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-y border-white/[0.06] py-4">
            <div className="text-sm text-white/50">统一使用账号绑定、账号组、发布任务、任务历史命名。</div>
            <div className="flex rounded-lg border border-white/10 bg-black/30 p-1">
              {[
                { value: "accounts" as ViewMode, label: "账号视图", icon: UserPlus },
                { value: "groups" as ViewMode, label: "账号组视图", icon: Layers3 },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setViewMode(value)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    viewMode === value ? "bg-white/[0.12] text-white" : "text-white/45 hover:text-white/75"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
            <Loader2 className="h-6 w-6 animate-spin text-white/50" />
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] text-center">
            <Youtube className="mb-4 h-12 w-12 text-red-400/70" />
            <h2 className="text-lg font-medium">暂无 YouTube 账号</h2>
            <p className="mt-2 max-w-md text-sm text-white/45">绑定账号后即可创建 YouTube 视频发布任务。</p>
            <Button variant="mermaid" className="mt-6" onClick={startBinding} disabled={binding}>
              {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              绑定第一个账号
            </Button>
          </div>
        ) : viewMode === "groups" ? (
          accountGroups.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.03] text-center">
              <Layers3 className="mb-3 h-10 w-10 text-white/35" />
              <div className="text-white/70">暂无可用于发布的账号组</div>
              <div className="mt-2 max-w-md text-sm text-white/45">完成账号授权后，默认账号组会出现在这里。</div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {accountGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => router.push("/youtube-publish")}
                  className="rounded-lg border border-white/10 bg-white/[0.04] p-5 text-left transition-colors hover:border-cyan-400/40 hover:bg-white/[0.06]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold">{group.name}</h3>
                      <div className="mt-1 text-sm text-white/45">{group.accounts.length} 个账号</div>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">可发布</span>
                  </div>
                  <div className="mt-5 grid grid-cols-8 gap-2">
                    {group.accounts.slice(0, 8).map((account) => (
                      <div key={account.id} className="flex aspect-square items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/5">
                        {account.thumbnail_url ? (
                          <img src={account.thumbnail_url} alt={account.channel_title} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-bold text-white/75">{account.channel_title.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {accounts.map((account) => {
              const expired = isTokenExpired(account.access_token_expires_at)
              const busy = busyAccountId === account.id
              return (
                <div key={account.id} className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
                  <div className="flex items-start gap-4">
                    {account.thumbnail_url ? (
                      <img src={account.thumbnail_url} alt={account.channel_title} className="h-14 w-14 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-lg font-semibold text-red-300">
                        {account.channel_title.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-lg font-semibold">{account.channel_title}</h3>
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                          expired || account.status !== "active"
                            ? "bg-amber-500/10 text-amber-300"
                            : "bg-emerald-500/10 text-emerald-300"
                        )}>
                          <CheckCircle className="h-3 w-3" />
                          {getStatusText(account)}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-white/45">
                        {account.channel_handle || account.channel_id}
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <div className="text-white/40">订阅</div>
                          <div className="mt-1 font-medium">{formatNumber(account.subscriber_count)}</div>
                        </div>
                        <div>
                          <div className="text-white/40">视频</div>
                          <div className="mt-1 font-medium">{formatNumber(account.video_count)}</div>
                        </div>
                        <div>
                          <div className="text-white/40">观看</div>
                          <div className="mt-1 font-medium">{formatNumber(account.view_count)}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button variant="titanium-outline" size="sm" onClick={() => refreshAccount(account.id)} disabled={busy}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      刷新授权
                    </Button>
                    <Button variant="titanium-outline" size="sm" onClick={() => window.open(`https://www.youtube.com/channel/${account.channel_id}`, "_blank")}>
                      <ExternalLink className="h-4 w-4" />
                      打开账号
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => removeAccount(account.id)} disabled={busy}>
                      <Trash2 className="h-4 w-4" />
                      解绑账号
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
