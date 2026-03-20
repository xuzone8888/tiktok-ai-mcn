'use client'

// Shop Task Manager — 橱窗发布任务管理
// Pattern: follows existing publish/TaskManager.tsx
// Data source: GET /api/shop-publish/tasks, DELETE /api/shop-publish/tasks/[id]

import { useState, useEffect, useCallback, useRef } from 'react'
import {
    Loader2,
    Trash2,
    AlertTriangle,
    Clock,
    CheckCircle2,
    XCircle,
    Play,
    ChevronDown,
    ChevronUp,
    RefreshCw,
    ShoppingBag,
    FileVideo,
    Package,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { cn } from '@/lib/utils'

// ============================================================
// Types (aligned with shop_publish_tasks / shop_publish_task_items)
// ============================================================

interface TaskItem {
    id: string
    account_id: string
    video_url: string
    video_source: string
    title: string
    product_id: string
    product_anchor_title: string
    status: 'pending' | 'uploading' | 'prechecking' | 'publishing' | 'published' | 'failed'
    precheck_status: 'none' | 'pending' | 'passed' | 'warning' | 'rejected'
    error_message: string | null
    created_at: string
}

interface Task {
    id: string
    task_name: string
    title_template: string | null
    total_items: number
    success_count: number
    failed_count: number
    status: 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed' | 'cancelled'
    created_at: string
    started_at: string | null
    completed_at: string | null
}

// ============================================================
// Status Config
// ============================================================

const STATUS_CONFIG: Record<Task['status'], {
    label: string
    icon: React.ElementType
    color: string
    badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline'
}> = {
    pending: {
        label: '待处理',
        icon: Clock,
        color: 'text-gray-400',
        badgeVariant: 'outline',
    },
    processing: {
        label: '处理中',
        icon: Play,
        color: 'text-cyan-400',
        badgeVariant: 'default',
    },
    completed: {
        label: '已完成',
        icon: CheckCircle2,
        color: 'text-green-400',
        badgeVariant: 'default',
    },
    partial_failed: {
        label: '部分失败',
        icon: AlertTriangle,
        color: 'text-amber-400',
        badgeVariant: 'secondary',
    },
    failed: {
        label: '失败',
        icon: XCircle,
        color: 'text-red-400',
        badgeVariant: 'destructive',
    },
    cancelled: {
        label: '已取消',
        icon: XCircle,
        color: 'text-gray-500',
        badgeVariant: 'outline',
    },
}

const ITEM_STATUS_LABELS: Record<TaskItem['status'], { label: string; color: string }> = {
    pending: { label: '待处理', color: 'text-gray-400' },
    uploading: { label: '上传中', color: 'text-blue-400' },
    prechecking: { label: '预检中', color: 'text-amber-400' },
    publishing: { label: '发布中', color: 'text-cyan-400' },
    published: { label: '已发布', color: 'text-green-400' },
    failed: { label: '失败', color: 'text-red-400' },
}

// ============================================================
// Component
// ============================================================

export function ShopTaskManager() {
    const { toast } = useToast()
    const [tasks, setTasks] = useState<Task[]>([])
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)

    // Expanded task for viewing items
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
    const [taskItems, setTaskItems] = useState<Record<string, TaskItem[]>>({})
    const [loadingItems, setLoadingItems] = useState<string | null>(null)

    // Delete state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [taskToDelete, setTaskToDelete] = useState<Task | null>(null)
    const [deleting, setDeleting] = useState(false)

    // Auto-refresh for processing tasks
    const pollRef = useRef<NodeJS.Timeout | null>(null)

    // ============================================================
    // Data Fetching
    // ============================================================

    const fetchTasks = useCallback(async (currentPage = 1) => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                page: currentPage.toString(),
                page_size: '20',
            })

            const res = await fetch(`/api/shop-publish/tasks?${params}`)
            if (!res.ok) throw new Error('获取任务列表失败')

            const data = await res.json()
            setTasks(data.tasks || [])
            setTotal(data.total || 0)
        } catch (error) {
            console.error('Failed to fetch shop tasks:', error)
            toast({
                title: '加载失败',
                description: '无法获取任务列表',
                variant: 'destructive',
            })
        } finally {
            setLoading(false)
        }
    }, [toast])

    // Initial load
    useEffect(() => {
        fetchTasks(page)
    }, [page, fetchTasks])

    // Auto-refresh when there are processing tasks
    useEffect(() => {
        const hasProcessing = tasks.some(t => t.status === 'processing')

        if (hasProcessing) {
            pollRef.current = setInterval(() => {
                fetchTasks(page)
            }, 5000) // Poll every 5 seconds
        }

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
            }
        }
    }, [tasks, page, fetchTasks])

    // ============================================================
    // Task Item Detail
    // ============================================================

    const fetchTaskItems = async (taskId: string) => {
        setLoadingItems(taskId)
        try {
            const res = await fetch(`/api/shop-publish/tasks/${taskId}`)
            if (!res.ok) throw new Error('获取任务详情失败')

            const data = await res.json()
            setTaskItems(prev => ({ ...prev, [taskId]: data.items || [] }))
        } catch (error) {
            console.error('Failed to fetch task items:', error)
            toast({
                title: '加载详情失败',
                variant: 'destructive',
            })
        } finally {
            setLoadingItems(null)
        }
    }

    const toggleExpand = (taskId: string) => {
        if (expandedTaskId === taskId) {
            setExpandedTaskId(null)
        } else {
            setExpandedTaskId(taskId)
            // Fetch items if not cached
            if (!taskItems[taskId]) {
                fetchTaskItems(taskId)
            }
        }
    }

    // ============================================================
    // Delete
    // ============================================================

    const handleDelete = (task: Task) => {
        setTaskToDelete(task)
        setDeleteDialogOpen(true)
    }

    const confirmDelete = async () => {
        if (!taskToDelete) return

        setDeleting(true)
        try {
            const res = await fetch(`/api/shop-publish/tasks/${taskToDelete.id}`, {
                method: 'DELETE',
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || '删除失败')
            }

            toast({ title: '任务已删除' })
            setTasks(prev => prev.filter(t => t.id !== taskToDelete.id))
            setDeleteDialogOpen(false)
            setTaskToDelete(null)

            // Clean up expanded state
            if (expandedTaskId === taskToDelete.id) {
                setExpandedTaskId(null)
            }
        } catch (error) {
            toast({
                title: '删除失败',
                description: error instanceof Error ? error.message : '未知错误',
                variant: 'destructive',
            })
        } finally {
            setDeleting(false)
        }
    }

    // ============================================================
    // Render Helpers
    // ============================================================

    const getProgressPercent = (task: Task) => {
        if (task.total_items === 0) return 0
        return Math.round(((task.success_count + task.failed_count) / task.total_items) * 100)
    }

    // ============================================================
    // Render
    // ============================================================

    if (loading && tasks.length === 0) {
        return (
            <div className="flex justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
        )
    }

    if (tasks.length === 0) {
        return (
            <div className="text-center py-16 bg-white/5 border rounded-xl border-dashed border-white/10">
                <ShoppingBag className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">暂无发布任务</p>
                <p className="text-gray-600 text-xs mt-1">
                    创建发布任务后，任务记录将显示在这里
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-400">
                    共 {total} 个任务
                </h3>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchTasks(page)}
                    className="text-gray-400 hover:text-white gap-2"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
                    刷新
                </Button>
            </div>

            {/* Task Cards */}
            <div className="space-y-3">
                {tasks.map(task => {
                    const statusConfig = STATUS_CONFIG[task.status]
                    const StatusIcon = statusConfig.icon
                    const isExpanded = expandedTaskId === task.id
                    const items = taskItems[task.id]
                    const progress = getProgressPercent(task)

                    return (
                        <div
                            key={task.id}
                            className="rounded-xl border border-white/10 bg-white/5 overflow-hidden transition-all"
                        >
                            {/* Task Header */}
                            <div className="p-4">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h4 className="font-medium text-white truncate">
                                                {task.task_name || '未命名任务'}
                                            </h4>
                                            <Badge variant={statusConfig.badgeVariant} className="shrink-0">
                                                <StatusIcon className={cn('w-3 h-3 mr-1', statusConfig.color)} />
                                                {statusConfig.label}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-gray-500">
                                            {formatDistanceToNow(new Date(task.created_at), {
                                                addSuffix: true,
                                                locale: zhCN,
                                            })}
                                        </p>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center gap-1">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => toggleExpand(task.id)}
                                            className="text-gray-400 hover:text-white h-8 w-8 p-0"
                                        >
                                            {isExpanded
                                                ? <ChevronUp className="w-4 h-4" />
                                                : <ChevronDown className="w-4 h-4" />
                                            }
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleDelete(task)}
                                            className="text-gray-400 hover:text-red-400 h-8 w-8 p-0"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                {task.status !== 'pending' && (
                                    <div className="space-y-1.5">
                                        <Progress value={progress} className="h-1.5" />
                                        <div className="flex items-center gap-4 text-xs text-gray-500">
                                            <span className="flex items-center gap-1">
                                                <Package className="w-3 h-3" />
                                                总计 {task.total_items}
                                            </span>
                                            {task.success_count > 0 && (
                                                <span className="text-green-400">
                                                    ✓ {task.success_count} 成功
                                                </span>
                                            )}
                                            {task.failed_count > 0 && (
                                                <span className="text-red-400">
                                                    ✕ {task.failed_count} 失败
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Pending summary */}
                                {task.status === 'pending' && (
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <Package className="w-3 h-3" />
                                        {task.total_items} 个视频待处理
                                    </div>
                                )}
                            </div>

                            {/* Expanded Items */}
                            {isExpanded && (
                                <div className="border-t border-white/5 bg-white/[0.02]">
                                    {loadingItems === task.id ? (
                                        <div className="flex justify-center py-8">
                                            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                                        </div>
                                    ) : items && items.length > 0 ? (
                                        <div className="divide-y divide-white/5">
                                            {items.map((item, index) => {
                                                const itemStatus = ITEM_STATUS_LABELS[item.status]
                                                return (
                                                    <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                                                        <span className="text-xs text-gray-600 w-6 text-right">
                                                            {index + 1}
                                                        </span>
                                                        <FileVideo className="w-4 h-4 text-gray-500 shrink-0" />
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-sm text-white truncate">
                                                                {item.title}
                                                            </p>
                                                            {item.error_message && (
                                                                <p className="text-xs text-red-400 mt-0.5 truncate">
                                                                    {item.error_message}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <span className={cn('text-xs whitespace-nowrap', itemStatus.color)}>
                                                            {itemStatus.label}
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-center py-6 text-sm text-gray-500">
                                            暂无子项数据
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent className="bg-gray-900 border-white/10">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-white flex items-center gap-2">
                            <Trash2 className="w-5 h-5 text-red-400" />
                            删除任务
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            确定要删除任务 &ldquo;{taskToDelete?.task_name || '未命名任务'}&rdquo; 吗？
                            此操作不可撤销，所有关联的子项也将被删除。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-white/5 border-white/10 text-gray-300 hover:bg-white/10">
                            取消
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            disabled={deleting}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deleting ? '删除中...' : '确认删除'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
