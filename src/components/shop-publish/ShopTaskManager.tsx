'use client'

// Shop Task Manager — task history management
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
    Eye,
    ShieldCheck,
    ShieldAlert,
    ShieldQuestion,
    ShieldX,
    ExternalLink,
    Calendar,
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
import { zhCN, enUS } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useLang } from '@/contexts/LangContext'
import SHOP_TEXT, { localizeError, type Lang } from './shop-publish.i18n'

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
    video_id: string | null
    published_at: string | null
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
// Status Config — lang-parameterized
// ============================================================

function getStatusConfig(lang: Lang): Record<Task['status'], {
    label: string
    icon: React.ElementType
    color: string
    badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline'
}> {
    const T = SHOP_TEXT.taskMgr
    return {
        pending:        { label: T.statusPending[lang],    icon: Clock,          color: 'text-gray-400', badgeVariant: 'outline' },
        processing:     { label: T.statusProcessing[lang], icon: Play,           color: 'text-cyan-400', badgeVariant: 'default' },
        completed:      { label: T.statusCompleted[lang],  icon: CheckCircle2,   color: 'text-green-400', badgeVariant: 'default' },
        partial_failed: { label: T.statusPartial[lang],    icon: AlertTriangle,  color: 'text-amber-400', badgeVariant: 'secondary' },
        failed:         { label: T.statusFailed[lang],     icon: XCircle,        color: 'text-red-400', badgeVariant: 'destructive' },
        cancelled:      { label: T.statusCancelled[lang],  icon: XCircle,        color: 'text-gray-500', badgeVariant: 'outline' },
    }
}

function getItemStatusLabels(lang: Lang): Record<TaskItem['status'], { label: string; color: string; icon: React.ElementType }> {
    const T = SHOP_TEXT.taskMgr
    return {
        pending:     { label: T.itemPending[lang],     color: 'text-gray-400', icon: Clock },
        uploading:   { label: T.itemUploading[lang],   color: 'text-blue-400', icon: Play },
        prechecking: { label: T.itemPrechecking[lang], color: 'text-amber-400', icon: Eye },
        publishing:  { label: T.itemPublishing[lang],  color: 'text-cyan-400', icon: Play },
        published:   { label: T.itemPublished[lang],   color: 'text-green-400', icon: CheckCircle2 },
        failed:      { label: T.itemFailed[lang],      color: 'text-red-400', icon: XCircle },
    }
}

function getPrecheckConfig(lang: Lang): Record<TaskItem['precheck_status'], {
    label: string
    color: string
    bgColor: string
    icon: React.ElementType
}> {
    const T = SHOP_TEXT.taskMgr
    return {
        none:     { label: T.precheckSkipped[lang],  color: 'text-gray-500',  bgColor: 'bg-gray-500/10',  icon: ShieldQuestion },
        pending:  { label: T.precheckPending[lang],  color: 'text-amber-400', bgColor: 'bg-amber-500/10', icon: ShieldQuestion },
        passed:   { label: T.precheckPassed[lang],   color: 'text-green-400', bgColor: 'bg-green-500/10', icon: ShieldCheck },
        warning:  { label: T.precheckWarning[lang],  color: 'text-amber-400', bgColor: 'bg-amber-500/10', icon: ShieldAlert },
        rejected: { label: T.precheckRejected[lang], color: 'text-red-400',   bgColor: 'bg-red-500/10',   icon: ShieldX },
    }
}

// ============================================================
// Component
// ============================================================

