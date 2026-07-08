"use client"

import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Loader2,
  MessageCircle,
  PlugZap,
  RefreshCw,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface WhatsAppBusinessAccount {
  id: string
  masked_phone_number_id: string | null
  masked_business_account_id: string | null
  masked_business_portfolio_id: string | null
  has_phone_number_id: boolean
  has_business_account_id: boolean
  has_business_portfolio_id: boolean
  business_account_name: string | null
  business_portfolio_name: string | null
  display_phone_number: string | null
  verified_name: string | null
  source_platform: string
  status: "active" | "disabled"
  database_status?: "active" | "disabled"
  binding_source: "embedded_signup" | "facebook_login_for_business" | "local_env"
  onboarding_mode?: "embedded_signup" | "coexistence" | "manual" | "local_env"
  webhook_status?: "unknown" | "mapped" | "verified" | "disabled" | "error"
  webhook_last_verified_at: string | null
  messaging_status?: "unknown" | "ready" | "blocked" | "disabled"
  channel_label: string | null
  is_available?: boolean
  can_receive_messages?: boolean
  can_send_messages?: boolean
  token_status?: "valid" | "missing" | "expired" | "not_required"
  scopes: string[]
  connected_at: string | null
  created_at: string
  updated_at: string
}

type AuthNotice = {
  type: "success" | "error"
  title: string
  description: string
}

type WhatsAppEmbeddedSignupLaunchConfig = {
  appId: string
  apiVersion: string
  configId: string
  scopes: string[]
  extras: string | null
  state: string
  redirectUri: string
}

type WhatsAppAuthStartResponse = {
  launchMode?: "js_sdk_embedded_signup"
  launchConfig?: WhatsAppEmbeddedSignupLaunchConfig
  error?: string
  code?: string
}

type EmbeddedSignupProgress = {
  businessStep: boolean
  wabaStep: boolean
  phoneNumberStep: boolean
  phoneVerificationStep: boolean
  completed: boolean
  cancelled: boolean
}

type EmbeddedSignupStateMachine = {
  fbLoginCallbackSeen: boolean
  fbLoginHasCode: boolean
  embeddedSignupFinishSeen: boolean
  embeddedSignupCancelSeen: boolean
  embeddedSignupErrorSeen: boolean
  embeddedSignupHasWabaHint: boolean
  embeddedSignupHasPhoneHint: boolean
  redirectedToCallback: boolean
}

type EmbeddedSignupHints = {
  businessAccountId?: string | null
  phoneNumberId?: string | null
  businessPortfolioId?: string | null
  displayPhoneNumber?: string | null
  verifiedName?: string | null
}

type BindingPath = "new_service_number" | "existing_business_number" | "prepared_business_number"

type FacebookLoginStatus = "connected" | "not_authorized" | "unknown"

type FacebookLoginResponse = {
  status?: FacebookLoginStatus
  authResponse?: {
    code?: string
  } | null
}

type FacebookLoginOptions = {
  config_id: string
  response_type: "code"
  override_default_response_type: true
  extras?: unknown
}

type FacebookSdk = {
  init: (options: { appId: string; xfbml: boolean; version: string }) => void
  login: (callback: (response: FacebookLoginResponse) => void, options: FacebookLoginOptions) => void
}

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

const FACEBOOK_SDK_SCRIPT_ID = "facebook-jssdk"
const DEFAULT_EMBEDDED_SIGNUP_EXTRAS = { sessionInfoVersion: "3" }
const EMBEDDED_SIGNUP_CLIENT_DIAGNOSTICS_KEY = "whatsapp_embedded_signup_client_diagnostics"
const EMBEDDED_SIGNUP_CODE_TIMEOUT_MS = 5 * 60 * 1000
const EMBEDDED_SIGNUP_FOCUS_GRACE_MS = 10 * 1000
const EMBEDDED_SIGNUP_MIN_FOCUS_ELAPSED_MS = 3 * 1000
const EMBEDDED_SIGNUP_FINISH_GRACE_MS = 1500
let facebookSdkLoadPromise: Promise<void> | null = null

const EMPTY_EMBEDDED_SIGNUP_PROGRESS: EmbeddedSignupProgress = {
  businessStep: false,
  wabaStep: false,
  phoneNumberStep: false,
  phoneVerificationStep: false,
  completed: false,
  cancelled: false,
}

const EMPTY_EMBEDDED_SIGNUP_STATE_MACHINE: EmbeddedSignupStateMachine = {
  fbLoginCallbackSeen: false,
  fbLoginHasCode: false,
  embeddedSignupFinishSeen: false,
  embeddedSignupCancelSeen: false,
  embeddedSignupErrorSeen: false,
  embeddedSignupHasWabaHint: false,
  embeddedSignupHasPhoneHint: false,
  redirectedToCallback: false,
}

