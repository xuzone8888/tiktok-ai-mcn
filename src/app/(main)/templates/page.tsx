"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { TemplateFilters } from '@/components/templates/TemplateFilters'
import { TemplateCard } from '@/components/templates/TemplateCard'
import { TemplateDetailDialog } from '@/components/templates/TemplateDetailDialog'
import { useToast } from '@/hooks/use-toast'
import { useLang } from '@/contexts/LangContext'
import { localizeTemplate } from '@/lib/template-localization'
import { useTranslations } from 'next-intl'
import type { ContentTemplate, TemplateCategory } from '@/types/content-template'

export default function TemplatesPage() {
  const { toast } = useToast()
  const { lang } = useLang()
  const t = useTranslations('templates')

  // Data state
  const [templates, setTemplates] = useState<ContentTemplate[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Filter state
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Dialog state
  const [selectedTemplate, setSelectedTemplate] = useState<ContentTemplate | null>(null)

  // Fetch templates
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true)
      try {
        const res = await fetch('/api/content-templates')
        const json = await res.json()
        setTemplates(json.data || [])
      } catch (error) {
        console.error('Failed to fetch templates:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchData()
  }, [])

  // Fetch favorites
  useEffect(() => {
    async function fetchFavorites() {
      try {
        const res = await fetch('/api/content-templates/favorites')
        const json = await res.json()
        setFavorites(json.data || [])
      } catch {
        // Not logged in or error — ignore
      }
    }
    fetchFavorites()
  }, [])

  const localizedTemplates = useMemo(
    () => templates.map((template) => localizeTemplate(template, lang)),
    [templates, lang]
  )

  // Client-side filtering
  const filteredTemplates = useMemo(() => {
    let result = localizedTemplates

    if (selectedCategory) {
      result = result.filter((t) => t.category === selectedCategory)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q))
      )
    }

    return result
  }, [localizedTemplates, selectedCategory, searchQuery])

  const localizedSelectedTemplate = selectedTemplate
    ? localizedTemplates.find((template) => template.id === selectedTemplate.id) ||
      localizeTemplate(selectedTemplate, lang)
    : null

  // Toggle favorite
  const handleToggleFavorite = useCallback(async (templateId: string) => {
    const isFav = favorites.includes(templateId)

    // Optimistic update
    setFavorites((prev) =>
      isFav ? prev.filter((id) => id !== templateId) : [...prev, templateId]
    )

    try {
      const res = await fetch('/api/content-templates/favorites', {
        method: isFav ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: templateId }),
      })

      if (!res.ok) {
        // Revert
        setFavorites((prev) =>
          isFav ? [...prev, templateId] : prev.filter((id) => id !== templateId)
        )
        toast({
          title: t('toast.operationFailed'),
          description: t('toast.signIn'),
          variant: 'destructive',
        })
      }
    } catch {
      // Revert
      setFavorites((prev) =>
        isFav ? [...prev, templateId] : prev.filter((id) => id !== templateId)
      )
    }
  }, [favorites, toast, t])

  // Copy prompt
  const handleCopyPrompt = useCallback(async (template: ContentTemplate) => {
    try {
      await navigator.clipboard.writeText(template.prompt_template)
      toast({
        title: t('toast.promptCopied'),
        description: t('toast.promptCopiedDescription', { name: template.name }),
      })

      // Increment usage count
      fetch(`/api/content-templates/${template.id}`, { method: 'PATCH' }).catch(() => {})

      // Update local count
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === template.id ? { ...t, usage_count: t.usage_count + 1 } : t
        )
      )
    } catch {
      toast({ title: t('toast.copyFailed'), variant: 'destructive' })
    }
  }, [toast, t])

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="flex items-center">
          <div className="mermaid-bar h-14 mr-6" />
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter uppercase mb-1 text-white">
              {t('page.title')}
            </h1>
            <p className="text-white/50 text-xs tracking-widest uppercase">
              {t('page.subtitle')}
            </p>
          </div>
        </div>
      </header>

      {/* Filters */}
      <TemplateFilters
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalCount={templates.length}
      />

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-8 h-8 border-2 border-[#00F2EA] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
          <p className="text-white/40 text-lg">{t('page.empty')}</p>
          <p className="text-white/20 text-sm">{t('page.emptyHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {filteredTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              isFavorited={favorites.includes(template.id)}
              onToggleFavorite={handleToggleFavorite}
              onCopyPrompt={handleCopyPrompt}
              onClick={setSelectedTemplate}
            />
          ))}
        </div>
      )}

      {/* Detail Dialog */}
      <TemplateDetailDialog
        template={localizedSelectedTemplate}
        isOpen={!!localizedSelectedTemplate}
        onClose={() => setSelectedTemplate(null)}
        isFavorited={localizedSelectedTemplate ? favorites.includes(localizedSelectedTemplate.id) : false}
        onToggleFavorite={handleToggleFavorite}
        onCopyPrompt={handleCopyPrompt}
      />
    </div>
  )
}
