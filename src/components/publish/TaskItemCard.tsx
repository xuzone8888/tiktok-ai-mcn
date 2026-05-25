'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Clock, CheckCircle, XCircle, AlertTriangle, Trash2, Loader2, Play, Heart, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export interface TaskItem {
    id: string
    task_id: string
    account_id: string
    video_url: string
    title: string
    scheduled_at: string | null
    status: 'pending' | 'scheduled' | 'processing' | 'uploading' | 'published' | 'failed' | 'cancelled'
    published_at: string | null
    tiktok_share_id: string | null
    tiktok_video_id?: string | null
    tiktok_publish_id?: string | null
    error_code?: string | null
    error_message: string | null
    cover_timestamp_ms?: number
    plan_sequence?: number | null
    plan_round?: number | null
    plan_account_position?: number | null
    source_video_name?: string | null
    // Video statistics from TikTok
    view_count?: number
    like_count?: number
    comment_count?: number
    share_count?: number
    stats_updated_at?: string | null
    tiktok_accounts?: {
        id: string
        display_name: string
        avatar_url: string | null
    }
}

interface TaskItemCardProps {
    item: TaskItem
    onDelete: (itemId: string, isPublished: boolean) => void
    onViewDetail?: (item: TaskItem) => void
}

const statusConfig: Record<string, { label: string; className: string; icon: any }> = {
    pending: { label: '待发布', className: 'text-zinc-400 border-zinc-500/30 bg-zinc-500/10', icon: Clock },
    scheduled: { label: '待发', className: 'text-blue-400 border-blue-500/30 bg-blue-500/10', icon: Clock },
    processing: { label: '执行中', className: 'text-amber-400 border-amber-500/30 bg-amber-500/10', icon: Loader2 },
    uploading: { label: '结果确认中', className: 'text-violet-300 border-violet-400/30 bg-violet-400/10', icon: Loader2 },
    published: { label: '已发布', className: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10', icon: CheckCircle },
    failed: { label: '失败', className: 'text-rose-400 border-rose-500/30 bg-rose-500/10', icon: XCircle },
    review: { label: '需确认', className: 'text-orange-300 border-orange-400/30 bg-orange-400/10', icon: AlertTriangle },
    cancelled: { label: '已取消', className: 'text-zinc-500 border-zinc-500/30 bg-zinc-500/10', icon: XCircle },
}
const REVIEW_ERROR_CODE = 'WORKER_INTERRUPTED_NEEDS_REVIEW'

export function TaskItemCard({ item, onDelete, onViewDetail }: TaskItemCardProps) {
    const [deleting, setDeleting] = useState(false)
    const isReview = item.status === 'failed' && item.error_code === REVIEW_ERROR_CODE
    const config = isReview ? statusConfig.review : (statusConfig[item.status] || statusConfig.pending)
    const StatusIcon = config.icon
    const isProcessing = ['processing', 'uploading'].includes(item.status)
    const isPublished = item.status === 'published'
    const displayTitle = item.title || '无标题'

    const formatDate = (dateStr: string | null) => {
        if (!dateStr) return '-'
        const date = new Date(dateStr)
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    // 格式化数字: 12500 -> 12.5K
    const formatNumber = (num: number): string => {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(1) + 'M'
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'K'
        }
        return num.toString()
    }

    const handleDelete = async (e: React.MouseEvent) => {
        e.stopPropagation()
        if (isProcessing) return
        setDeleting(true)
        try {
            await onDelete(item.id, isPublished)
        } finally {
            setDeleting(false)
        }
    }

    // 简单的策略：使用 Image 显示占位，或 Video 显示预览
    const hasVideo = !!item.video_url
    const errorText = isReview
        ? '系统无法确认 TikTok 是否已接收，请检查账号后处理'
        : item.error_message
    const errorTitle = [
        item.error_code ? `代码：${item.error_code}` : null,
        errorText,
    ].filter(Boolean).join('\n')
    let statusNote: JSX.Element | null = null
    if (item.status === 'failed' && errorText) {
        statusNote = (
            <span
                className="flex max-w-[220px] flex-col items-end gap-0.5 leading-tight"
                title={errorTitle}
            >
                <span
                    className={cn(
                        'max-w-full truncate text-[10px]',
                        isReview ? 'text-orange-300' : 'text-rose-500'
                    )}
                >
                    {errorText}
                </span>
                {item.error_code && (
                    <span
                        className={cn(
                            'max-w-full truncate text-[9px] font-mono',
                            isReview ? 'text-orange-400/70' : 'text-rose-400/70'
                        )}
                    >
                        {item.error_code}
                    </span>
                )}
            </span>
        )
    } else if (item.status === 'uploading' && item.error_message) {
        statusNote = (
            <span className="flex max-w-[220px] flex-col items-end gap-0.5 leading-tight" title={errorTitle}>
                <span className="max-w-full truncate text-[10px] text-violet-300">
                    {item.error_message}
                </span>
                {item.error_code && (
                    <span className="max-w-full truncate text-[9px] font-mono text-violet-300/70">
                        {item.error_code}
                    </span>
                )}
            </span>
        )
    }

    return (
        <div
            className="group relative overflow-hidden rounded-lg border border-white/5 bg-zinc-900/30 p-3 transition-all hover:bg-zinc-900/50 hover:border-white/10"
            onClick={() => onViewDetail?.(item)}
        >
            <div className="flex gap-3">
                {/* 封面缩略图 */}
                <div className="relative w-24 h-16 flex-shrink-0 rounded-md overflow-hidden bg-zinc-800 border border-white/5">
                    {hasVideo ? (
                        <video
                            src={item.video_url}
                            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                            preload="metadata"
                            muted
                            playsInline
                        />
                    ) : (
                        <Image
                            src="/placeholder-video.png"
                            alt="视频封面"
                            fill
                            className="object-cover opacity-80 group-hover:opacity-100 transition-opacity"
                            unoptimized
                        />
                    )}
                    {/* 状态遮罩 */}
                    {isProcessing && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-[1px]">
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                        </div>
                    )}
                </div>

                {/* 内容区 */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                            {/* 标题 - 支持最多1行截断，Hover时Tooltip显示完整标题 */}
                            <h4
                                className="text-sm font-medium text-zinc-200 line-clamp-1 group-hover:text-white transition-colors pr-2"
                                title={displayTitle}
                            >
                                {displayTitle}
                            </h4>
                            {item.source_video_name && (
                                <div className="mt-0.5 truncate text-[10px] text-zinc-600" title={item.source_video_name}>
                                    {item.source_video_name}
                                </div>
                            )}

                            {/* 账号 */}
                            <div className="flex items-center gap-1.5 mt-1 min-w-0">
                                {item.tiktok_accounts?.avatar_url && (
                                    <Image
                                        src={item.tiktok_accounts.avatar_url}
                                        alt=""
                                        width={16}
                                        height={16}
                                        className="rounded-full border border-white/10"
                                        unoptimized
                                    />
                                )}
                                <span className="text-xs text-zinc-500 truncate">
                                    {item.tiktok_accounts?.display_name || '未知账号'}
                                </span>
                                {typeof item.plan_round === 'number' && (
                                    <span className="shrink-0 text-[10px] text-zinc-600">
                                        第 {item.plan_round + 1} 轮
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* 状态Badge */}
                        <Badge
                            variant="outline"
                            className={cn('text-[10px] px-1.5 py-0 h-5 font-normal whitespace-nowrap', config.className)}
                        >
                            <StatusIcon className={cn(
                                "w-2.5 h-2.5 mr-1",
                                isProcessing && "animate-spin"
                            )} />
                            {config.label}
                        </Badge>
                    </div>

                    {/* 底部信息行，包含时间和统计 */}
                    <div className="flex items-center justify-between mt-auto pt-2 relative">
                        <div className="flex flex-col gap-1.5 w-full pr-8">
                            {/* 统计数据 - 只要发布就显示，否则显示状态文本 */}
                            {isPublished ? (
                                <div className="flex items-center justify-between w-full pr-1">
                                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                                        <span className="flex items-center gap-1 text-zinc-400 group-hover:text-zinc-300">
                                            <Play className="w-3 h-3" />
                                            {formatNumber(item.view_count || 0)}
                                        </span>
                                        <span className="flex items-center gap-1 text-zinc-400 hover:text-rose-400">
                                            <Heart className="w-3 h-3" />
                                            {formatNumber(item.like_count || 0)}
                                        </span>
                                        <span className="flex items-center gap-1 text-zinc-400 hover:text-blue-400">
                                            <MessageCircle className="w-3 h-3" />
                                            {formatNumber(item.comment_count || 0)}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-zinc-600">
                                        {formatDate(item.published_at)}
                                    </span>
                                </div>
                            ) : (
                                <span className="text-xs text-zinc-600">
                                    计划 {formatDate(item.scheduled_at)}
                                </span>
                            )}
                        </div>

                        {/* 操作区 (仅Hover显示或错误时显示) - 绝对定位到右下角或者保留在流中 */}
                        <div className="absolute bottom-3 right-3 flex items-center">
                            {/* 错误信息优先显示 */}
                            {statusNote || (
                                /* 删除按钮 */
                                !isProcessing && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleDelete}
                                        disabled={deleting}
                                        className="h-6 w-6 text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all duration-200"
                                        title="移除任务项"
                                    >
                                        {deleting ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-3.5 h-3.5" />
                                        )}
                                    </Button>
                                )
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