const WHATSAPP_AUTH_ERROR_MESSAGES: Record<string, string> = {
  WHATSAPP_REQUIRED_SCOPES_MISSING: "Meta 授权缺少 WhatsApp Business 必需权限，请重新进入绑定流程并确认授权。",
  WHATSAPP_EMBEDDED_SIGNUP_INCOMPLETE: "未完成 WhatsApp 号码绑定/验证，请重新进入 Embedded Signup 并完成全部步骤。",
  WHATSAPP_NO_PHONE_DISCOVERED: "该号码暂时无法直接接入 WhatsApp API，建议使用新的公司客服号码，或联系客服协助处理。",
  WHATSAPP_PHONE_ALREADY_BOUND: "这个 WhatsApp 号码已经绑定到另一个账号，请更换号码或联系管理员解绑。",
  WHATSAPP_META_AUTH_CANCELLED: "Meta 授权已取消，请重新进入绑定流程。",
  WHATSAPP_AUTH_STATE_INVALID: "WhatsApp Business 授权状态无效，请重新开始绑定。",
  WHATSAPP_AUTH_STATE_EXPIRED: "WhatsApp Business 授权已过期，请重新开始绑定。",
}

function getWhatsAppAuthErrorDescription(code: string | null, fallback: string | null) {
  if (code && WHATSAPP_AUTH_ERROR_MESSAGES[code]) return WHATSAPP_AUTH_ERROR_MESSAGES[code]
  return fallback || "WhatsApp Business 授权未完成"
}

function getStringFragments(value: unknown, depth = 0): string[] {
  if (depth > 2 || value == null) return []
  if (typeof value === "string") return [value]
  if (typeof value === "number" || typeof value === "boolean") return [String(value)]
  if (Array.isArray(value)) return value.flatMap((item) => getStringFragments(item, depth + 1))
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) => getStringFragments(item, depth + 1))
  }
  return []
}

function isAllowedMetaMessageOrigin(originValue: string) {
  if (!originValue) return false
  try {
    const origin = new URL(originValue)
    return origin.hostname === "www.facebook.com"
      || origin.hostname === "web.facebook.com"
      || origin.hostname === "facebook.com"
      || origin.hostname.endsWith(".facebook.com")
      || origin.hostname === "facebook.net"
      || origin.hostname.endsWith(".facebook.net")
  } catch {
    return false
  }
}

function parseEmbeddedSignupMessageData(data: unknown): unknown {
  if (typeof data !== "string") return data
  try {
    return JSON.parse(data) as unknown
  } catch {
    return data
  }
}

function getStringByKeys(value: unknown, keys: string[], depth = 0): string | null {
  if (depth > 4 || value == null) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = getStringByKeys(item, keys, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof value !== "object") return null

  const record = value as Record<string, unknown>
  for (const [key, child] of Object.entries(record)) {
    const normalizedKey = key.toLowerCase()
    if (keys.includes(normalizedKey) && typeof child === "string" && child.trim()) {
      return child.trim()
    }
  }

  for (const child of Object.values(record)) {
    const found = getStringByKeys(child, keys, depth + 1)
    if (found) return found
  }

  return null
}

function parseEmbeddedSignupEvent(data: unknown): {
  progress: Partial<EmbeddedSignupProgress>
  state: Partial<EmbeddedSignupStateMachine>
  hints: EmbeddedSignupHints
} | null {
  const parsed = parseEmbeddedSignupMessageData(data)
  const fragments = getStringFragments(parsed)
  const joined = fragments.join(" ").toLowerCase()
  const isEmbeddedSignupEvent = joined.includes("wa_embedded_signup")
    || joined.includes("embedded_signup")
    || joined.includes("whatsapp")

  if (!isEmbeddedSignupEvent) return null

  const businessAccountId = getStringByKeys(parsed, [
    "waba_id",
    "whatsapp_business_account_id",
    "business_account_id",
    "businessaccountid",
    "wabaid",
  ])
  const phoneNumberId = getStringByKeys(parsed, [
    "phone_number_id",
    "whatsapp_phone_number_id",
    "phonenumberid",
    "phoneid",
  ])
  const businessPortfolioId = getStringByKeys(parsed, [
    "business_id",
    "business_portfolio_id",
    "customer_business_id",
    "businessportfolioid",
  ])
  const displayPhoneNumber = getStringByKeys(parsed, ["display_phone_number", "displayphonenumber"])
  const verifiedName = getStringByKeys(parsed, ["verified_name", "verifiedname"])
  const finishSeen = joined.includes("finish") || joined.includes("complete") || joined.includes("success")
  const cancelSeen = joined.includes("cancel")
  const errorSeen = joined.includes("error") || joined.includes("fail")

  const progress: Partial<EmbeddedSignupProgress> = {}
  if (joined.includes("business") || joined.includes("portfolio")) progress.businessStep = true
  if (joined.includes("waba") || joined.includes("whatsapp_business_account")) progress.wabaStep = true
  if (joined.includes("phone_number") || joined.includes("phone number") || joined.includes("phone")) progress.phoneNumberStep = true
  if (joined.includes("verification") || joined.includes("verify") || joined.includes("otp")) progress.phoneVerificationStep = true
  if (finishSeen) progress.completed = true
  if (cancelSeen) progress.cancelled = true

  const state: Partial<EmbeddedSignupStateMachine> = {
    embeddedSignupFinishSeen: finishSeen || undefined,
    embeddedSignupCancelSeen: cancelSeen || undefined,
    embeddedSignupErrorSeen: errorSeen || undefined,
    embeddedSignupHasWabaHint: Boolean(businessAccountId) || undefined,
    embeddedSignupHasPhoneHint: Boolean(phoneNumberId) || undefined,
  }

  return {
    progress,
    state,
    hints: {
      businessAccountId,
      phoneNumberId,
      businessPortfolioId,
      displayPhoneNumber,
      verifiedName,
    },
  }
}

