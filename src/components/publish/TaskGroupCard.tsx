'use client'

import { useState } from 'react'
import { Clock, CheckCircle, XCircle, AlertTriangle, ChevronRight, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface TaskGroup {
    id: string
    name: string
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'scheduled' | 'partial_failed' | 'cancelled'
    total_items: number
    published_count: number
    pending_count: number
    failed_count: number
    created_at: string
    scheduled_at: string | null
}

interface TaskGroupCardProps {
    task: TaskGroup
    onViewDetail: (taskId: string) => void
    onCancelPending: (taskId: string) => void
}

const statusConfig = {
    pending: { label: '待处理', color: 'bg-gray-500', icon: Clock },
    scheduled: { label: '定时中', color: 'bg-blue-500', icon: Clock },
    processing: { label: '执行中', color: 'bg-yellow-500', icon: Clock },
    completed: { label: '已完成', color: 'bg-green-500', icon: CheckCircle },
    failed: { label: '失败', color: 'bg-red-500', icon: XCircle },
    partial_failed: { label: '部分失败', color: 'bg-orange-500', icon: AlertTriangle },
    cancelled: { label: '已取消', color: 'bg-gray-400', icon: Square },
}

export function TaskGroupCard({ task, onViewDetail, onCancelPending }: TaskGroupCardProps) {
    const [cancelling, setCancelling] = useState(false)
    const config = statusConfig[task.status] || statusConfig.pending
    const StatusIcon = config.icon

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr)
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

    const canCancel = ['pending', 'scheduled', 'processing'].includes(task.status) && task.pending_count > 0

    return (
        <Card className="hover:shadow-md transition-shadow cursor-pointer group">
            <CardContent className="p-4">
                <div className="flex items-center justify-between">
                    {/* 左侧：名称和状态 */}
                    <div className="flex-1 min-w-0" onClick={() => onViewDetail(task.id)}>
                        <div className="flex items-center gap-2 mb-2">
                            <h3 className="font-medium text-gray-900 truncate">
                                {task.name || '未命名任务组'}
                            </h3>
                            <Badge variant="secondary" className={cn('text-white text-xs', config.color)}>
                                <StatusIcon className="w-3 h-3 mr-1" />
                                {config.label}
                            </Badge>
                        </div>

                        {/* 统计徽章 */}
                        <div className="flex items-center gap-3 text-sm">
                            <span className="text-green-600 flex items-center gap-1">
                                <CheckCircle className="w-3.5 h-3.5" />
                                {task.published_count} 已发
                            </span>
                            <span className="text-blue-600 flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5" />
                                {task.pending_count} 待发
                            </span>
                            {task.failed_count > 0 && (
                                <span className="text-red-600 flex items-center gap-1">
                                    <XCircle className="w-3.5 h-3.5" />
                                    {task.failed_count} 失败
                                </span>
                            )}
                        </div>

                        {/* 时间信息 */}
                        <div className="mt-2 text-xs text-gray-500">
                            创建于 {formatDate(task.created_at)}
                            {task.scheduled_at && (
                                <span className="ml-2">
                                    · 计划 {formatDate(task.scheduled_at)}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* 右侧：操作按钮 */}
                    <div className="flex items-center gap-2 ml-4">
                        {canCancel && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    handleCancelPending()
                                }}
                                disabled={cancelling}
                                className="text-red-600 border-red-200 hover:bg-red-50"
                            >
                                {cancelling ? '停止中...' : '停止待发'}
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onViewDetail(task.id)}
                        >
                            查看详情
                            <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}
