"use client"

import { useRef, useState, useEffect } from 'react'
import { X, Heart, Share2, Copy, Play, Pause } from 'lucide-react'
import type { ContentTemplate, TemplateCategory } from '@/types/content-template'
import { useToast } from '@/hooks/use-toast'
import { useTranslations } from 'next-intl'

interface TemplateDetailDialogProps {
  template: ContentTemplate | null
  isOpen: boolean
  onClose: () => void
  isFavorited: boolean
  onToggleFavorite: (templateId: string) => void
  onCopyPrompt: (template: ContentTemplate) => void
}

export function TemplateDetailDialog({
  template,
  isOpen,
  onClose,
  isFavorited,
  onToggleFavorite,
  onCopyPrompt,
}: TemplateDetailDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const { toast } = useToast()
  const t = useTranslations('templates')
  const categoryLabels = t.raw('categories') as Record<TemplateCategory, string>
  const configKeyLabels = t.raw('detail.configKeys') as Record<string, string>

  // reset video state on template change
  useEffect(() => {
    setIsPlaying(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }, [template?.id])

  // close on Escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  if (!isOpen || !template) return null

  const togglePlay = () => {
    if (!videoRef.current) return
    if (isPlaying) {
      videoRef.current.pause()
    } else {
      videoRef.current.play().catch(() => {})
    }
    setIsPlaying(!isPlaying)
  }

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin + '/templates?id=' + template.id)
      toast({
        title: t('toast.linkCopied'),
        description: t('toast.linkCopiedDescription'),
      })
    } catch {
      toast({ title: t('toast.copyFailed'), variant: 'destructive' })
    }
  }

  const formatUsageCount = (count: number) => {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
    return count.toString()
  }

  // Parse script_outline (could be string[] or JSON string)
  const outlineItems: string[] = Array.isArray(template.script_outline)
    ? template.script_outline
    : []

  // Parse recommended_config
  const config = template.recommended_config || {}
  const configEntries = Object.entries(config).filter(([, v]) => v)

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 md:p-8"
        onClick={onClose}
      >
        {/* Modal */}
        <div
          className="relative w-full max-w-6xl h-full max-h-[800px] bg-[#16181D] rounded-2xl border border-white/10 shadow-[0_0_60px_-15px_rgba(0,0,0,0.8)] flex flex-col md:flex-row overflow-hidden glass-edge"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Internal noise */}
          <div className="absolute inset-0 fractal-noise opacity-[0.05] z-0 pointer-events-none" />

          {/* Left: Video Preview */}
          <div className="relative w-full md:w-[45%] h-64 md:h-full p-6 z-10">
            <div className="relative w-full h-full rounded-xl overflow-hidden border border-white/10 bg-black group">
              <video
                ref={videoRef}
                src={template.preview_video_url || undefined}
                muted
                loop
                playsInline
                preload="metadata"
                className="w-full h-full object-cover"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />

              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-8">
                <div className="flex items-center gap-4">
                  <button
                    onClick={togglePlay}
                    aria-label={t(isPlaying ? 'detail.pause' : 'detail.play')}
                    title={t(isPlaying ? 'detail.pause' : 'detail.play')}
                    className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20 hover:scale-110 transition-transform cursor-pointer"
                  >
                    {isPlaying ? (
                      <Pause className="w-5 h-5 text-white" fill="white" />
                    ) : (
                      <Play className="w-5 h-5 text-white ml-0.5" fill="white" />
                    )}
                  </button>
                  <div>
                    <p className="text-xs text-white/60 tracking-widest uppercase font-medium">
                      {t('detail.videoPreview')}
                    </p>
                    <p className="text-white font-bold tracking-tight">
                      {template.name}
                    </p>
                  </div>
                </div>
              </div>

              {/* Refractive top bar */}
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#c3f400] via-[#00F2EA] to-[#EC4899] opacity-40" />
            </div>
          </div>

          {/* Right: Details Panel */}
          <div className="relative flex-1 p-8 md:p-12 z-10 flex flex-col justify-between overflow-y-auto">
            <div>
              {/* Header */}
              <div className="flex items-start gap-6 mb-8">
                <div className="w-[6px] h-12 bg-gradient-to-b from-[#c3f400] to-[#00F2EA] rounded-full" />
                <div>
                  <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white leading-none mb-2">
                    {template.name}
                  </h1>
                  <div className="flex gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded-sm bg-[#00F2EA]/20 text-[#00F2EA] border border-[#00F2EA]/30">
                      {categoryLabels[template.category]}
                    </span>
                    {template.is_featured && (
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded-sm bg-[#c3f400]/20 text-[#c3f400] border border-[#c3f400]/30">
                        {t('card.trending')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                <div className="bg-[#0B0C10] p-4 rounded-lg border border-white/5">
                  <p className="text-[10px] text-white/50 uppercase tracking-widest mb-1">{t('detail.category')}</p>
                  <p className="text-sm text-white font-medium">{categoryLabels[template.category]}</p>
                </div>
                <div className="bg-[#0B0C10] p-4 rounded-lg border border-white/5">
                  <p className="text-[10px] text-white/50 uppercase tracking-widest mb-1">{t('detail.duration')}</p>
                  <p className="text-sm text-white font-medium">{config.duration || '15s'}</p>
                </div>
                <div className="bg-[#0B0C10] p-4 rounded-lg border border-white/5">
                  <p className="text-[10px] text-white/50 uppercase tracking-widest mb-1">{t('detail.used')}</p>
                  <p className="text-sm text-white font-medium">{t('detail.usedValue', { count: formatUsageCount(template.usage_count) })}</p>
                </div>
                <div className="bg-[#0B0C10] p-4 rounded-lg border border-white/5">
                  <p className="text-[10px] text-white/50 uppercase tracking-widest mb-1">{t('detail.scene')}</p>
                  <p className="text-sm text-white font-medium">{config.scene || t('detail.general')}</p>
                </div>
              </div>

              {/* Prompt */}
              <div className="mb-8">
                <h3 className="text-xs text-white/50 uppercase tracking-[0.3em] mb-4">{t('detail.promptTemplate')}</h3>
                <div className="relative group rounded-lg overflow-hidden border border-white/10 bg-[#0B0C10]">
                  <div className="p-4 min-h-[80px]">
                    <p className="text-sm leading-relaxed font-mono text-white/80 whitespace-pre-wrap">
                      {template.prompt_template}
                    </p>
                  </div>
                  <button
                    onClick={() => onCopyPrompt(template)}
                    className="absolute top-3 right-3 p-2 rounded-md bg-white/5 border border-white/10 text-white/60 hover:text-[#00F2EA] hover:border-[#00F2EA]/30 transition-all opacity-0 group-hover:opacity-100"
                    title={t('detail.copyPromptTitle')}
                    aria-label={t('detail.copyPromptTitle')}
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Script Outline */}
              {outlineItems.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-xs text-white/50 uppercase tracking-[0.3em] mb-4">{t('detail.scriptOutline')}</h3>
                  <ol className="space-y-2">
                    {outlineItems.map((item, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-white/70">
                        <span className="w-6 h-6 rounded-full bg-[#00F2EA]/10 text-[#00F2EA] flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                          {i + 1}
                        </span>
                        <span className="leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Recommended Config */}
              {configEntries.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-xs text-white/50 uppercase tracking-[0.3em] mb-4">{t('detail.recommendedConfig')}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {configEntries.map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 text-sm">
                        <span className="text-white/40 capitalize">{configKeyLabels[key] || key.replaceAll('_', ' ')}:</span>
                        <span className="text-white font-medium">{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Description */}
              {template.description && (
                <div className="mb-10">
                  <h3 className="text-xs text-white/50 uppercase tracking-[0.3em] mb-4">{t('detail.description')}</h3>
                  <p className="text-white/60 leading-relaxed max-w-xl">
                    {template.description}
                  </p>
                </div>
              )}

              {/* Style Tags */}
              {template.style_tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-12">
                  {template.style_tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs text-white/60 hover:border-[#00F2EA]/50 transition-colors cursor-default"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-4 pt-8 border-t border-white/5">
              <button
                onClick={() => onCopyPrompt(template)}
                className="w-full sm:flex-1 h-14 mermaid-glass-cta flex items-center justify-center gap-3 text-sm rounded-sm"
              >
                <span>{t('card.copyPrompt')}</span>
                <Copy className="w-5 h-5" />
              </button>
              <div className="flex gap-3 w-full sm:w-auto">
                <button
                  onClick={() => onToggleFavorite(template.id)}
                  aria-label={t(isFavorited ? 'card.unfavorite' : 'card.favorite')}
                  title={t(isFavorited ? 'card.unfavorite' : 'card.favorite')}
                  className="h-14 w-14 flex items-center justify-center rounded-sm bg-white/5 border border-white/10 text-white/60 hover:text-pink-400 transition-all group"
                >
                  <Heart
                    className="w-5 h-5 transition-transform group-hover:scale-110"
                    fill={isFavorited ? 'currentColor' : 'none'}
                    style={{ color: isFavorited ? '#EC4899' : undefined }}
                  />
                </button>
                <button
                  onClick={handleShare}
                  aria-label={t('detail.share')}
                  title={t('detail.share')}
                  className="h-14 w-14 flex items-center justify-center rounded-sm bg-white/5 border border-white/10 text-white/60 hover:text-pink-400 transition-all group"
                >
                  <Share2 className="w-5 h-5 transition-transform group-hover:rotate-12" />
                </button>
              </div>
            </div>
          </div>

          {/* Close Button */}
          <button
            onClick={onClose}
            aria-label={t('detail.close')}
            title={t('detail.close')}
            className="absolute top-6 right-6 z-20 w-10 h-10 flex items-center justify-center rounded-full bg-black/20 hover:bg-white/10 transition-all text-white/50 hover:text-white border border-transparent hover:border-white/10"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>
    </>
  )
}