function recordEmbeddedSignupClientDiagnostics(values: Record<string, unknown>) {
  try {
    window.sessionStorage.setItem(
      EMBEDDED_SIGNUP_CLIENT_DIAGNOSTICS_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        ...values,
      })
    )
  } catch {
    // Best-effort local diagnostics only; never block the binding flow.
  }
}

function sanitizedStateMachine(values: EmbeddedSignupStateMachine) {
  return {
    fb_login_callback_seen: values.fbLoginCallbackSeen,
    fb_login_has_code: values.fbLoginHasCode,
    embedded_signup_finish_seen: values.embeddedSignupFinishSeen,
    embedded_signup_cancel_seen: values.embeddedSignupCancelSeen,
    embedded_signup_error_seen: values.embeddedSignupErrorSeen,
    embedded_signup_has_waba_hint: values.embeddedSignupHasWabaHint,
    embedded_signup_has_phone_hint: values.embeddedSignupHasPhoneHint,
    redirected_to_callback: values.redirectedToCallback,
  }
}

async function completeEmbeddedSignupAuthorization(
  code: string,
  state: string,
  hints: EmbeddedSignupHints
) {
  const response = await fetch("/api/whatsapp/auth/callback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      state,
      businessAccountId: hints.businessAccountId || undefined,
      phoneNumberId: hints.phoneNumberId || undefined,
      businessPortfolioId: hints.businessPortfolioId || undefined,
      displayPhoneNumber: hints.displayPhoneNumber || undefined,
      verifiedName: hints.verifiedName || undefined,
    }),
  })
  const data = await response.json().catch(() => null) as {
    success?: boolean
    redirectUrl?: string
    code?: string
    error?: string
  } | null

  if (!response.ok || !data?.success) {
    throw new Error(getWhatsAppAuthErrorDescription(data?.code || null, data?.error || null))
  }

  return data.redirectUrl || "/whatsapp-business?success=true"
}

function parseEmbeddedSignupExtras(extras: string | null) {
  if (!extras) return DEFAULT_EMBEDDED_SIGNUP_EXTRAS

  try {
    const parsed = JSON.parse(extras) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...DEFAULT_EMBEDDED_SIGNUP_EXTRAS, ...parsed }
    }
    return parsed
  } catch {
    return extras
  }
}

function initializeFacebookSdk(config: WhatsAppEmbeddedSignupLaunchConfig) {
  if (!window.FB) {
    throw new Error("Facebook SDK 尚未加载完成")
  }

  window.FB.init({
    appId: config.appId,
    xfbml: true,
    version: config.apiVersion,
  })
}

function loadFacebookSdk(config: WhatsAppEmbeddedSignupLaunchConfig) {
  if (window.FB) {
    initializeFacebookSdk(config)
    return Promise.resolve()
  }

  if (!facebookSdkLoadPromise) {
    facebookSdkLoadPromise = new Promise<void>((resolve, reject) => {
      window.fbAsyncInit = () => {
        try {
          initializeFacebookSdk(config)
          resolve()
        } catch (error) {
          reject(error)
        }
      }

      const existingScript = document.getElementById(FACEBOOK_SDK_SCRIPT_ID)
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(), { once: true })
        existingScript.addEventListener("error", () => reject(new Error("Facebook SDK 加载失败")), { once: true })
        return
      }

      const script = document.createElement("script")
      script.id = FACEBOOK_SDK_SCRIPT_ID
      script.async = true
      script.defer = true
      script.crossOrigin = "anonymous"
      script.src = "https://connect.facebook.net/en_US/sdk.js"
      script.onerror = () => reject(new Error("Facebook SDK 加载失败"))
      document.body.appendChild(script)
    })
  }

  return facebookSdkLoadPromise.then(() => initializeFacebookSdk(config))
}