export function ShopTaskManager() {
    const { toast } = useToast()
    const { lang } = useLang()
    const T = SHOP_TEXT.taskMgr
    const STATUS_CONFIG = getStatusConfig(lang)
    const ITEM_STATUS_LABELS = getItemStatusLabels(lang)
    const PRECHECK_CONFIG = getPrecheckConfig(lang)
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
            if (!res.ok) throw new Error('Failed to load tasks')

            const data = await res.json()
            setTasks(data.tasks || [])
            setTotal(data.total || 0)
        } catch (error) {
            console.error('Failed to fetch shop tasks:', error)
            toast({
                title: T.listLoadFailed[lang],
                description: T.listLoadFailedDesc[lang],
                variant: 'destructive',
            })
        } finally {
            setLoading(false)
        }
    }, [toast, lang])

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
                // Also refresh expanded task items if the expanded task is still processing
                if (expandedTaskId) {
                    const expandedTask = tasks.find(t => t.id === expandedTaskId)
                    if (expandedTask && expandedTask.status === 'processing') {
                        fetchTaskItems(expandedTaskId)
                    }
                }
            }, 5000) // Poll every 5 seconds
        }

        return () => {
            if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tasks, page, fetchTasks, expandedTaskId])

    // ============================================================
    // Task Item Detail
    // ============================================================

    const fetchTaskItems = async (taskId: string) => {
        setLoadingItems(taskId)
        try {
            const res = await fetch(`/api/shop-publish/tasks/${taskId}`)
            if (!res.ok) throw new Error('Failed to load task details')

            const data = await res.json()
            setTaskItems(prev => ({ ...prev, [taskId]: data.items || [] }))
        } catch (error) {
            console.error('Failed to fetch task items:', error)
            toast({
                title: T.detailLoadFailed[lang],
                description: T.detailLoadFailedDesc[lang],
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
            // Always re-fetch items for processing tasks; use cache for completed ones
            const task = tasks.find(t => t.id === taskId)
            if (!taskItems[taskId] || (task && task.status === 'processing')) {
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
                throw new Error(data.error || 'Delete failed')
            }

            toast({ title: T.taskDeleted[lang], description: T.taskDeletedDesc[lang] })
            setTasks(prev => prev.filter(t => t.id !== taskToDelete.id))
            setDeleteDialogOpen(false)
            setTaskToDelete(null)

            // Clean up expanded state
            if (expandedTaskId === taskToDelete.id) {
                setExpandedTaskId(null)
            }
        } catch (error) {
            toast({
                title: T.deleteFailed[lang],
                description: error instanceof Error ? localizeError(error.message, lang) : '',
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

    const dateLocale = lang === 'zh' ? zhCN : enUS
    const formatRelativeTime = (dateStr: string) => {
        try {
            return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: dateLocale })
        } catch {
            return dateStr
        }
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
                <p className="text-gray-500 text-sm">{T.noTasks[lang]}</p>
                <p className="text-gray-600 text-xs mt-1">
                    {T.noTasksDesc[lang]}
                </p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-gray-400">
                    {total} {total !== 1 ? (lang === 'en' ? 'tasks' : '个任务') : (lang === 'en' ? 'task' : '个任务')}
                </h3>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchTasks(page)}
                    className="text-gray-400 hover:text-white gap-2"
                >
                    <RefreshCw className="w-3.5 h-3.5" />
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
                                                {task.task_name || 'Untitled Task'}
                                            </h4>
                                            <Badge variant={statusConfig.badgeVariant} className="shrink-0">
                                                <StatusIcon className={cn('w-3 h-3 mr-1', statusConfig.color)} />
                                                {statusConfig.label}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-gray-500">
                                            {formatRelativeTime(task.created_at)}
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
                                                {task.total_items} {T.items[lang]}
                                            </span>
                                            {task.success_count > 0 && (
                                                <span className="text-green-400">
                                                    ✓ {task.success_count} {lang === 'en' ? 'succeeded' : '成功'}
                                                </span>
                                            )}
                                            {task.failed_count > 0 && (
                                                <span className="text-red-400">
                                                    ✕ {task.failed_count} {lang === 'en' ? 'failed' : '失败'}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Pending summary */}
                                {task.status === 'pending' && (
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <Package className="w-3 h-3" />
                                        {task.total_items} {lang === 'en' ? `video${task.total_items !== 1 ? 's' : ''} queued for processing` : '个视频待处理'}
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
                                                const ItemStatusIcon = itemStatus.icon
                                                const precheckConfig = PRECHECK_CONFIG[item.precheck_status]
                                                const PrecheckIcon = precheckConfig.icon
                                                return (
                                                    <div key={item.id} className="px-4 py-3 space-y-2">
                                                        {/* Row 1: Title + Status */}
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-xs text-gray-600 w-6 text-right">
                                                                {index + 1}
                                                            </span>
                                                            <FileVideo className="w-4 h-4 text-gray-500 shrink-0" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-sm text-white truncate">
                                                                    {item.title}
                                                                </p>
                                                            </div>
                                                            <div className="flex items-center gap-1.5">
                                                                <ItemStatusIcon className={cn('w-3.5 h-3.5', itemStatus.color)} />
                                                                <span className={cn('text-xs whitespace-nowrap', itemStatus.color)}>
                                                                    {itemStatus.label}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Row 2: Metadata badges */}
                                                        <div className="flex items-center gap-2 ml-9 flex-wrap">
                                                            {/* Precheck Status */}
                                                            {item.precheck_status !== 'none' && (
                                                                <Badge variant="outline" className={cn('text-[10px] gap-1 px-1.5 py-0', precheckConfig.color, precheckConfig.bgColor)}>
                                                                    <PrecheckIcon className="w-3 h-3" />
                                                                    {lang === 'en' ? 'Precheck' : '预检'}: {precheckConfig.label}
                                                                </Badge>
                                                            )}

                                                            {/* Video ID */}
                                                            {item.video_id && (
                                                                <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 text-gray-400 bg-white/5">
                                                                    <ExternalLink className="w-3 h-3" />
                                                                    ID: {item.video_id.substring(0, 12)}...
                                                                </Badge>
                                                            )}

                                                            {/* Published At */}
                                                            {item.published_at && (
                                                                <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 text-green-400 bg-green-500/10">
                                                                    <Calendar className="w-3 h-3" />
                                                                    {lang === 'en' ? 'Published' : '发布于'} {formatRelativeTime(item.published_at)}
                                                                </Badge>
                                                            )}

                                                            {/* In-progress indicator */}
                                                            {['uploading', 'prechecking', 'publishing'].includes(item.status) && (
                                                                <Badge variant="outline" className="text-[10px] gap-1 px-1.5 py-0 text-cyan-400 bg-cyan-500/10 animate-pulse">
                                                                    <Loader2 className="w-3 h-3 animate-spin" />
                                                                    {lang === 'en' ? 'In progress...' : '处理中...'}
                                                                </Badge>
                                                            )}
                                                        </div>

                                                        {/* Row 3: Error message */}
                                                        {item.error_message && (
                                                            <p className="text-xs text-red-400 ml-9 truncate">
                                                                {item.error_message}
                                                            </p>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-center py-6 text-sm text-gray-500">
                                            {lang === 'en' ? 'No item data available' : '暂无子项数据'}
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
                            {T.confirmDeleteTitle[lang]}
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            {T.confirmDeleteDesc[lang]}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-white/5 border-white/10 text-gray-300 hover:bg-white/10">
                            {T.cancel[lang]}
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDelete}
                            disabled={deleting}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {deleting ? T.deleting[lang] : T.deleteBtn[lang]}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
