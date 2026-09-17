'use client'

import { RefreshCw, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function PublishTaskFilters({ status, onStatusChange, dateRange, onDateRangeChange, search, onSearchChange, loading, onRefresh, isEnglish = false }: {
  status: string; onStatusChange: (value: string) => void
  dateRange: string; onDateRangeChange: (value: string) => void
  search: string; onSearchChange: (value: string) => void
  loading: boolean; onRefresh: () => void; isEnglish?: boolean
}) {
  const text = (zh: string, en: string) => isEnglish ? en : zh
  return (
    <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-white/5 p-1" aria-label={text('任务状态', 'Task status')}>
          {[
            ['all', text('全部', 'All')], ['in_progress', text('进行中', 'In progress')],
            ['completed', text('已完成', 'Completed')], ['failed', text('失败', 'Failed')],
          ].map(([value, label]) => (
            <button key={value} type="button" aria-pressed={status === value} onClick={() => onStatusChange(value)}
              className={cn('rounded-md px-3 py-2 text-sm transition-colors', status === value ? 'bg-white/10 text-white' : 'text-white/50 hover:bg-white/5 hover:text-white')}>
              {label}
            </button>
          ))}
        </div>
        <select aria-label={text('日期范围', 'Date range')} value={dateRange} onChange={event => onDateRangeChange(event.target.value)}
          className="h-9 rounded-md border border-white/10 bg-neutral-950 px-3 text-sm text-white">
          {[['today', text('今天', 'Today')], ['yesterday', text('昨天', 'Yesterday')], ['3days', text('近3天', 'Last 3 days')], ['7days', text('近7天', 'Last 7 days')]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 xl:w-60">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-white/40" />
          <Input aria-label={text('搜索已加载任务或视频', 'Search loaded tasks or videos')} placeholder={text('搜索已加载任务或视频…', 'Search loaded tasks or videos…')}
            value={search} onChange={event => onSearchChange(event.target.value)} className="h-9 border-white/10 bg-white/5 pl-9" />
        </div>
        <Button type="button" variant="titanium-outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />{text('刷新', 'Refresh')}
        </Button>
      </div>
    </div>
  )
}
