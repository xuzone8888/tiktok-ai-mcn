'use client'

import { useState } from 'react'
import { Clock, CheckCircle, XCircle, AlertTriangle, ChevronRight, Square, Play, Heart, Trash2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface TaskGroup {
    id: string
    name: string
    workflow?: string | null
    source_account_group_id?: string | null
    account_group_name?: string | null
    status: 'pending' | 'running' | 'completed' | 'failed' | 'scheduled' | 'partial_failed' | 'cancelled'
    display_status?: string | null
    total_items: number
    published_count: number
    pending_count: number
    failed_count: number
    active_count?: number
    confirming_count?: number
    review_count?: number
    cancelled_count?: number
    created_at: string
    scheduled_at: string | null
    next_scheduled_at?: string | null
    last_scheduled_at?: string | null
    // View metrics (optional)
    total_views?: number
    total_likes?: number
}

interface TaskGroupCardProps {
    task: TaskGroup
    onViewDetail: (taskId: string) => void
    onCancelPending: (taskId: string) => void
    onDelete?: (task: TaskGroup) => void
}

const statusConfig: Record<string, { label: string; className: string; icon: any }> = {
    pending: { label: '待处理', className: 'text-zinc-400 border-zinc-500/30 bg-zinc-500/10', icon: Clock },
    scheduled: { label: '定时中', className: 'text-blue-400 border-blue-500/30 bg-blue-500/10', icon: Clock },
    running: { label: '执行中', className: 'text-amber-400 border-amber-500/30 bg-amber-500/10', icon: Clock },
    confirming: { label: '结果确认中', className: 'text-violet-300 border-violet-400/30 bg-violet-400/10', icon: Clock },
    needs_review: { label: '需确认', className: 'text-orange-300 border-orange-400/30 bg-orange-400/10', icon: AlertTriangle },
    completed: { label: '已完成', className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', icon: CheckCircle },
    failed: { label: '失败', className: 'text-rose-400 border-rose-500/30 bg-rose-500/10', icon: XCircle },
    partial_failed: { label: '部分失败', className: 'text-orange-400 border-orange-500/30 bg-orange-500/10', icon: AlertTriangle },
    cancelled: { label: '已取消', className: 'text-zinc-500 border-zinc-500/30 bg-zinc-500/10', icon: Square },
}

export function TaskGroupCard({ task, onViewDetail, onCancelPending, onDelete }: TaskGroupCardProps) {
    const [cancelling, setCancelling] = useState(false)
    const isMultiTask = task.workflow === 'multi_task'
    const displayStatus = isMultiTask && task.display_status ? task.display_status : task.status
    const config = statusConfig[displayStatus] || statusConfig[task.status] || statusConfig.pending
    const StatusIcon = config.icon

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr)
        const now = new Date()
        const isToday = date.toDateString() === now.toDateString()
        const tomorrow = new Date(now)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const isTomorrow = tomorrow.toDateString() === date.toDateString()

        const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

        if (isToday) return `今天 ${timeStr}`
        if (isTomorrow) return `明天 ${timeStr}`
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    const handleCancelPending = async () => {
        if (task.pending_count === 0) return
        setCancelling(true)
        try {
            await onCancelPending(task.id)
        } finally {
            setCancelling(false)
        }
    }

    const canCancel = ['pending', 'scheduled', 'running'].includes(task.status) && task.pending_count > 0

    // Calculate progress for subtle background indicator if needed, or visual bar
    const progress = task.total_items > 0
        ? Math.round(((task.published_count + task.failed_count) / task.total_items) * 100)
        : 0
    const multiProgress = task.total_items > 0
        ? Math.round((task.published_count / task.total_items) * 100)
        : 0

    const exceptionStats = [
        { label: '执行中', value: task.active_count || 0, className: 'text-amber-300 bg-amber-500/10 border-amber-500/20' },
        { label: '结果确认中', value: task.confirming_count || 0, className: 'text-violet-300 bg-violet-500/10 border-violet-500/20' },
        { label: '失败', value: task.failed_count || 0, className: 'text-rose-300 bg-rose-500/10 border-rose-500/20' },
        { label: '需确认', value: task.review_count || 0, className: 'text-orange-300 bg-orange-500/10 border-orange-500/20' },
    ].filter(stat => stat.value > 0)
    let footerTimeLabel = '创建'
    let footerTime = task.created_at
    if (isMultiTask && task.next_scheduled_at) {
        footerTimeLabel = '下一条'
        footerTime = task.next_scheduled_at
    } else if (task.scheduled_at) {
        footerTimeLabel = '计划'
        footerTime = task.scheduled_at
    }

    return (
        <div
            className="group relative overflow-hidden rounded-xl border border-white/5 bg-zinc-900/40 p-5 transition-all hover:border-white/10 hover:bg-zinc-900/60 hover:shadow-2xl hover:shadow-black/50 cursor-pointer backdrop-blur-sm"
            onClick={() => onViewDetail(task.id)}
        >
            {/* Header Section */}
            <div className="flex items-start justify-between mb-4">
                <div className="flex flex-col gap-1 min-w-0">
                    <h3 className="font-medium text-zinc-100 text-base flex items-center gap-2 min-w-0">
                        <span className="truncate" title={task.name}>{task.name || '未命名任务组'}</span>
                        {task.workflow === 'multi_task' && (
                            <span className="shrink-0 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-normal text-cyan-300">
                                多任务
                            </span>
                        )}
                    </h3>

                </div>
                <Badge variant="outline" className={cn('text-xs px-2 py-0.5 h-6 font-normal', config.className)}>
                    <StatusIcon className="w-3 h-3 mr-1.5" />
                    {config.label}
                </Badge>
            </div>

            {isMultiTask && task.account_group_name && (
                <div className="-mt-2 mb-3 text-xs text-zinc-500 truncate">
                    账号组：{task.account_group_name}
                </div>
            )}

            {/* Metrics Grid */}
            {isMultiTask ? (
                <div className="mb-4 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="flex flex-col">
                            <span className="text-2xl font-bold text-white tracking-tight">{task.total_items}</span>
                            <span className="text-xs text-zinc-500">总数</span>
                        </div>
                        <div className="flex flex-col pl-3 border-l border-white/5">
                            <span className="text-2xl font-bold text-emerald-300 tracking-tight">{task.published_count}</span>
                            <span className="text-xs text-zinc-500">已发布</span>
                        </div>
                        <div className="flex flex-col pl-3 border-l border-white/5">
                            <span className="text-2xl font-bold text-blue-300 tracking-tight">{task.pending_count}</span>
                            <span className="text-xs text-zinc-500">待发</span>
                        </div>
                    </div>
                    {exceptionStats.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {exceptionStats.map(stat => (
                                <span
                                    key={stat.label}
                                    className={cn('rounded-full border px-2 py-0.5 text-[11px]', stat.className)}
                                >
                                    {stat.label} {stat.value}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="flex flex-col">
                        <span className="text-2xl font-bold text-white tracking-tight">{task.published_count}</span>
                        <span className="text-xs text-zinc-500">发布成功</span>
                    </div>
                    <div className="flex flex-col pl-3 border-l border-white/5">
                        <span className="text-2xl font-bold text-white tracking-tight">
                            {task.status === 'completed' || task.status === 'partial_failed' ? (task.total_views || '-') : '-'}
                        </span>
                        <span className="text-xs text-zinc-500 flex items-center gap-1">
                            播放量 <Play className="w-2.5 h-2.5" />
                        </span>
                    </div>
                    <div className="flex flex-col pl-3 border-l border-white/5">
                        <span className="text-2xl font-bold text-white tracking-tight">
                            {task.status === 'completed' || task.status === 'partial_failed' ? (task.total_likes || '-') : '-'}
                        </span>
                        <span className="text-xs text-zinc-500 flex items-center gap-1">
                            点赞数 <Heart className="w-2.5 h-2.5" />
                        </span>
                    </div>
                </div>
            )}

            {/* Footer / Meta */}
            <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
                <div className="text-xs text-zinc-600">
                    <span>{footerTimeLabel}: {formatDate(footerTime)}</span>
                    {isMultiTask && task.last_scheduled_at && (
                        <span className="block mt-1 text-zinc-500">预计完成: {formatDate(task.last_scheduled_at)}</span>
                    )}
                    {['running', 'completed'].includes(task.status) && (
                        <span className="flex items-center gap-1 mt-1 text-blue-400/50">
                            <Info className="w-3 h-3" />
                            发布后可能需要几分钟才能在 TikTok 显示
                        </span>
                    )}
                </div>

                {/* Actions that appear on hover */}
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0 duration-200">
                    {canCancel && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                                e.stopPropagation()
                                handleCancelPending()
                            }}
                            disabled={cancelling}
                            className="h-7 w-7 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                            title="停止待发"
                        >
                            <Square className="w-3.5 h-3.5" />
                        </Button>
                    )}
                    {onDelete && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                                e.stopPropagation()
                                onDelete(task)
                            }}
                            className="h-7 w-7 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10"
                            title="删除记录"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                    )}
                    <div className="w-px h-3 bg-white/10 mx-1"></div>
                    <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-zinc-300" />
                </div>
            </div>

            {/* Subtle Progress Line at very bottom */}
            {(isMultiTask ? multiProgress : progress) > 0 && (isMultiTask ? multiProgress : progress) < 100 && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-800">
                    <div
                        className="h-full bg-gradient-to-r from-[#CCFF00]/60 to-emerald-500/60 rounded-full"
                        style={{ width: `${isMultiTask ? multiProgress : progress}%` }}
                    />
                </div>
            )}
        </div>
    )
}
