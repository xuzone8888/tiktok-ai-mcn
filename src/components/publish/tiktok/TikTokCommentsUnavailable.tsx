import { ShieldCheck } from "lucide-react"

import { TikTokLogo } from "@/components/brand/TikTokLogo"

interface TikTokCommentsUnavailableProps {
  embedded?: boolean
}

export function TikTokCommentsUnavailable({
  embedded = false,
}: TikTokCommentsUnavailableProps) {
  return (
    <div className={embedded ? "" : "mx-auto max-w-7xl p-6"}>
      <section className="rounded-2xl border border-white/10 bg-white/5 p-8">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
            <TikTokLogo className="h-7 w-7 text-white" />
          </div>
          <h2 className="text-xl font-semibold text-white">TikTok 评论管理</h2>
          <p className="mt-2 text-sm leading-6 text-white/60">
            TikTok 评论读取与回复需要独立的 Business OAuth 授权，当前环境尚未启用该功能。
            现有 TikTok 登录、视频发布和账号管理能力不受影响。
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
            <ShieldCheck className="h-4 w-4" />
            此能力受独立的服务端与界面开关保护
          </div>
        </div>
      </section>
    </div>
  )
}
