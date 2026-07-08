"use client"

import {
  AlertCircle,
  CheckCheck,
  Clock3,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  Send,
  UserCircle,
  XCircle,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { WhatsAppContact, WhatsAppConversation, WhatsAppMessage } from "@/types/whatsapp-inbox"

const CUSTOMER_SERVICE_WINDOW_CLOSED_CODE = "WHATSAPP_CUSTOMER_SERVICE_WINDOW_CLOSED"

function normalizeContact(conversation: WhatsAppConversation): WhatsAppContact | null {
  const contact = (conversation as WhatsAppConversation & { contact?: WhatsAppContact | WhatsAppContact[] | null }).contact
  if (Array.isArray(contact)) return contact[0] || null
  return contact || null
}

function displayName(conversation: WhatsAppConversation) {
  const contact = normalizeContact(conversation)
  return contact?.display_name || contact?.phone || contact?.wa_id || "WhatsApp 联系人"
}

function displayPhone(conversation: WhatsAppConversation) {
  const contact = normalizeContact(conversation)
  return contact?.phone || contact?.wa_id || ""
}

function initialFor(name: string) {
  return Array.from(name.trim())[0]?.toUpperCase() || "W"
}

function formatTime(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function messageTime(message: WhatsAppMessage) {
  return formatTime(message.sent_at || message.received_at || message.created_at)
}

function statusLabel(status: WhatsAppMessage["status"]) {
  switch (status) {
    case "pending":
      return "待发送"
    case "sent":
      return "已发送"
    case "delivered":
      return "已送达"
    case "read":
      return "已读"
    case "failed":
      return "发送失败"
    default:
      return "已接收"
  }
}

function StatusIcon({ status }: { status: WhatsAppMessage["status"] }) {
  if (status === "pending") return <Clock3 className="h-3.5 w-3.5" />
  if (status === "failed") return <XCircle className="h-3.5 w-3.5" />
  if (status === "sent" || status === "delivered" || status === "read") return <CheckCheck className="h-3.5 w-3.5" />
  return null
}

async function readApiErrorPayload(response: Response, fallback: string) {
  const data = await response.json().catch(() => null)
  return {
    message: typeof data?.error === "string" ? data.error : fallback,
    code: typeof data?.code === "string" ? data.code : null,
  }
}

async function readApiError(response: Response, fallback: string) {
  return (await readApiErrorPayload(response, fallback)).message
}

export function WhatsAppInboxEnabledPage() {
  const { toast } = useToast()
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<WhatsAppMessage[]>([])
  const [search, setSearch] = useState("")
  const [replyText, setReplyText] = useState("")
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  )

  const filteredConversations = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return conversations
    return conversations.filter((conversation) => {
      const name = displayName(conversation).toLowerCase()
      const phone = displayPhone(conversation).toLowerCase()
      return name.includes(keyword) || phone.includes(keyword)
    })
  }, [conversations, search])

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true)
    try {
      const response = await fetch("/api/whatsapp/conversations", { cache: "no-store" })
      if (!response.ok) {
        throw new Error(await readApiError(response, "获取 WhatsApp 会话失败"))
      }
      const data = await response.json()
      const nextConversations = Array.isArray(data?.conversations) ? data.conversations : []
      setConversations(nextConversations)
      setSelectedConversationId((current) => {
        if (current && nextConversations.some((conversation: WhatsAppConversation) => conversation.id === current)) {
          return current
        }
        return nextConversations[0]?.id || null
      })
    } catch (error) {
      toast({
        title: "会话加载失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setLoadingConversations(false)
    }
  }, [toast])

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true)
    try {
      const response = await fetch(`/api/whatsapp/conversations/${conversationId}/messages`, { cache: "no-store" })
      if (!response.ok) {
        throw new Error(await readApiError(response, "获取 WhatsApp 消息失败"))
      }
      const data = await response.json()
      setMessages(Array.isArray(data?.messages) ? data.messages : [])
      setConversations((current) => current.map((conversation) => (
        conversation.id === conversationId ? { ...conversation, unread_count: 0 } : conversation
      )))
    } catch (error) {
      toast({
        title: "消息加载失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setLoadingMessages(false)
    }
  }, [toast])

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (selectedConversationId) {
      void loadMessages(selectedConversationId)
    } else {
      setMessages([])
    }
  }, [loadMessages, selectedConversationId])

  const handleSend = async () => {
    if (!selectedConversationId || !replyText.trim() || sending) return
    const text = replyText.trim()
    setSending(true)
    try {
      const response = await fetch("/api/whatsapp/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: selectedConversationId, text }),
      })
      if (!response.ok) {
        const apiError = await readApiErrorPayload(response, "发送 WhatsApp 消息失败")
        if (apiError.code === CUSTOMER_SERVICE_WINDOW_CLOSED_CODE) {
          toast({
            title: "已超出 24 小时客服窗口",
            description: apiError.message,
            variant: "destructive",
          })
          void loadMessages(selectedConversationId)
          return
        }
        throw new Error(apiError.message)
      }
      setReplyText("")
      await Promise.all([
        loadMessages(selectedConversationId),
        loadConversations(),
      ])
    } catch (error) {
      toast({
        title: "发送失败",
        description: error instanceof Error ? error.message : "Meta 返回错误，已记录失败原因",
        variant: "destructive",
      })
      if (selectedConversationId) {
        void loadMessages(selectedConversationId)
      }
    } finally {
      setSending(false)
    }
  }

  let conversationListContent = (
    <div className="space-y-1">
      {filteredConversations.map((conversation) => {
        const active = conversation.id === selectedConversationId
        const name = displayName(conversation)
        return (
          <button
            key={conversation.id}
            type="button"
            onClick={() => setSelectedConversationId(conversation.id)}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-3 py-3 text-left transition-colors",
              active ? "bg-emerald-400/12 text-white" : "text-white/70 hover:bg-white/[0.06] hover:text-white"
            )}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-sm font-semibold text-emerald-200">
              {initialFor(name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{name}</span>
                <span className="shrink-0 text-[11px] text-white/35">{formatTime(conversation.last_message_at)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-white/45">{conversation.last_message || displayPhone(conversation)}</span>
                {conversation.unread_count > 0 && (
                  <span className="shrink-0 rounded-full bg-emerald-400 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                    {conversation.unread_count}
                  </span>
                )}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )

  if (loadingConversations && conversations.length === 0) {
    conversationListContent = (
      <div className="flex h-full items-center justify-center text-sm text-white/45">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载中
      </div>
    )
  } else if (filteredConversations.length === 0) {
    conversationListContent = (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center text-sm text-white/45">
        <MessageCircle className="mb-3 h-8 w-8 text-white/20" />
        暂无会话
      </div>
    )
  }

  let messageListContent = (
    <div className="space-y-3">
      {messages.map((message) => {
        const outbound = message.direction === "outbound"
        return (
          <div key={message.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[78%] rounded-lg border px-3 py-2",
                outbound
                  ? "border-emerald-400/20 bg-emerald-400/15 text-white"
                  : "border-white/10 bg-black/20 text-white/85"
              )}
            >
              <div className="whitespace-pre-wrap break-words text-sm leading-6">
                {message.text || `[${message.message_type}] ${message.media_url || ""}`.trim()}
              </div>
              {message.error_message && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md border border-red-400/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-200">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="break-words">{message.error_message}</span>
                </div>
              )}
              <div
                className={cn(
                  "mt-1.5 flex items-center justify-end gap-1.5 text-[11px]",
                  message.status === "failed" ? "text-red-200" : "text-white/40"
                )}
              >
                {outbound && <StatusIcon status={message.status} />}
                <span>{outbound ? statusLabel(message.status) : messageTime(message)}</span>
                {outbound && <span>{messageTime(message)}</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  if (loadingMessages) {
    messageListContent = (
      <div className="flex h-full items-center justify-center text-sm text-white/45">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        加载消息
      </div>
    )
  } else if (messages.length === 0) {
    messageListContent = (
      <div className="flex h-full flex-col items-center justify-center text-sm text-white/45">
        <MessageCircle className="mb-3 h-8 w-8 text-white/20" />
        暂无消息
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#08090d] text-white">
      <div className="flex h-screen min-h-0 flex-col px-6 py-5">
        <header className="mb-4 flex shrink-0 items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
              <MessageCircle className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal">WhatsApp Inbox</h1>
              <p className="text-sm text-white/50">客户消息 / 询盘处理</p>
            </div>
          </div>
          <Button
            variant="outline"
            className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]"
            onClick={() => void loadConversations()}
            disabled={loadingConversations}
          >
            {loadingConversations ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            刷新
          </Button>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-white/[0.03]">
            <div className="border-b border-white/10 p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索姓名或号码"
                  className="border-white/10 bg-black/20 pl-9 text-white placeholder:text-white/35"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {conversationListContent}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-white/[0.03]">
            {selectedConversation ? (
              <>
                <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-200">
                      <UserCircle className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{displayName(selectedConversation)}</div>
                      <div className="truncate text-xs text-white/45">{displayPhone(selectedConversation)}</div>
                    </div>
                  </div>
                  <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/55">
                    {selectedConversation.status}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {messageListContent}
                </div>

                <div className="shrink-0 border-t border-white/10 p-4">
                  <div className="flex items-end gap-3">
                    <Textarea
                      value={replyText}
                      onChange={(event) => setReplyText(event.target.value)}
                      placeholder="输入人工回复"
                      className="max-h-40 min-h-[76px] resize-none border-white/10 bg-black/20 text-white placeholder:text-white/35"
                      maxLength={4096}
                    />
                    <Button
                      className="h-10 shrink-0 bg-emerald-400 text-black hover:bg-emerald-300"
                      onClick={() => void handleSend()}
                      disabled={sending || !replyText.trim()}
                    >
                      {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      发送
                    </Button>
                  </div>
                  <div className="mt-2 text-right text-xs text-white/35">{replyText.length}/4096</div>
                </div>
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-white/45">
                <MessageCircle className="mb-3 h-10 w-10 text-white/20" />
                <span className="text-sm">选择一个 WhatsApp 会话</span>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}

export function WhatsAppInboxDisabledPage() {
  return (
    <div className="min-h-screen bg-[#08090d] px-6 py-5 text-white">
      <div className="flex h-[calc(100vh-40px)] items-center justify-center">
        <div className="w-full max-w-md rounded-lg border border-white/10 bg-white/[0.03] p-6 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-amber-400/20 bg-amber-400/10 text-amber-300">
            <AlertCircle className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-semibold">WhatsApp Inbox 已暂停</h1>
          <p className="mt-2 text-sm text-white/50">WhatsApp Inbox is disabled.</p>
        </div>
      </div>
    </div>
  )
}
