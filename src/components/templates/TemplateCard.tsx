"use client"

import { useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { CATEGORY_LABELS, type ContentTemplate } from '@/types/content-template'

interface TemplateCardProps {
  template: ContentTemplate
  isFavorited: boolean
  onToggleFavorite: (templateId: string) => void
  onCopyPrompt: (template: ContentTemplate) => void
  onClick: (template: ContentTemplate) => void
}

export function TemplateCard({
  template,
  isFavorited,
  onToggleFavorite,
  onCopyPrompt,
  onClick,
}: TemplateCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isHovered, setIsHovered] = useState(false)

  const handleMouseEnter = () => {
    setIsHovered(true)
    videoRef.current?.play().catch(() => {})
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  const formatUsageCount = (count: number) => {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
    return count.toString()
  }

  return (
    <article
      className="group card-high-fi rounded-xl overflow-hidden transition-all duration-500 flex flex-col aspect-[9/16] cursor-pointer"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => onClick(template)}
    >
      {/* 视频预览区 */}
      <div className="relative flex-1 overflow-hidden">
        <div className="w-full h-full overflow-hidden">
          <video
            ref={videoRef}
            src={template.preview_video_url || undefined}
            muted
            loop
            playsInline
            preload="metadata"
            className={`w-full h-full object-cover transition-all duration-1000 group-hover:scale-[1.05] ${
              isHovered ? '' : 'grayscale'
            }`}
          />
        </div>

        {/* 底部渐变 */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0C10] via-transparent to-transparent opacity-80" />

        {/* 左上角 ID */}
        <div className="absolute top-4 left-4 font-mono text-[10px] text-white/40 tracking-[0.2em] bg-black/40 backdrop-blur-sm px-2 py-1 border border-white/5 uppercase">
          {template.category.slice(0, 3).toUpperCase()}-{template.sort_order.toString().padStart(3, '0')}
        </div>

        {/* 右上角收藏 */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite(template.id)
          }}
          className="absolute top-4 right-4 p-2 rounded-full bg-black/40 backdrop-blur-md border border-white/10 text-white/60 hover:text-pink-400 transition-colors z-10"
        >
          <Heart
            className="w-4 h-4"
            fill={isFavorited ? 'currentColor' : 'none'}
            strokeWidth={isFavorited ? 0 : 2}
            style={{ color: isFavorited ? '#EC4899' : undefined }}
          />
        </button>

        {/* 底部信息 */}
        <div className="absolute bottom-4 left-4 right-4">
          <div className="flex items-center gap-2 mb-2">
            {/* 分类标签 */}
            <span className="text-[10px] text-[#00F2EA] bg-[#00F2EA]/10 px-2 py-0.5 rounded border border-[#00F2EA]/20 font-medium">
              {CATEGORY_LABELS[template.category]}
            </span>
            {/* Featured 标记 */}
            {template.is_featured && (
              <span className="text-[10px] text-[#c3f400] bg-[#c3f400]/10 px-2 py-0.5 rounded border border-[#c3f400]/20 font-medium">
                TRENDING
              </span>
            )}
            {/* 使用次数 */}
            <span className="font-mono text-[10px] text-white/40 uppercase tracking-widest">
              {formatUsageCount(template.usage_count)} Uses
            </span>
          </div>
          <h3 className="text-xl font-bold tracking-tight text-white">
            {template.name}
          </h3>
        </div>
      </div>

      {/* CTA 按钮 */}
      <div className="p-4 bg-[#0B0C10] border-t border-white/5">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onCopyPrompt(template)
          }}
          className="w-full mermaid-gradient shimmer-sweep py-3 rounded text-black font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:opacity-95 active:scale-[0.98] transition-all"
        >
          Copy Prompt
        </button>
      </div>
    </article>
  )
}
