'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Clock, CheckCircle, XCircle, AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
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
    error_message: string | null
    cover_timestamp_ms?: number
    tiktok_accounts?: {
        id: string
        display_name: string
        avatar_url: string | null
    }
}

interface TaskItemCardProps {
    item: TaskItem
    onDelete: (itemId: string, isPublished: boolean) => void
    onViewDetail: (item: TaskItem) => void
}

const statusConfig = {
    pending: { label: '待发布', color: 'bg-gray-500', icon: Clock },
    scheduled: { label: '定时中', color: 'bg-blue-500', icon: Clock },
    processing: { label: '处理中', color: 'bg-yellow-500', icon: Loader2 },
    uploading: { label: '上传中', color: 'bg-yellow-500', icon: Loader2 },
    published: { label: '已发布', color: 'bg-green-500', icon: CheckCircle },
    failed: { label: '失败', color: 'bg-red-500', icon: XCircle },
    cancelled: { label: '已取消', color: 'bg-gray-400', icon: XCircle },
}

export function TaskItemCard({ item, onDelete, onViewDetail }: TaskItemCardProps) {
    const [deleting, setDeleting] = useState(false)
    const config = statusConfig[item.status] || statusConfig.pending
    const StatusIcon = config.icon
    const isProcessing = ['processing', 'uploading'].includes(item.status)
    const isPublished = item.status === 'published'

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

    // 从视频 URL 生成封面（使用时间戳参数）
    const getCoverUrl = () => {
        // 如果有 OSS URL，尝试生成截图（实际需要视频处理服务）
        // 暂时使用占位图
        return '/placeholder-video.png'
    }

    return (
        <Card
            className="hover:shadow-md transition-shadow cursor-pointer group overflow-hidden"
            onClick={() => onViewDetail(item)}
        >
            <CardContent className="p-3">
                <div className="flex gap-3">
                    {/* 封面缩略图 */}
                    <div className="relative w-24 h-16 flex-shrink-0 rounded overflow-hidden bg-gray-100">
                        <Image
                            src={getCoverUrl()}
                            alt="视频封面"
                            fill
                            className="object-cover"
                            unoptimized
                        />
                        {/* 状态遮罩 */}
                        {isProcessing && (
                            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                <Loader2 className="w-5 h-5 text-white animate-spin" />
                            </div>
                        )}
                    </div>

                    {/* 内容区 */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                {/* 标题 */}
                                <h4 className="text-sm font-medium text-gray-900 truncate">
                                    {item.title || '无标题'}
                                </h4>

                                {/* 账号 */}
                                <div className="flex items-center gap-1 mt-1">
                                    {item.tiktok_accounts?.avatar_url && (
                                        <Image
                                            src={item.tiktok_accounts.avatar_url}
                                            alt=""
                                            width={16}
                                            height={16}
                                            className="rounded-full"
                                        />
                                    )}
                                    <span className="text-xs text-gray-500 truncate">
                                        {item.tiktok_accounts?.display_name || '未知账号'}
                                    </span>
                                </div>

                                {/* 时间 */}
                                <div className="text-xs text-gray-400 mt-1">
                                    {isPublished
                                        ? `发布于 ${formatDate(item.published_at)}`
                                        : `计划 ${formatDate(item.scheduled_at)}`
                                    }
                                </div>
                            </div>

                            {/* 状态和操作 */}
                            <div className="flex flex-col items-end gap-2">
                                <Badge
                                    variant="secondary"
                                    className={cn('text-white text-xs', config.color)}
                                >
                                    <StatusIcon className={cn(
                                        "w-3 h-3 mr-1",
                                        isProcessing && "animate-spin"
                                    )} />
                                    {config.label}
                                </Badge>

                                {/* 删除按钮 - 非执行中状态可见 */}
                                {!isProcessing && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={handleDelete}
                                        disabled={deleting}
                                        className="h-6 px-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                        {deleting ? (
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Trash2 className="w-3.5 h-3.5" />
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>

                        {/* 错误信息 */}
                        {item.status === 'failed' && item.error_message && (
                            <div className="mt-1 text-xs text-red-500 truncate">
                                {item.error_message}
                            </div>
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
