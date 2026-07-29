"use client"

/**
 * 配方库(S4.3:配方库收编模板中心)
 *
 * Tab「我的配方」= 配方管理主界面:内置种子(seed-*,客户端常量)+ 用户配方
 * (recipes 表,RLS own)。动作:去使用(携参跳 /studio?recipe=)/重命名/删除
 * (软删 status='archived')。
 * Tab「灵感模板」= 原模板中心(content_templates 公开预设)原样保留为只读
 * 浏览区——prompt 复制/收藏不动,旧链接不断。
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Play, Trash2 } from 'lucide-react'
import { TemplateFilters } from '@/components/templates/TemplateFilters'
import { TemplateCard } from '@/components/templates/TemplateCard'
import { TemplateDetailDialog } from '@/components/templates/TemplateDetailDialog'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { BUILTIN_RECIPES } from '@/lib/studio/recipes'
import { cn } from '@/lib/utils'
import type { ContentTemplate, TemplateCategory } from '@/types/content-template'

// ============================================================================
// 我的配方 Tab
// ============================================================================

interface RecipeRow {
  id: string
  name: string
  description?: string | null
  scenes?: unknown[]
  hooks?: unknown[]
  render_mode?: string | null
  use_count?: number
  created_at?: string
  builtin?: boolean
}

const LEG_LABELS: Record<string, string> = {
  slideshow: '幻灯片',
  assembly: '拼装口播',
  ai_gen: 'AI 生成',
  photo_post: '图文帖',
}

function RecipeLibrary() {
  const router = useRouter()
  const { toast } = useToast()
  const [recipes, setRecipes] = useState<RecipeRow[]>([])
  const [dbReady, setDbReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [renaming, setRenaming] = useState<RecipeRow | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<RecipeRow | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch('/api/studio/recipes')
      .then((res) => res.json())
      .then((result) => {
        setRecipes(Array.isArray(result?.data?.recipes) ? result.data.recipes : [])
        setDbReady(result?.data?.dbReady !== false)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const builtinRows: RecipeRow[] = useMemo(
    () =>
      BUILTIN_RECIPES.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        scenes: r.scenes,
        hooks: r.hooks,
        render_mode: r.render_mode,
        builtin: true,
      })),
    []
  )

  const openRecipe = (id: string) => {
    router.push(`/studio?recipe=${encodeURIComponent(id)}`)
  }

  const confirmRename = async () => {
    if (!renaming) return
    const name = renameValue.trim()
    if (!name) {
      toast({ title: '配方名不能为空', variant: 'destructive' })
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/studio/recipes/${renaming.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const result = await res.json()
      if (!result.success) throw new Error(result.error || '重命名失败')
      setRecipes((prev) => prev.map((r) => (r.id === renaming.id ? { ...r, name } : r)))
      // omnibox 配方下拉同步刷新(S3.5 既有事件)
      window.dispatchEvent(new Event('recipes-updated'))
      setRenaming(null)
      toast({ title: '已重命名' })
    } catch (error) {
      toast({
        title: '重命名失败',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      const res = await fetch(`/api/studio/recipes/${deleting.id}`, { method: 'DELETE' })
      const result = await res.json()
      if (!result.success) throw new Error(result.error || '删除失败')
      setRecipes((prev) => prev.filter((r) => r.id !== deleting.id))
      window.dispatchEvent(new Event('recipes-updated'))
      setDeleting(null)
      toast({ title: '配方已删除' })
    } catch (error) {
      toast({
        title: '删除失败',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const renderCard = (recipe: RecipeRow) => {
    const sceneCount = Array.isArray(recipe.scenes) ? recipe.scenes.length : 0
    const legLabel = recipe.render_mode ? LEG_LABELS[recipe.render_mode] : null
    return (
      <div
        key={recipe.id}
        className="flex flex-col rounded-xl border border-white/10 bg-black/30 p-4 transition-colors hover:border-white/25"
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
            {recipe.builtin ? '📐 ' : '📕 '}
            {recipe.name}
          </h3>
          {recipe.builtin && (
            <span className="shrink-0 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">
              内置
            </span>
          )}
        </div>
        {recipe.description && (
          <p className="mb-2 line-clamp-2 text-xs text-zinc-500">{recipe.description}</p>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
          {legLabel && (
            <span className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-300">
              {legLabel}
            </span>
          )}
          <span>{sceneCount} 镜</span>
          {typeof recipe.use_count === 'number' && <span>· 用过 {recipe.use_count} 次</span>}
          {recipe.created_at && (
            <span>· {new Date(recipe.created_at).toLocaleDateString('zh-CN')}</span>
          )}
        </div>
        <div className="mt-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 flex-1 gap-1 text-xs text-amber-400 hover:text-amber-300"
            onClick={() => openRecipe(recipe.id)}
          >
            <Play className="h-3 w-3" />
            去使用
          </Button>
          {!recipe.builtin && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-zinc-500 hover:text-zinc-200"
                title="重命名"
                onClick={() => {
                  setRenaming(recipe)
                  setRenameValue(recipe.name)
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-zinc-500 hover:text-red-400"
                title="删除"
                onClick={() => setDeleting(recipe)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      {!dbReady && (
        <p className="mb-4 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          配方表迁移(20260703_recipes.sql)待执行——内置配方可正常使用,「存为配方」与用户配方在迁移执行后自动激活
        </p>
      )}
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-600" />
        </div>
      ) : (
        <>
          {recipes.length === 0 && (
            <p className="mb-4 text-xs text-zinc-600">
              还没有自建配方——在 /studio 出片后打开蓝图,点「存为配方」即可把爆款结构沉淀为可复用模板
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[...recipes.map((r) => ({ ...r, builtin: false })), ...builtinRows].map(renderCard)}
          </div>
        </>
      )}

      {/* 重命名弹窗 */}
      <AlertDialog open={!!renaming} onOpenChange={(open) => !open && setRenaming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重命名配方</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !busy) {
                    e.preventDefault()
                    void confirmRename()
                  }
                }}
                maxLength={100}
                autoFocus
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 focus:border-amber-400/50 focus:outline-none"
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void confirmRename()}>
              保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除配方「{deleting?.name}」?</AlertDialogTitle>
            <AlertDialogDescription>
              删除后 omnibox 配方列表不再显示;已用该配方生成的蓝图与成片不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ============================================================================
