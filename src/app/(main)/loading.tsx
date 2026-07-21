import { Loader2 } from 'lucide-react'

export default function MainRouteLoading() {
  return (
    <div className="flex min-h-[320px] items-center justify-center px-6 py-16">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-sm text-white/70 shadow-xl backdrop-blur-sm">
        <Loader2 className="h-5 w-5 animate-spin text-mermaid-cyan" />
        <span>正在打开页面...</span>
      </div>
    </div>
  )
}
