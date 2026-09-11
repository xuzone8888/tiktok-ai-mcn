'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Square, Trash2, RefreshCw, Play, Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { TaskItemCard, TaskItem } from './TaskItemCard'
import { TaskGroup } from './TaskGroupCard'

interface TaskGroupDetailProps {
    task: TaskGroup | null
    open: boolean
    onClose: () => void
    onDeleteItem: (itemId: string) => Promise<boolean>
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
    // Delete confirmation state
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const [itemToDelete, setItemToDelete] = useState<{ id: string, isPublished: boolean } | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    // Cancel all confirmation
    const [cancelAllConfirmOpen, setCancelAllConfirmOpen] = useState(false)

    // Stats sync state
    const [syncing, setSyncing] = useState(false)
    const [syncResult, setSyncResult] = useState<{ views: number; likes: number } | null>(null)
    const [syncError, setSyncError] = useState('')
    const [syncWarning, setSyncWarning] = useState('')
    const [itemsError, setItemsError] = useState('')
    const itemsRequestRef = useRef(0)
    const itemsAbortRef = useRef<AbortController | null>(null)
    const syncRequestRef = useRef(0)
    const syncAbortRef = useRef<AbortController | null>(null)
    const taskId = task?.id || ''

    // ... existing fetch logic ...
    const fetchItems = useCallback(async () => {
        if (!taskId) return
        const requestId = itemsRequestRef.current + 1
        itemsRequestRef.current = requestId
        itemsAbortRef.current?.abort()
        const controller = new AbortController()
        itemsAbortRef.current = controller
        setLoading(true)
        setItemsError('')
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: '20',
                status: statusFilter
            })
            const res = await fetch(`/api/publish/tasks/${taskId}/items?${params}`, {
                signal: controller.signal,
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || '获取任务项失败')
            if (itemsRequestRef.current !== requestId) return
            setItems(data.items || [])
            setTotalPages(data.pagination?.totalPages || 1)
        } catch (error) {
            if (itemsRequestRef.current !== requestId) return
            if (error instanceof DOMException && error.name === 'AbortError') return
            setItemsError(error instanceof Error ? error.message : '获取任务项失败')
        } finally {
            if (itemsRequestRef.current === requestId) setLoading(false)
        }
    }, [taskId, page, statusFilter])

    useEffect(() => {
        if (open && taskId) {
            syncRequestRef.current += 1
            syncAbortRef.current?.abort()
            setSyncing(false)
            setPage(1)
            setSyncResult(null)
            setSyncError('')
            setSyncWarning('')
        }
        if (!open) {
            syncRequestRef.current += 1
            syncAbortRef.current?.abort()
            setSyncing(false)
        }
    }, [open, taskId])

    useEffect(() => {
        if (open && taskId) void fetchItems()
        return () => {
            itemsRequestRef.current += 1
            itemsAbortRef.current?.abort()
        }
    }, [fetchItems, open, taskId])

    // --- Action Handlers ---

    const handleDeleteClick = (itemId: string, isPublished: boolean) => {
        setItemToDelete({ id: itemId, isPublished })
        // Default to checking "Sync Delete" if published, for convenience
        setDeleteConfirmOpen(true)
    }

    const handleConfirmDelete = async () => {
        if (!itemToDelete) return
        setIsDeleting(true)
        try {
            const deleted = await onDeleteItem(itemToDelete.id)
            if (deleted) {
                setDeleteConfirmOpen(false)
                void fetchItems()
            }
        } finally {
            setIsDeleting(false)
            setItemToDelete(null)
        }
    }

    const handleCancelPendingClick = () => {
        setCancelAllConfirmOpen(true)
    }

    const handleConfirmCancelAll = async () => {
        if (!task) return
        setCancelling(true)
        setCancelAllConfirmOpen(false)
        try {
            await onCancelPending(task.id)
            fetchItems()
        } finally {
            setCancelling(false)
        }
    }

    const canCancel = task && ['pending', 'scheduled', 'running'].includes(task.status) && task.pending_count > 0
    const hasPublishedVideos = task && task.published_count > 0

    // 同步TikTok视频统计数据
    const handleSyncStats = async () => {
        if (!taskId || syncing) return
        const requestId = syncRequestRef.current + 1
        syncRequestRef.current = requestId
        syncAbortRef.current?.abort()
        const controller = new AbortController()
        syncAbortRef.current = controller
        setSyncing(true)
        setSyncResult(null)
        setSyncError('')
        setSyncWarning('')
        try {
            const res = await fetch(`/api/publish/tasks/${taskId}/sync-stats`, {
                method: 'POST',
                signal: controller.signal,
            })
            const data = await res.json()
            if (syncRequestRef.current !== requestId) return
            if (!res.ok || !data.success) throw new Error(data.error || '视频数据同步失败')
            setSyncResult({
                views: data.total_views || 0,
                likes: data.total_likes || 0
            })
            if (Array.isArray(data.errors) && data.errors.length > 0) {
                setSyncWarning(data.errors.slice(0, 3).join('；'))
            }
            void fetchItems()
        } catch (error) {
            if (syncRequestRef.current !== requestId) return
            if (error instanceof DOMException && error.name === 'AbortError') return
            setSyncError(error instanceof Error ? error.message : '视频数据同步失败')
        } finally {
            if (syncRequestRef.current === requestId) setSyncing(false)
        }
    }

    if (!task) return null
    const isMultiTask = task.workflow === 'multi_task'
    const detailStats = isMultiTask
        ? [
            { label: '总数', value: task.total_items, className: 'text-white' },
            { label: '已发布', value: task.published_count, className: 'text-emerald-400' },
            { label: '待发', value: task.pending_count, className: 'text-blue-400' },
            { label: '执行中', value: task.active_count || 0, className: 'text-amber-300' },
            { label: '结果确认中', value: task.confirming_count || 0, className: 'text-violet-300' },
            { label: '失败', value: task.failed_count, className: task.failed_count > 0 ? 'text-rose-400' : 'text-zinc-700' },
            { label: '需确认', value: task.review_count || 0, className: (task.review_count || 0) > 0 ? 'text-orange-300' : 'text-zinc-700' },
        ]
        : [
            { label: '总数', value: task.total_items, className: 'text-white' },
            { label: '成功', value: task.published_count, className: 'text-emerald-500' },
            { label: '待发', value: task.pending_count, className: 'text-blue-500' },
            { label: '失败', value: task.failed_count, className: task.failed_count > 0 ? 'text-rose-500' : 'text-zinc-700' },
        ]
    const statusOptions = isMultiTask
        ? [
            { value: 'all', label: '全部状态' },
            { value: 'pending', label: '待发' },
            { value: 'processing', label: '执行中' },
            { value: 'uploading', label: '结果确认中' },
            { value: 'published', label: '已发布' },
            { value: 'failed', label: '失败' },
            { value: 'review', label: '需确认' },
            { value: 'cancelled', label: '已停止' },
        ]
        : [
            { value: 'all', label: '全部状态' },
            { value: 'pending', label: '待发布' },
            { value: 'published', label: '已发布' },
            { value: 'failed', label: '失败' },
        ]

    return (
        <>
            <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
                <SheetContent className="w-full sm:max-w-xl md:max-w-2xl bg-zinc-950 border-l border-white/10 p-0 flex flex-col text-zinc-100">
                    <SheetHeader className="p-6 pb-4 border-b border-white/10 bg-zinc-950 z-10 space-y-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <SheetTitle className="text-xl font-bold text-zinc-100">
                                    {task.name || '未命名任务组'}
                                </SheetTitle>
                                <p className="text-sm text-zinc-500 mt-1 font-mono">
                                    ID: {task.id.slice(0, 8)}...{task.id.slice(-8)}
                                </p>
                            </div>
                            {/* Close button is handled by Sheet primitive but we can add custom if needed */}
                        </div>

                        {/* Dark Stats Grid */}
                        <div className={cn(
                            'grid gap-3 p-4 rounded-lg bg-zinc-900/50 border border-white/5',
                            isMultiTask ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-4'
                        )}>
                            {detailStats.map((stat, index) => (
                                <div
                                    key={stat.label}
                                    className={cn(
                                        'flex flex-col items-center justify-center',
                                        index < detailStats.length - 1 && 'sm:border-r sm:border-white/5 sm:pr-3'
                                    )}
                                >
                                    <span className="text-xs text-zinc-500 uppercase tracking-wider font-medium">{stat.label}</span>
                                    <span className={cn('text-2xl font-bold mt-1', stat.className)}>{stat.value}</span>
                                </div>
                            ))}
                        </div>
                    </SheetHeader>

                    {/* Dark Toolbar */}
                    <div className="px-6 py-3 border-b border-white/10 bg-zinc-900/30 flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <Select value={statusFilter} onValueChange={(value) => {
                                setStatusFilter(value)
                                setPage(1)
                            }}>
                                <SelectTrigger className="w-[120px] h-8 bg-zinc-900 border-white/10 text-zinc-300 text-xs focus:ring-zinc-700">
                                    <SelectValue placeholder="全部状态" />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-white/10 text-zinc-300">
                                    {statusOptions.map(option => (
                                        <SelectItem key={option.value} value={option.value}>
                                            {option.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            {hasPublishedVideos && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleSyncStats}
                                    disabled={syncing}
                                    className="h-8 bg-zinc-900 border-white/10 text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs"
                                >
                                    <RefreshCw className={`w-3 h-3 mr-2 ${syncing ? 'animate-spin' : ''}`} />
                                    {syncing ? '同步中' : '刷新数据'}
                                </Button>
                            )}
                        </div>

                        <div className="flex items-center gap-3">
                            {syncResult && (
                                <div className="flex items-center gap-3 text-xs text-zinc-500 mr-2">
                                    <span className="flex items-center gap-1">
                                        <Play className="w-3 h-3 text-zinc-600" />
                                        {syncResult.views.toLocaleString()}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Heart className="w-3 h-3 text-zinc-600" />
                                        {syncResult.likes.toLocaleString()}
                                    </span>
                                </div>
                            )}

                            {canCancel && (
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    onClick={handleCancelPendingClick}
                                    disabled={cancelling}
                                    className="h-8 text-xs bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border border-rose-500/20"
                                >
                                    {cancelling ? (
                                        <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                                    ) : (
                                        <Square className="w-3 h-3 mr-2" />
                                    )}
                                    停止待发
                                </Button>
                            )}
                        </div>
                    </div>

                    {(syncError || syncWarning) && (
                        <div className={cn(
                            'mx-6 mt-3 rounded-lg border px-3 py-2 text-xs',
                            syncError
                                ? 'border-red-500/20 bg-red-500/10 text-red-200'
                                : 'border-amber-500/20 bg-amber-500/10 text-amber-100'
                        )}>
                            {syncError || syncWarning}
                        </div>
                    )}

                    {/* Dark List */}
                    <div className="flex-1 overflow-y-auto p-6 bg-zinc-950 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                        {itemsError && (
                            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                                {itemsError}
                            </div>
                        )}
                        {!itemsError && loading && (
                            <div className="flex flex-col items-center justify-center py-20">
                                <Loader2 className="w-8 h-8 animate-spin text-zinc-700 mb-4" />
                                <p className="text-zinc-600 text-sm">加载任务数据...</p>
                            </div>
                        )}
                        {!itemsError && !loading && items.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-20 border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
                                <div className="p-4 bg-white/5 rounded-full mb-4">
                                    <Square className="w-8 h-8 text-zinc-700" />
                                </div>
                                <p className="text-zinc-500 font-medium text-sm">没有找到相关任务项</p>
                            </div>
                        )}
                        {!itemsError && !loading && items.length > 0 && (
                            <div className="space-y-3">
                                {items.map(item => (
                                    <TaskItemCard
                                        key={item.id}
                                        item={item}
                                        onDelete={() => handleDeleteClick(item.id, item.status === 'published')}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-4 mt-8 pb-4">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1 || loading}
                                    className="border-white/10 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 h-8 text-xs"
                                >
                                    <ChevronLeft className="w-3 h-3 mr-1" />
                                    上一页
                                </Button>
                                <span className="text-xs font-medium text-zinc-500">
                                    {page} / {totalPages}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                    disabled={page === totalPages || loading}
                                    className="border-white/10 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 h-8 text-xs"
                                >
                                    下一页
                                    <ChevronRight className="w-3 h-3 ml-1" />
                                </Button>
                            </div>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

            {/* Delete Confirmation Dialog - Updated to Dark Theme */}
            <AlertDialog open={deleteConfirmOpen} onOpenChange={(open) => !isDeleting && setDeleteConfirmOpen(open)}>
                <AlertDialogContent className="bg-zinc-950 border-white/10 text-zinc-100">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-zinc-100">确认删除任务项？</AlertDialogTitle>
                        <AlertDialogDescription className="text-zinc-400">
                            此操作将从本地记录中删除该任务。
                            {itemToDelete?.isPublished && '这只会删除本地任务记录，不会删除 TikTok 上的视频。如需删除线上视频，请先在 TikTok App 中手动操作。'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting} className="bg-transparent border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white">取消</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault()
                                handleConfirmDelete()
                            }}
                            disabled={isDeleting}
                            className="bg-white text-black hover:bg-zinc-200"
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    删除中...
                                </>
                            ) : (
                                <>
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    确认删除本地记录
                                </>
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Stop All Confirmation Dialog - Updated to Dark Theme */}
            <AlertDialog open={cancelAllConfirmOpen} onOpenChange={setCancelAllConfirmOpen}>
                <AlertDialogContent className="bg-zinc-950 border-white/10 text-zinc-100">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-zinc-100">停止所有待发布任务？</AlertDialogTitle>
                        <AlertDialogDescription className="text-zinc-400">
                            这将取消当前任务组中所有尚未执行的任务。已发布的视频不受影响。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-transparent border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white">取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConfirmCancelAll} className="bg-red-600 hover:bg-red-700 text-white">
                            确认停止
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