// 灵感模板 Tab(原模板中心,只读浏览原样保留)
// ============================================================================

function LegacyTemplates() {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<ContentTemplate[]>([])
  const [favorites, setFavorites] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<ContentTemplate | null>(null)

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

  const handleToggleFavorite = useCallback(
    async (templateId: string) => {
      const isFav = favorites.includes(templateId)
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
          setFavorites((prev) =>
            isFav ? [...prev, templateId] : prev.filter((id) => id !== templateId)
          )
          toast({ title: '操作失败', description: '请先登录', variant: 'destructive' })
        }
      } catch {
        setFavorites((prev) =>
          isFav ? [...prev, templateId] : prev.filter((id) => id !== templateId)
        )
      }
    },
    [favorites, toast]
  )

  const handleCopyPrompt = useCallback(
    async (template: ContentTemplate) => {
      try {
        await navigator.clipboard.writeText(template.prompt_template)
        toast({ title: '✅ Prompt 已复制', description: `"${template.name}" 的 Prompt 已复制到剪贴板` })
        fetch(`/api/content-templates/${template.id}`, { method: 'PATCH' }).catch(() => {})
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === template.id ? { ...t, usage_count: t.usage_count + 1 } : t
          )
        )
      } catch {
        toast({ title: '❌ 复制失败', variant: 'destructive' })
      }
    },
    [toast]
  )

  return (
    <div>
      <TemplateFilters
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalCount={templates.length}
      />

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

// ============================================================================
// 页面
// ============================================================================

export default function RecipeLibraryPage() {
  const [tab, setTab] = useState<'recipes' | 'inspiration'>('recipes')

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
        <div className="flex items-center">
          <div className="mermaid-bar h-14 mr-6" />
          <div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tighter uppercase mb-1 text-white">
              配方库
            </h1>
            <p className="text-white/50 text-xs tracking-widest uppercase">
              爆款结构沉淀为可复用配方,一键实例化出片
            </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="mb-6 flex items-center gap-1 border-b border-white/10">
        {(
          [
            { key: 'recipes', label: '我的配方' },
            { key: 'inspiration', label: '灵感模板' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-[#00F2EA] text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'recipes' ? <RecipeLibrary /> : <LegacyTemplates />}
    </div>
  )
}