async function startEmbeddedSignup(
  config: WhatsAppEmbeddedSignupLaunchConfig,
  onStateUpdate: (update: Partial<EmbeddedSignupStateMachine>) => void
) {
  recordEmbeddedSignupClientDiagnostics({
    stage: "before_sdk_load",
    launch_config_has_redirect_uri: Boolean(config.redirectUri),
    frontend_callback_uses_env_redirect_uri: config.redirectUri.startsWith("https://")
      && config.redirectUri.includes("/api/whatsapp/auth/callback"),
    requested_scope_count: config.scopes.length,
    has_extras: Boolean(config.extras),
  })
  await loadFacebookSdk(config)

  const redirectUriIsCallback = config.redirectUri.startsWith("https://")
    && config.redirectUri.includes("/api/whatsapp/auth/callback")
  recordEmbeddedSignupClientDiagnostics({
    stage: "before_fb_login",
    launch_config_has_redirect_uri: Boolean(config.redirectUri),
    frontend_callback_uses_env_redirect_uri: redirectUriIsCallback,
    requested_scope_count: config.scopes.length,
    has_extras: Boolean(config.extras),
  })

  const result = await new Promise<{ code: string; hints: EmbeddedSignupHints; state: EmbeddedSignupStateMachine }>((resolve, reject) => {
    if (!window.FB) {
      reject(new Error("Facebook SDK 尚未加载完成"))
      return
    }

    let settled = false
    const launchedAt = Date.now()
    let focusTimer: number | null = null
    let finishGraceTimer: number | null = null
    let authCode: string | null = null
    let runtimeState = { ...EMPTY_EMBEDDED_SIGNUP_STATE_MACHINE }
    const hints: EmbeddedSignupHints = {}

    const applyStateUpdate = (update: Partial<EmbeddedSignupStateMachine>) => {
      const sanitizedUpdate = Object.fromEntries(
        Object.entries(update).filter(([, value]) => typeof value === "boolean")
      ) as Partial<EmbeddedSignupStateMachine>
      if (Object.keys(sanitizedUpdate).length === 0) return
      runtimeState = { ...runtimeState, ...sanitizedUpdate }
      onStateUpdate(sanitizedUpdate)
      recordEmbeddedSignupClientDiagnostics({
        stage: "embedded_signup_state",
        ...sanitizedStateMachine(runtimeState),
      })
    }

    const applyHints = (nextHints: EmbeddedSignupHints) => {
      if (nextHints.businessAccountId) hints.businessAccountId = nextHints.businessAccountId
      if (nextHints.phoneNumberId) hints.phoneNumberId = nextHints.phoneNumberId
      if (nextHints.businessPortfolioId) hints.businessPortfolioId = nextHints.businessPortfolioId
      if (nextHints.displayPhoneNumber) hints.displayPhoneNumber = nextHints.displayPhoneNumber
      if (nextHints.verifiedName) hints.verifiedName = nextHints.verifiedName
      applyStateUpdate({
        embeddedSignupHasWabaHint: Boolean(hints.businessAccountId),
        embeddedSignupHasPhoneHint: Boolean(hints.phoneNumberId),
      })
    }

    const cleanup = () => {
      window.clearTimeout(timeoutTimer)
      if (focusTimer) window.clearTimeout(focusTimer)
      if (finishGraceTimer) window.clearTimeout(finishGraceTimer)
      window.removeEventListener("focus", handleWindowFocus)
      window.removeEventListener("message", handleEmbeddedSignupRuntimeMessage)
    }

    const fail = (message: string, stage: string) => {
      if (settled) return
      settled = true
      cleanup()
      recordEmbeddedSignupClientDiagnostics({
        stage,
        has_code: false,
      })
      reject(new Error(message))
    }

    const complete = (authCode: string) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ code: authCode, hints, state: runtimeState })
    }

    const maybeCompleteWithCode = () => {
      if (!authCode || settled) return
      if (runtimeState.embeddedSignupFinishSeen || runtimeState.embeddedSignupHasWabaHint || runtimeState.embeddedSignupHasPhoneHint) {
        complete(authCode)
        return
      }
      if (finishGraceTimer) window.clearTimeout(finishGraceTimer)
      finishGraceTimer = window.setTimeout(() => {
        if (authCode) complete(authCode)
      }, EMBEDDED_SIGNUP_FINISH_GRACE_MS)
    }

    const handleEmbeddedSignupRuntimeMessage = (event: MessageEvent<unknown>) => {
      if (!isAllowedMetaMessageOrigin(event.origin)) return
      const embeddedEvent = parseEmbeddedSignupEvent(event.data)
      if (!embeddedEvent) return

      applyHints(embeddedEvent.hints)
      applyStateUpdate(embeddedEvent.state)

      if (embeddedEvent.state.embeddedSignupCancelSeen) {
        fail("未完成授权，请重新进入绑定流程。", "embedded_signup_cancel")
        return
      }

      if (embeddedEvent.state.embeddedSignupErrorSeen) {
        fail("该号码暂时无法直接接入 WhatsApp API，建议使用新的公司客服号码，或联系客服协助处理。", "embedded_signup_error")
        return
      }

      if (embeddedEvent.state.embeddedSignupFinishSeen) {
        maybeCompleteWithCode()
      }
    }

    const handleWindowFocus = () => {
      if (settled || Date.now() - launchedAt < EMBEDDED_SIGNUP_MIN_FOCUS_ELAPSED_MS) return
      if (focusTimer) window.clearTimeout(focusTimer)
      focusTimer = window.setTimeout(() => {
        fail("Meta 弹窗已关闭但未返回授权 code，请重新绑定并完成 WhatsApp 号码验证。", "fb_login_focus_without_code")
      }, EMBEDDED_SIGNUP_FOCUS_GRACE_MS)
    }

    const timeoutTimer = window.setTimeout(() => {
      fail("Meta 授权未在限定时间内返回授权 code，请重新绑定并完成 WhatsApp 号码验证。", "fb_login_code_timeout")
    }, EMBEDDED_SIGNUP_CODE_TIMEOUT_MS)

    window.addEventListener("focus", handleWindowFocus)
    window.addEventListener("message", handleEmbeddedSignupRuntimeMessage)

    window.FB.login((response) => {
      authCode = response.authResponse?.code || null
      applyStateUpdate({
        fbLoginCallbackSeen: true,
        fbLoginHasCode: Boolean(authCode),
      })
      recordEmbeddedSignupClientDiagnostics({
        stage: "fb_login_callback",
        status: response.status || "unknown",
        has_code: Boolean(authCode),
      })
      if (!authCode) {
        fail("未完成授权，请重新进入绑定流程。", "fb_login_callback_without_code")
        return
      }

      maybeCompleteWithCode()
    }, {
      config_id: config.configId,
      response_type: "code",
      override_default_response_type: true,
      extras: parseEmbeddedSignupExtras(config.extras),
    })
  })

  const redirectUrl = await completeEmbeddedSignupAuthorization(result.code, config.state, result.hints)
  recordEmbeddedSignupClientDiagnostics({
    stage: "redirecting_to_callback",
    frontend_callback_uses_env_redirect_uri: redirectUriIsCallback,
    has_code: Boolean(result.code),
    ...sanitizedStateMachine({ ...result.state, redirectedToCallback: true }),
  })
  onStateUpdate({ redirectedToCallback: true })
  window.location.href = redirectUrl
}

