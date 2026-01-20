'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Loader2, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { TaskItemCard, TaskItem } from './TaskItemCard'
import { TaskGroup } from './TaskGroupCard'

interface TaskGroupDetailProps {
    task: TaskGroup | null
    open: boolean
    onClose: () => void
    onDeleteItem: (itemId: string, deleteTikTokVideo: boolean) => Promise<void>
    onCancelPending: (taskId: string) => Promise<void>
}

export function TaskGroupDetail({
    task,
    open,
    onClose,
    onDeleteItem,
    onCancelPending
}: TaskGroupDetailProps) {
    const [items, setItems] = useState<TaskItem[]>([])
    const [loading, setLoading] = useState(false)
    const [page, setPage] = useState(1)
    const [totalPages, setTotalPages] = useState(1)
    const [statusFilter, setStatusFilter] = useState('all')
    const [cancelling, setCancelling] = useState(false)
    const [selectedItem, setSelectedItem] = useState<TaskItem | null>(null)

    const fetchItems = useCallback(async () => {
        if (!task) return

        setLoading(true)
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: '20',
                status: statusFilter
            })

            const res = await fetch(`/api/publish/tasks/${task.id}/items?${params}`)
            const data = await res.json()

            if (res.ok) {
                setItems(data.items || [])
                setTotalPages(data.pagination?.totalPages || 1)
            }
        } catch (error) {
            console.error('Failed to fetch items:', error)
        } finally {
            setLoading(false)
        }
    }, [task, page, statusFilter])

    useEffect(() => {
        if (open && task) {
            setPage(1)
            fetchItems()
        }
    }, [open, task, fetchItems])

    useEffect(() => {
        if (open && task) {
            fetchItems()
        }
    }, [page, statusFilter, fetchItems, open, task])

    const handleDeleteItem = async (itemId: string, isPublished: boolean) => {
        if (isPublished) {
            // 已发布任务，需要确认是否删除 TikTok 视频
            const confirmed = window.confirm(
                '此任务已发布到 TikTok。\n\n是否同时删除 TikTok 上的视频？\n\n点击"确定"删除视频，点击"取消"仅删除本地记录。'
            )
            await onDeleteItem(itemId, confirmed)
        } else {
            // 未发布任务，直接删除
            const confirmed = window.confirm('确定删除此任务？')
            if (confirmed) {
                await onDeleteItem(itemId, false)
            }
        }
        // 刷新列表
        fetchItems()
    }

    const handleCancelPending = async () => {
        if (!task) return
        const confirmed = window.confirm(`确定停止所有待发布任务？\n\n这将取消 ${task.pending_count} 个待发布任务。`)
        if (!confirmed) return

        setCancelling(true)
        try {
            await onCancelPending(task.id)
            fetchItems()
        } finally {
            setCancelling(false)
        }
    }

    const canCancel = task && ['pending', 'scheduled', 'processing'].includes(task.status) && task.pending_count > 0

    if (!task) return null

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader className="flex-shrink-0">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="text-xl">
                            {task.name || '未命名任务组'}
                        </DialogTitle>
                        <Button variant="ghost" size="sm" onClick={onClose}>
                            <X className="w-4 h-4" />
                        </Button>
                    </div>

                    {/* 统计概览 */}
                    <div className="flex items-center gap-4 mt-2 text-sm">
                        <Badge variant="secondary" className="bg-green-100 text-green-700">
                            已发布 {task.published_count}
                        </Badge>
                        <Badge variant="secondary" className="bg-blue-100 text-blue-700">
                            待发布 {task.pending_count}
                        </Badge>
                        {task.failed_count > 0 && (
                            <Badge variant="secondary" className="bg-red-100 text-red-700">
                                失败 {task.failed_count}
                            </Badge>
                        )}
                        <span className="text-gray-400">
                            共 {task.total_items} 项
                        </span>
                    </div>
                </DialogHeader>

                {/* 筛选和操作栏 */}
                <div className="flex items-center justify-between py-3 border-b flex-shrink-0">
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-32">
                            <SelectValue placeholder="全部状态" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">全部状态</SelectItem>
                            <SelectItem value="pending">待发布</SelectItem>
                            <SelectItem value="published">已发布</SelectItem>
                            <SelectItem value="failed">失败</SelectItem>
                        </SelectContent>
                    </Select>

                    {canCancel && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCancelPending}
                            disabled={cancelling}
                            className="text-red-600 border-red-200 hover:bg-red-50"
                        >
                            {cancelling ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    停止中...
                                </>
                            ) : (
                                <>
                                    <Square className="w-4 h-4 mr-2" />
                                    停止所有待发
                                </>
                            )}
                        </Button>
                    )}
                </div>

                {/* 任务项列表 */}
                <div className="flex-1 overflow-y-auto py-4 space-y-3">
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                        </div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            暂无任务项
                        </div>
                    ) : (
                        items.map(item => (
                            <TaskItemCard
                                key={item.id}
                                item={item}
                                onDelete={handleDeleteItem}
                                onViewDetail={setSelectedItem}
                            />
                        ))
                    )}
                </div>

                {/* 分页 */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-4 pt-4 border-t flex-shrink-0">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                            disabled={page === 1 || loading}
                        >
                            <ChevronLeft className="w-4 h-4" />
                            上一页
                        </Button>
                        <span className="text-sm text-gray-500">
                            {page} / {totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages || loading}
                        >
                            下一页
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
