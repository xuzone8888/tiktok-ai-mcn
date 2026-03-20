"use client"

import { ALL_CATEGORIES, CATEGORY_LABELS, type TemplateCategory } from '@/types/content-template'
import { Search } from 'lucide-react'

interface TemplateFiltersProps {
  selectedCategory: TemplateCategory | null
  onCategoryChange: (category: TemplateCategory | null) => void
  searchQuery: string
  onSearchChange: (query: string) => void
  totalCount: number
}

export function TemplateFilters({
  selectedCategory,
  onCategoryChange,
  searchQuery,
  onSearchChange,
  totalCount,
}: TemplateFiltersProps) {
  return (
    <div className="space-y-6 mb-10">
      {/* 统计信息 */}
      <div className="flex items-center gap-2 text-xs font-mono text-white/40 uppercase tracking-widest">
        <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">
          {totalCount} 个模板
        </span>
        <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">
          {ALL_CATEGORIES.length} 个类别
        </span>
      </div>

      {/* 分类筛选 + 搜索 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 全部 */}
        <button
          onClick={() => onCategoryChange(null)}
          className={`px-6 py-2 rounded-full text-xs uppercase tracking-wider font-bold transition-all ${
            selectedCategory === null
              ? 'filter-capsule-selected text-black shadow-lg'
              : 'bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10'
          }`}
        >
          全部模板
        </button>

        {/* 6 个分类 */}
        {ALL_CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => onCategoryChange(cat)}
            className={`px-6 py-2 rounded-full text-xs uppercase tracking-wider font-bold transition-all ${
              selectedCategory === cat
                ? 'filter-capsule-selected text-black shadow-lg'
                : 'bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}

        {/* 搜索框 */}
        <div className="relative w-full md:w-72 ml-auto">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#00F2EA]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索模板..."
            className="w-full bg-[#0B0C10] border border-white/10 rounded-lg py-3 pl-11 pr-4 text-sm focus:outline-none focus:border-[#00F2EA]/50 transition-all placeholder:text-white/20 font-sans"
          />
        </div>
      </div>
    </div>
  )
}
