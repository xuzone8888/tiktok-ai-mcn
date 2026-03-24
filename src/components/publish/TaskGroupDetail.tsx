'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Loader2, Square, Trash2, RefreshCw, Play, Heart, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { cn } from '@/lib/utils'
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
    // Delete confirmation state
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const [itemToDelete, setItemToDelete] = useState<{ id: string, isPublished: boolean } | null>(null)
    const [syncDeleteTikTok, setSyncDeleteTikTok] = useState(false)
    const [isDeleting, setIsDeleting] = useState(false)

    // Cancel all confirmation
    const [cancelAllConfirmOpen, setCancelAllConfirmOpen] = useState(false)

    // Stats sync state
    const [syncing, setSyncing] = useState(false)
    const [syncResult, setSyncResult] = useState<{ views: number; likes: number } | null>(null)

    // ... existing fetch logic ...
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
        if (open && task) { setPage(1); fetchItems(); }
    }, [open, task, fetchItems])

    useEffect(() => {
        if (open && task) { fetchItems(); }
    }, [page, statusFilter, fetchItems, open, task])

    // --- Action Handlers ---

    const handleDeleteClick = (itemId: string, isPublished: boolean) => {
        setItemToDelete({ id: itemId, isPublished })
        // Default to checking "Sync Delete" if published, for convenience
        setSyncDeleteTikTok(isPublished)
        setDeleteConfirmOpen(true)
    }

    const handleConfirmDelete = async () => {
        if (!itemToDelete) return
        setIsDeleting(true)
        try {
            await onDeleteItem(itemToDelete.id, syncDeleteTikTok && itemToDelete.isPublished)
            setDeleteConfirmOpen(false)
            fetchItems()
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
        if (!task || syncing) return
        setSyncing(true)
        setSyncResult(null)
        try {
            const res = await fetch(`/api/publish/tasks/${task.id}/sync-stats`, {
                method: 'POST'
            })
            const data = await res.json()
            if (res.ok && data.success) {
                setSyncResult({
                    views: data.total_views || 0,
                    likes: data.total_likes || 0
                })
                // Refresh items to show updated stats
                fetchItems()
            }
        } catch (error) {
            console.error('Failed to sync stats:', error)
        } finally {
            setSyncing(false)
        }
    }

    if (!task) return null

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
                        <div className="grid grid-cols-4 gap-4 p-4 rounded-lg bg-zinc-900/50 border border-white/5">
                            <div className="flex flex-col items-center justify-center border-r border-white/5 pr-4">
                                <span className="text-xs text-zinc-500 uppercase tracking-wider font-medium">总数</span>
                                <span className="text-2xl font-bold text-white mt-1">{task.total_items}</span>
                            </div>
                            <div className="flex flex-col items-center justify-center border-r border-white/5 pr-4">
                                <span className="text-xs text-zinc-500 uppercase tracking-wider font-medium">成功</span>
                                <span className="text-2xl font-bold text-emerald-500 mt-1">{task.published_count}</span>
                            </div>
                            <div className="flex flex-col items-center justify-center border-r border-white/5 pr-4">
                                <span className="text-xs text-zinc-500 uppercase tracking-wider font-medium">待发</span>
                                <span className="text-2xl font-bold text-blue-500 mt-1">{task.pending_count}</span>
                            </div>
                            <div className="flex flex-col items-center justify-center">
                                <span className="text-xs text-zinc-500 uppercase tracking-wider font-medium">失败</span>
                                <span className={`text-2xl font-bold mt-1 ${task.failed_count > 0 ? 'text-rose-500' : 'text-zinc-700'}`}>
                                    {task.failed_count}
                                </span>
                            </div>
                        </div>
                    </SheetHeader>

                    {/* Dark Toolbar */}
                    <div className="px-6 py-3 border-b border-white/10 bg-zinc-900/30 flex items-center justify-between flex-shrink-0">
                        <div className="flex items-center gap-3">
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-[120px] h-8 bg-zinc-900 border-white/10 text-zinc-300 text-xs focus:ring-zinc-700">
                                    <SelectValue placeholder="全部状态" />
                                </SelectTrigger>
                                <SelectContent className="bg-zinc-900 border-white/10 text-zinc-300">
                                    <SelectItem value="all">全部状态</SelectItem>
                                    <SelectItem value="pending">待发布</SelectItem>
                                    <SelectItem value="published">已发布</SelectItem>
                                    <SelectItem value="failed">失败</SelectItem>
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

                    {/* Dark List */}
                    <div className="flex-1 overflow-y-auto p-6 bg-zinc-950 scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
                        {loading ? (
                            <div className="flex flex-col items-center justify-center py-20">
                                <Loader2 className="w-8 h-8 animate-spin text-zinc-700 mb-4" />
                                <p className="text-zinc-600 text-sm">加载任务数据...</p>
                            </div>
                        ) : items.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
                                <div className="p-4 bg-white/5 rounded-full mb-4">
                                    <Square className="w-8 h-8 text-zinc-700" />
                                </div>
                                <p className="text-zinc-500 font-medium text-sm">没有找到相关任务项</p>
                            </div>
                        ) : (
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
                            {itemToDelete?.isPublished && (
                                <div className="mt-4 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                                    <div className="flex items-center space-x-2">
                                        <Switch
                                            id="sync-delete"
                                            checked={syncDeleteTikTok}
                                            onCheckedChange={setSyncDeleteTikTok}
                                            className="data-[state=checked]:bg-amber-500"
                                        />
                                        <Label htmlFor="sync-delete" className="text-sm font-medium text-amber-500 cursor-pointer">
                                            同时从 TikTok 删除视频 (不可恢复)
                                        </Label>
                                    </div>
                                    <p className="text-xs text-amber-500/70 mt-2 ml-10">
                                        开启后，我们将尝试调用 TikTok API 删除线上视频。
                                    </p>
                                </div>
                            )}
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
                            className={cn(syncDeleteTikTok ? "bg-red-600 hover:bg-red-700" : "bg-white text-black hover:bg-zinc-200")}
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    删除中...
                                </>
                            ) : (
                                <>
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    {syncDeleteTikTok ? '确认并不留痕迹' : '确认删除'}
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