function formatDate(value: string | null) {
  if (!value) return "未记录"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "未记录"
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function bindingSourceLabel(source: WhatsAppBusinessAccount["binding_source"]) {
  if (source === "embedded_signup") return "Embedded Signup"
  if (source === "facebook_login_for_business") return "Facebook Login for Business"
  return "本地 env fallback"
}

function onboardingModeLabel(mode: WhatsAppBusinessAccount["onboarding_mode"]) {
  if (mode === "embedded_signup") return "官方自助绑定"
  if (mode === "coexistence") return "Business App 共存接入：待支持"
  if (mode === "manual") return "手动接入"
  return "本地测试映射"
}

function authorizationStatusLabel(account: WhatsAppBusinessAccount) {
  if (account.binding_source === "local_env") return "本地测试映射"
  if (account.status === "active" && account.token_status === "valid") return "授权有效"
  if (account.status !== "active") return "已停用"
  return "需要重新授权"
}

function accountTitle(account: WhatsAppBusinessAccount) {
  return account.verified_name || account.display_phone_number || account.business_account_name || "WhatsApp Business 号码"
}

function sensitiveIdLabel(maskedValue: string | null, hasValue: boolean) {
  if (maskedValue) return maskedValue
  return hasValue ? "已记录" : "未返回"
}

function messagingStatusLabel(account: WhatsAppBusinessAccount) {
  if (account.can_send_messages && account.can_receive_messages) return "可以收发消息"
  if (account.webhook_status === "mapped") return "等待接收首条消息验证"
  if (account.can_receive_messages) return "可以接收，发送未就绪"
  if (account.messaging_status === "blocked") return "发送被阻断"
  if (account.messaging_status === "disabled") return "消息通道停用"
  return "收发状态未确认"
}

function StatusBadge({ account }: { account: WhatsAppBusinessAccount }) {
  if (account.status !== "active") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
        <AlertCircle className="h-3 w-3" />
        已停用
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
      <CheckCircle2 className="h-3 w-3" />
      已绑定
    </span>
  )
}

