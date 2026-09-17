'use client'

import { useTikTokLanguage } from '@/hooks/use-tiktok-language'
import type { TaskGroup } from './TaskGroupCard'
import { isTikTokVideoListUiEnabled } from '@/lib/tiktok/video-list-rollout'

export function summarizeTaskOverview(tasks: TaskGroup[]) {
    const unique = [...new Map(tasks.map(task => [task.id, task])).values()]
    const metric = (key: 'total_views' | 'total_likes') => {
        const published = unique.filter(task => task.published_count > 0)
        if (!published.length || published.some(task => typeof task[key] !== 'number' || !Number.isFinite(task[key]) || task[key]! < 0)) return null
        return published.reduce((total, task) => total + task[key]!, 0)
    }
    return {
        published: unique.reduce((total, task) => total + task.published_count, 0),
        views: metric('total_views'),
        likes: metric('total_likes'),
    }
}

export function TaskOverview({ tasks, loading }: { tasks: TaskGroup[]; loading: boolean }) {
    const { isEnglish, locale } = useTikTokLanguage()
    const summary = summarizeTaskOverview(tasks)
    const metricsEnabled = isTikTokVideoListUiEnabled()
    const items = [
        { label: isEnglish ? 'Published' : '发布成功', value: summary.published },
        { label: isEnglish ? 'Views' : '播放量', value: metricsEnabled ? summary.views : null },
        { label: isEnglish ? 'Likes' : '点赞数', value: metricsEnabled ? summary.likes : null },
    ]
    return (
        <section aria-label={isEnglish ? 'Task overview' : '任务总览'} className="rounded-xl border border-white/5 bg-zinc-900/40 p-3">
            <p className="mb-2 text-[11px] text-zinc-500">
                {isEnglish ? 'Overview · currently loaded, filtered tasks' : '总览 · 当前筛选下已加载的任务'}
            </p>
            <div className="grid grid-cols-3 divide-x divide-white/5">
                {items.map(item => (
                    <div key={item.label} className="px-3 first:pl-0">
                        <p className="text-xl font-semibold text-white">{loading || item.value === null ? '—' : item.value.toLocaleString(locale)}</p>
                        <p className="text-xs text-zinc-500">{item.label}</p>
                    </div>
                ))}
            </div>
        </section>
    )
}
