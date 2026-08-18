"use client"

import { Instagram, Loader2, Plug, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"

type InstagramAccount = {
  id: string
  channel_title: string
  channel_handle: string | null
  status: string
}

function maskAccountLabel(account: InstagramAccount) {
  const source = (account.channel_handle || account.channel_title || "Instagram 账号").replace(/^@/, "")
  if (source.length <= 2) return "Instagram 账号"
  if (source.length <= 5) return `${source.slice(0, 1)}***`
  return `${source.slice(0, 2)}***${source.slice(-2)}`
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => null)
  return typeof data?.error === "string" ? data.error : fallback
}

export default function InstagramBindingTestClient() {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [binding, setBinding] = useState(false)
  const [busyAccountId, setBusyAccountId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const bindingInFlight = useRef(false)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const response = await fetch("/api/instagram/accounts", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      })
      if (response.status === 401) {
        window.location.assign("/auth/login?redirect=%2Finstagram-publish%2Fbinding-test")
        return
      }
      if (!response.ok) throw new Error(await readApiError(response, "加载账号失败"))
      const data = await response.json()
      setAccounts(Array.isArray(data.accounts) ? data.accounts : [])
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "加载账号失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const startBinding = async () => {
    if (bindingInFlight.current) return
    bindingInFlight.current = true
    setBinding(true)
    setErrorMessage(null)
    try {
      const response = await fetch("/api/instagram/auth/url", {
        method: "POST",
        credentials: "same-origin",
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || typeof data?.authUrl !== "string") {
        throw new Error(typeof data?.error === "string" ? data.error : "无法生成 Instagram 授权链接")
      }
      window.location.assign(data.authUrl)
    } catch (error) {
      bindingInFlight.current = false
      setBinding(false)
      setErrorMessage(error instanceof Error ? error.message : "初始化 Instagram 授权失败")
    }
  }

  const disconnectAccount = async (accountId: string) => {
    if (busyAccountId) return
    setBusyAccountId(accountId)
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/instagram/accounts/${encodeURIComponent(accountId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      if (!response.ok) throw new Error(await readApiError(response, "解绑失败"))
      setAccounts((current) => current.filter((account) => account.id !== accountId))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "解绑失败")
    } finally {
      setBusyAccountId(null)
    }
  }

  return (
    <div className="min-h-full bg-[#09090b] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-pink-300/25 bg-pink-500/10">
              <Instagram className="h-6 w-6 text-pink-300" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-semibold">Instagram 账号绑定测试</h1>
          </div>
          <Button onClick={startBinding} disabled={binding} className="gap-2">
            {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            绑定账号
          </Button>
        </header>

        {errorMessage && (
          <div className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200" role="alert">
            {errorMessage}
          </div>
        )}

        {loading && (
          <div className="flex min-h-48 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03]">
            <Loader2 className="h-6 w-6 animate-spin text-white/50" aria-label="正在加载" />
          </div>
        )}

        {!loading && accounts.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/15 py-14 text-center text-sm text-white/50">
            当前没有已绑定的 Instagram 账号
          </div>
        )}

        {!loading && accounts.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {accounts.map((account) => {
              const busy = busyAccountId === account.id
              return (
                <article key={account.id} className="flex min-h-32 flex-col justify-between rounded-lg border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">@{maskAccountLabel(account)}</span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-1 text-xs text-white/60">
                      {account.status === "active" ? "已连接" : "需重新授权"}
                    </span>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="mt-5 w-full gap-2"
                    disabled={Boolean(busyAccountId)}
                    onClick={() => void disconnectAccount(account.id)}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    解绑账号
                  </Button>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