export default function WhatsAppBusinessPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<WhatsAppBusinessAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [binding, setBinding] = useState(false)
  const [notice, setNotice] = useState<AuthNotice | null>(null)
  const [embeddedSignupProgress, setEmbeddedSignupProgress] = useState<EmbeddedSignupProgress>(
    EMPTY_EMBEDDED_SIGNUP_PROGRESS
  )
  const [embeddedSignupState, setEmbeddedSignupState] = useState<EmbeddedSignupStateMachine>(
    EMPTY_EMBEDDED_SIGNUP_STATE_MACHINE
  )

  const formalAccountCount = useMemo(
    () => accounts.filter((account) => account.binding_source !== "local_env" && account.status === "active").length,
    [accounts]
  )

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/whatsapp/business-accounts", { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (response.status === 401) {
        router.push("/auth/login?redirect=/whatsapp-business")
        return
      }
      if (!response.ok) throw new Error(data?.error || "加载 WhatsApp Business 绑定失败")
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : [])
    } catch (error) {
      toast({
        title: "加载失败",
        description: error instanceof Error ? error.message : "无法获取 WhatsApp Business 绑定",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [router, toast])

  useEffect(() => {
    void fetchAccounts()
  }, [fetchAccounts])

  useEffect(() => {
    const handleEmbeddedSignupMessage = (event: MessageEvent<unknown>) => {
      if (!isAllowedMetaMessageOrigin(event.origin)) return

      const embeddedEvent = parseEmbeddedSignupEvent(event.data)
      if (!embeddedEvent) return

      setEmbeddedSignupProgress((current) => {
        const next = { ...current, ...embeddedEvent.progress }
        recordEmbeddedSignupClientDiagnostics({
          stage: "embedded_signup_message",
          business_step_seen: next.businessStep,
          waba_step_seen: next.wabaStep,
          phone_number_step_seen: next.phoneNumberStep,
          phone_verification_step_seen: next.phoneVerificationStep,
          completed: next.completed,
          cancelled: next.cancelled,
        })
        return next
      })
      setEmbeddedSignupState((current) => {
        const sanitizedUpdate = Object.fromEntries(
          Object.entries(embeddedEvent.state).filter(([, value]) => typeof value === "boolean")
        ) as Partial<EmbeddedSignupStateMachine>
        const next = { ...current, ...sanitizedUpdate }
        recordEmbeddedSignupClientDiagnostics({
          stage: "embedded_signup_message_state",
          ...sanitizedStateMachine(next),
        })
        return next
      })
    }

    window.addEventListener("message", handleEmbeddedSignupMessage)
    return () => window.removeEventListener("message", handleEmbeddedSignupMessage)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const success = params.get("success")
    const whatsappAuth = params.get("whatsapp_auth")
    const error = params.get("error")
    const errorCode = params.get("code") || params.get("error_code")
    const name = params.get("name")

    if (success || whatsappAuth === "success") {
      const description = name ? `已连接：${name}` : "授权完成"
      setNotice({ type: "success", title: "WhatsApp Business 已绑定", description })
      toast({ title: "WhatsApp Business 已绑定", description })
      void fetchAccounts()
      const retryTimer = window.setTimeout(() => {
        void fetchAccounts()
      }, 1500)
      window.history.replaceState({}, "", "/whatsapp-business")
      return () => window.clearTimeout(retryTimer)
    } else if (error) {
      const description = getWhatsAppAuthErrorDescription(errorCode, error)
      setNotice({ type: "error", title: "WhatsApp Business 授权未完成", description })
      toast({ title: "WhatsApp Business 授权失败", description, variant: "destructive" })
      window.history.replaceState({}, "", "/whatsapp-business")
    }
  }, [fetchAccounts, toast])

  const startBinding = async (path: BindingPath) => {
    setNotice(null)
    setEmbeddedSignupProgress(EMPTY_EMBEDDED_SIGNUP_PROGRESS)
    setEmbeddedSignupState(EMPTY_EMBEDDED_SIGNUP_STATE_MACHINE)
    setBinding(true)
    try {
      const response = await fetch("/api/whatsapp/auth/url", { method: "POST" })
      const data = await response.json().catch(() => null) as WhatsAppAuthStartResponse | null
      recordEmbeddedSignupClientDiagnostics({
        stage: "auth_url_response",
        http_status: response.status,
        has_launch_mode: Boolean(data?.launchMode),
        launch_mode_is_js_sdk_embedded_signup: data?.launchMode === "js_sdk_embedded_signup",
        has_launch_config: Boolean(data?.launchConfig),
        launch_config_has_redirect_uri: Boolean(data?.launchConfig?.redirectUri),
        binding_path: path,
      })
      if (!response.ok) throw new Error(getWhatsAppAuthErrorDescription(data?.code || null, data?.error || null))
      if (data?.launchMode === "js_sdk_embedded_signup" && data.launchConfig) {
        await startEmbeddedSignup(data.launchConfig, (update) => {
          setEmbeddedSignupState((current) => ({ ...current, ...update }))
        })
        return
      }

      throw new Error("WhatsApp Embedded Signup 启动配置缺失")
    } catch (error) {
      const description = error instanceof Error ? error.message : "初始化授权失败"
      setNotice({
        type: "error",
        title: "WhatsApp Business 授权未完成",
        description,
      })
      toast({
        title: "无法连接",
        description,
        variant: "destructive",
      })
      setBinding(false)
    }
  }

  const scrollToBindingOptions = () => {
    document.getElementById("whatsapp-binding-options")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    })
  }

  let accountListContent = (
    <div className="flex min-h-[260px] items-center justify-center text-sm text-white/45">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      加载中
    </div>
  )

  if (!loading && accounts.length === 0) {
    accountListContent = (
      <div className="flex min-h-[260px] flex-col items-center justify-center px-6 text-center">
        <Building2 className="mb-3 h-10 w-10 text-white/20" />
        <div className="text-base font-medium">还没有 WhatsApp Business 绑定</div>
        <div className="mt-2 max-w-md text-sm leading-6 text-white/45">
          先选择适合你的号码接入方式，再进入 Meta 官方绑定流程。
        </div>
        <Button type="button" className="mt-5 bg-emerald-400 text-black hover:bg-emerald-300" onClick={scrollToBindingOptions} disabled={binding}>
          {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          选择绑定方式
        </Button>
      </div>
    )
  } else if (!loading) {
    accountListContent = (
      <div className="divide-y divide-white/10">
        {accounts.map((account) => {
          return (
          <article key={account.id} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-semibold">{accountTitle(account)}</h3>
                <StatusBadge account={account} />
                <span className="inline-flex items-center rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-200">
                  {authorizationStatusLabel(account)}
                </span>
              </div>
              <div className="mt-2 grid gap-x-6 gap-y-1 text-sm text-white/50 md:grid-cols-2">
                <div>显示号码：{account.display_phone_number || "未返回"}</div>
                <div>企业资料：{account.business_portfolio_name || "已记录"}</div>
                <div>绑定时间：{formatDate(account.connected_at || account.created_at)}</div>
                <div>接入模式：{onboardingModeLabel(account.onboarding_mode)}</div>
                <div>消息能力：{messagingStatusLabel(account)}</div>
              </div>
              <details className="mt-3 text-xs text-white/40">
                <summary className="cursor-pointer text-white/55">高级诊断</summary>
                <div className="mt-2 grid gap-x-6 gap-y-1 md:grid-cols-2">
                  <div>WABA ID：{sensitiveIdLabel(account.masked_business_account_id, account.has_business_account_id)}</div>
                  <div>接入来源：{bindingSourceLabel(account.binding_source)}</div>
                  <div>企业资料 ID：{sensitiveIdLabel(account.masked_business_portfolio_id, account.has_business_portfolio_id)}</div>
                  <div>更新于：{formatDate(account.updated_at)}</div>
                </div>
              </details>
            </div>
            <div className="flex shrink-0 flex-col items-start gap-1 text-sm text-white/45 lg:items-end">
              <div>连接状态：{account.status === "active" ? "已绑定" : "已停用"}</div>
              <div>接收消息：{account.can_receive_messages ? "可用" : "未验证"}</div>
              <div>发送消息：{account.can_send_messages ? "可用" : "未就绪"}</div>
            </div>
          </article>
          )
        })}
      </div>
    )
  }

  const onboardingSteps = [
    "登录 Meta/Facebook",
    "创建或选择企业资料",
    "创建或选择 WhatsApp Business 账号",
    "添加或选择 WhatsApp 号码",
    "完成短信/语音验证码",
    "返回本平台完成绑定",
  ]

  const embeddedSignupProgressItems = [
    { label: "企业资料步骤", active: embeddedSignupProgress.businessStep },
    { label: "WhatsApp Business 账号步骤", active: embeddedSignupProgress.wabaStep },
    { label: "号码步骤", active: embeddedSignupProgress.phoneNumberStep },
    { label: "验证码步骤", active: embeddedSignupProgress.phoneVerificationStep },
    { label: "流程完成", active: embeddedSignupProgress.completed },
    { label: "流程取消", active: embeddedSignupProgress.cancelled },
  ]

  const embeddedSignupStateItems = [
    { label: "授权回调", active: embeddedSignupState.fbLoginCallbackSeen },
    { label: "授权结果有效", active: embeddedSignupState.fbLoginHasCode },
    { label: "完成事件", active: embeddedSignupState.embeddedSignupFinishSeen },
    { label: "号码线索", active: embeddedSignupState.embeddedSignupHasPhoneHint },
    { label: "已交给后台保存", active: embeddedSignupState.redirectedToCallback },
  ]

  const bindingOptions: Array<{
    path: BindingPath
    title: string
    badge?: string
    description: string
    details: string[]
    buttonLabel: string
  }> = [
    {
      path: "new_service_number",
      title: "新开一个公司客服号码",
      badge: "推荐",
      description: "最稳定，不影响你原来的个人 WhatsApp。",
      details: [
        "进入 Meta 官方流程后，创建或选择企业资料。",
        "创建或选择 WhatsApp Business 账号。",
        "添加新的客服号码并完成短信或语音验证码。",
      ],
      buttonLabel: "使用新客服号码绑定",
    },
    {
      path: "existing_business_number",
      title: "我已经有 WhatsApp Business 号码",
      description: "适合正在使用 WhatsApp Business App 的客户。",
      details: [
        "进入 Meta 官方流程后选择现有企业和号码。",
        "如果 Meta 支持 Business App 共存接入，则继续完成绑定。",
        "如果该号码暂时无法接入，请使用新客服号码或联系客服协助迁移。",
      ],
      buttonLabel: "绑定已有 Business 号码",
    },
    {
      path: "prepared_business_number",
      title: "我现在只有普通 WhatsApp 号",
      description: "普通 WhatsApp 个人号不能直接接入 API。",
      details: [
        "可以先备份聊天记录。",
        "下载官方 WhatsApp Business App。",
        "使用原手机号登录并完成迁移。",
        "设置企业资料后回到本站继续官方绑定。",
        "升级为 WhatsApp Business App 不代表一定可以直接接入 API；后续仍需通过 Meta 官方 Embedded Signup 完成企业、号码验证和平台授权。",
      ],
      buttonLabel: "我已准备好 WhatsApp Business 号码，继续官方绑定",
    },
  ]

  return (
    <div className="min-h-screen bg-[#08090d] text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.push("/whatsapp-inbox")} className="text-white/70 hover:text-white">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-normal">
                <MessageCircle className="h-6 w-6 text-emerald-300" />
                WhatsApp Business 绑定
              </h1>
              <p className="mt-1 text-sm text-white/50">客户自助绑定 WhatsApp Business 号码后，用于 Inbox 客户消息</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]" onClick={fetchAccounts} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </Button>
            <Button type="button" className="bg-emerald-400 text-black hover:bg-emerald-300" onClick={scrollToBindingOptions} disabled={binding}>
              {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
              选择绑定方式
            </Button>
          </div>
        </header>

        {notice && (
          <section
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              notice.type === "success"
                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                : "border-red-400/20 bg-red-500/10 text-red-100"
            )}
          >
            <div className="font-medium">{notice.title}</div>
            <div className="mt-1 text-white/65">{notice.description}</div>
          </section>
        )}

        <section id="whatsapp-binding-options" className="rounded-lg border border-white/10 bg-white/[0.03] px-5 py-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">选择绑定方式</h2>
            <p className="text-sm leading-6 text-white/55">
              请选择最符合当前号码情况的路径。所有可接入号码最终都需要通过 Meta 官方流程完成企业、号码验证和平台授权。
            </p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {bindingOptions.map((option) => (
              <article
                key={option.path}
                className={cn(
                  "flex min-h-[300px] flex-col rounded-lg border p-4",
                  option.badge ? "border-emerald-300/30 bg-emerald-300/[0.06]" : "border-white/10 bg-black/10"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold">{option.title}</h3>
                  {option.badge && (
                    <span className="rounded-full bg-emerald-300/15 px-2 py-0.5 text-xs text-emerald-100">
                      {option.badge}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-6 text-white/65">{option.description}</p>
                <ul className="mt-3 flex flex-1 flex-col gap-2 text-sm leading-6 text-white/50">
                  {option.details.map((detail) => (
                    <li key={detail} className="flex gap-2">
                      <CheckCircle2 className="mt-1 h-3.5 w-3.5 shrink-0 text-emerald-200" />
                      <span>{detail}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  type="button"
                  className="mt-5 bg-emerald-400 text-black hover:bg-emerald-300"
                  onClick={() => void startBinding(option.path)}
                  disabled={binding}
                >
                  {binding ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                  {option.buttonLabel}
                </Button>
              </article>
            ))}
          </div>
          <p className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-sm leading-6 text-amber-100/85">
            不承诺原号码一定可以保留并同时继续在手机 App 使用；是否支持取决于 Meta 官方流程和号码当前状态。
          </p>
        </section>

        <section className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] px-5 py-4">
          <div className="text-sm font-medium text-emerald-100">绑定向导</div>
          <div className="mt-3 grid gap-2 text-sm leading-6 text-white/70 md:grid-cols-2 lg:grid-cols-3">
            {onboardingSteps.map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-300/15 text-xs text-emerald-100">
                  {index + 1}
                </span>
                <span>{step}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="text-xs uppercase tracking-normal text-white/35">Embedded Signup 过程</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {embeddedSignupProgressItems.map((item) => (
                <span
                  key={item.label}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    item.active ? "bg-emerald-400/12 text-emerald-100" : "bg-white/[0.04] text-white/45"
                  )}
                >
                  {item.active ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
                  {item.label}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {embeddedSignupStateItems.map((item) => (
                <span
                  key={item.label}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    item.active ? "bg-cyan-400/12 text-cyan-100" : "bg-white/[0.04] text-white/45"
                  )}
                >
                  {item.active ? <CheckCircle2 className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-white/45">已绑定号码</div>
            <div className="mt-2 text-3xl font-semibold">{accounts.length}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-white/45">正式授权</div>
            <div className="mt-2 text-3xl font-semibold">{formalAccountCount}</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm text-white/45">消息归属</div>
            <div className="mt-2 text-base font-medium text-emerald-200">已按绑定号码隔离</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 md:col-span-3">
            <div className="text-sm text-white/45">已有 WhatsApp Business App 的号码</div>
            <div className="mt-2 text-base font-medium text-white/80">通过 Meta 官方流程判断是否支持共存接入</div>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">当前 WhatsApp Business 号码</h2>
              <p className="mt-1 text-sm text-white/45">这些号码用于 Inbox 会话归属和客户消息收发</p>
            </div>
            <Button variant="ghost" className="text-white/65 hover:text-white" onClick={() => router.push("/whatsapp-inbox")}>
              <MessageCircle className="h-4 w-4" />
              打开 Inbox
            </Button>
          </div>

          {accountListContent}
        </section>
      </div>
    </div>
  )
}
