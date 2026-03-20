"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import { TemplateFilters } from '@/components/templates/TemplateFilters'
import { TemplateCard } from '@/components/templates/TemplateCard'
import { TemplateDetailDialog } from '@/components/templates/TemplateDetailDialog'
import { useToast } from '@/hooks/use-toast'
import type { ContentTemplate, TemplateCategory } from '@/types/content-template'

export default function TemplatesPage() {
  const { toast } = useToast()

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

  // Client-side filtering
  const filteredTemplates = useMemo(() => {
    let result = templates

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
  }, [templates, selectedCategory, searchQuery])

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
        toast({ title: '操作失败', description: '请先登录', variant: 'destructive' })
      }
    } catch {
      // Revert
      setFavorites((prev) =>
        isFav ? [...prev, templateId] : prev.filter((id) => id !== templateId)
      )
    }
  }, [favorites, toast])

  // Copy prompt
  const handleCopyPrompt = useCallback(async (template: ContentTemplate) => {
    try {
      await navigator.clipboard.writeText(template.prompt_template)
      toast({ title: '✅ Prompt 已复制', description: `"${template.name}" 的 Prompt 已复制到剪贴板` })

      // Increment usage count
      fetch(`/api/content-templates/${template.id}`, { method: 'PATCH' }).catch(() => {})

      // Update local count
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === template.id ? { ...t, usage_count: t.usage_count + 1 } : t
        )
      )
    } catch {
      toast({ title: '❌ 复制失败', variant: 'destructive' })
    }
  }, [toast])

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="flex items-center">
          <div className="mermaid-bar h-14 mr-6" />
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter uppercase mb-1 text-white">
              模板中心
            </h1>
            <p className="text-white/50 text-xs tracking-widest uppercase">
              发现灵感模板，一键激活创作
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
          <p className="text-white/40 text-lg">没有找到相关模板</p>
          <p className="text-white/20 text-sm">试试其他分类或关键词</p>
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
        template={selectedTemplate}
        isOpen={!!selectedTemplate}
        onClose={() => setSelectedTemplate(null)}
        isFavorited={selectedTemplate ? favorites.includes(selectedTemplate.id) : false}
        onToggleFavorite={handleToggleFavorite}
        onCopyPrompt={handleCopyPrompt}
      />
    </div>
  )
}
