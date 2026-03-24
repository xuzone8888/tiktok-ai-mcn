'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, AlertTriangle, Trash2, ListTodo } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
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
import { TaskGroupCard, TaskGroup } from './TaskGroupCard'
import { TaskGroupDetail } from './TaskGroupDetail'
import { useToast } from '@/hooks/use-toast'

type DateRange = 'today' | 'yesterday' | '3days' | '7days'

const dateRangeOptions: { value: DateRange; label: string }[] = [
    { value: 'today', label: '今天' },
    { value: 'yesterday', label: '昨天' },
    { value: '3days', label: '近3天' },
    { value: '7days', label: '近7天' },
]

export function TaskManager() {
    const { toast } = useToast()
    const [activeTab, setActiveTab] = useState('all')
    const [dateRange, setDateRange] = useState<DateRange>('today')
    const [tasks, setTasks] = useState<TaskGroup[]>([])
    const [loading, setLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [page, setPage] = useState(1)
    const [hasMore, setHasMore] = useState(true)

    // Detail view state
    const [selectedTask, setSelectedTask] = useState<TaskGroup | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)

    // Delete dialog state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
    const [taskToDelete, setTaskToDelete] = useState<TaskGroup | null>(null)
    const [deleting, setDeleting] = useState(false)

    const fetchTasks = useCallback(async (reset = false) => {
        setLoading(true)
        try {
            const params = new URLSearchParams({
                limit: '20',
                offset: reset ? '0' : ((page - 1) * 20).toString(),
                dateRange: dateRange
            })

            if (activeTab !== 'all') {
                params.append('status', activeTab)
            }

            const res = await fetch(`/api/publish/tasks?${params}`)
            const data = await res.json()

            if (res.ok) {
                if (reset) {
                    setTasks(data.tasks || [])
                } else {
                    setTasks(prev => [...prev, ...data.tasks])
                }
                setHasMore((data.tasks?.length || 0) === 20)
            }
        } catch (error) {
            console.error('Fetch tasks failed:', error)
            toast({
                title: '加载失败',
                description: '无法获取任务列表',
                variant: 'destructive',
            })
        } finally {
            setLoading(false)
        }
    }, [activeTab, dateRange, page, toast])

    // Initial load & Tab/DateRange change
    useEffect(() => {
        setPage(1)
        fetchTasks(true)
    }, [activeTab, dateRange])

    // W2 fix: 分页变化时加载更多
    useEffect(() => {
        if (page > 1) fetchTasks(false)
    }, [page])

    const handleViewDetail = (taskId: string) => {
        const task = tasks.find(t => t.id === taskId)
        if (task) {
            setSelectedTask(task)
            setDetailOpen(true)
        }
    }

    const handleDeleteTask = (task: TaskGroup) => {
        setTaskToDelete(task)
        setDeleteDialogOpen(true)
    }

    const confirmDeleteTask = async () => {
        if (!taskToDelete) return

        setDeleting(true)
        try {
            const res = await fetch(`/api/publish/tasks/${taskToDelete.id}`, {
                method: 'DELETE'
            })

            const data = await res.json()

            if (!res.ok) throw new Error(data.error || '删除失败')

            // 如果有已发布视频，提示用户去TikTok手动删除
            if (taskToDelete.published_count > 0) {
                toast({
                    title: '任务组已删除',
                    description: `请前往 TikTok App 手动删除 ${taskToDelete.published_count} 个已发布视频`,
                })
            } else {
                toast({ title: '任务组已删除' })
            }

            // Remove from local state
            setTasks(prev => prev.filter(t => t.id !== taskToDelete.id))
            setDeleteDialogOpen(false)
            setTaskToDelete(null)

        } catch (error: any) {
            toast({
                title: '删除失败',
                description: error.message,
                variant: 'destructive',
            })
        } finally {
            setDeleting(false)
        }
    }

    const handleDeleteItem = async (itemId: string, deleteTikTokVideo: boolean) => {
        try {
            const res = await fetch(`/api/publish/tasks/${selectedTask?.id}/items/${itemId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deleteTikTokVideo })
            })

            const data = await res.json()

            if (!res.ok) throw new Error(data.error || '删除失败')

            if (data.tiktokDeleteStatus === 'failed') {
                toast({
                    title: '本地删除成功',
                    description: '但 TikTok 视频删除失败',
                })
            } else {
                toast({
                    title: '删除成功',
                    description: deleteTikTokVideo ? '本地与 TikTok 视频均已删除' : '本地任务已删除',
                })
            }

            // 乐观更新本地状态
            // deleteTikTokVideo 仅在被删项是 published 状态时由 TaskGroupDetail 传入 true
            setTasks(prev => prev.map(t => {
                if (t.id === selectedTask?.id) {
                    return {
                        ...t,
                        total_items: t.total_items - 1,
                        // 只有删除已发布的项才减少 published_count
                        published_count: deleteTikTokVideo ? Math.max(0, t.published_count - 1) : t.published_count
                    }
                }
                return t
            }))

        } catch (error: any) {
            toast({
                title: '操作失败',
                description: error.message,
                variant: 'destructive',
            })
        }
    }

    const handleCancelPending = async (taskId: string) => {
        try {
            const res = await fetch(`/api/publish/tasks/${taskId}/cancel`, {
                method: 'POST'
            })
            if (!res.ok) throw new Error('取消失败')

            toast({ title: '已取消所有待发布任务' })
            fetchTasks(true)
        } catch (error) {
            toast({
                title: '取消失败',
                variant: 'destructive',
            })
        }
    }

    return (
        <div className="space-y-4">
            {/* 7天清理提示 */}
            <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-500/5 border border-amber-500/10 rounded-lg text-amber-500/70 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>任务记录将在创建后 <strong className="text-amber-400/80">7 天</strong> 自动清理，请及时下载或备份重要数据</span>
            </div>

            {/* 筛选区域 */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
                        <TabsList>
                            <TabsTrigger value="all">全部</TabsTrigger>
                            <TabsTrigger value="in_progress">进行中</TabsTrigger>
                            <TabsTrigger value="completed">已完成</TabsTrigger>
                            <TabsTrigger value="failed">失败</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    {/* 时间筛选器 */}
                    <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
                        <SelectTrigger className="w-28 h-9 bg-white/5 border-white/10">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {dateRangeOptions.map(opt => (
                                <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                        <Input
                            placeholder="搜索任务..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 h-9 bg-white/5 border-white/10 focus:border-[#CCFF00]/30 focus:ring-1 focus:ring-[#CCFF00]/20 transition-all"
                        />
                    </div>
                </div>
            </div>

            {/* 任务列表 */}
            {loading && page === 1 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="rounded-xl border border-white/5 bg-zinc-900/40 p-5 animate-pulse">
                            <div className="flex items-start justify-between mb-4">
                                <div className="h-5 bg-white/[0.08] rounded w-2/3" />
                                <div className="h-5 bg-white/[0.08] rounded w-16" />
                            </div>
                            <div className="grid grid-cols-3 gap-3 mb-4">
                                <div className="h-10 bg-white/[0.08] rounded" />
                                <div className="h-10 bg-white/[0.08] rounded" />
                                <div className="h-10 bg-white/[0.08] rounded" />
                            </div>
                            <div className="h-4 bg-white/[0.08] rounded w-1/3 mt-4" />
                        </div>
                    ))}
                </div>
            ) : tasks.length === 0 ? (
                <div className="text-center py-16 bg-white/[0.02] border rounded-xl border-dashed border-white/10">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white/5 mb-4">
                        <ListTodo className="w-7 h-7 text-zinc-600" />
                    </div>
                    <p className="text-zinc-400 mb-1">暂无任务数据</p>
                    <p className="text-xs text-zinc-600 mb-5">创建发布任务后，这里会展示任务状态和数据统计</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {tasks
                        .filter(task => !searchQuery || task.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                        .map(task => (
                        <TaskGroupCard
                            key={task.id}
                            task={task}
                            onViewDetail={handleViewDetail}
                            onCancelPending={handleCancelPending}
                            onDelete={handleDeleteTask}
                        />
                    ))}
                </div>
            )}

            {hasMore && !loading && tasks.length > 0 && (
                <div className="flex justify-center pt-4">
                    <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setPage(p => p + 1)}
                        className="border-white/10 hover:border-white/20 text-zinc-400 hover:text-white transition-colors"
                    >
                        加载更多任务
                    </Button>
                </div>
            )}

            {/* 任务详情弹窗 */}
            <TaskGroupDetail
                task={selectedTask}
                open={detailOpen}
                onClose={() => setDetailOpen(false)}
                onDeleteItem={handleDeleteItem}
                onCancelPending={handleCancelPending}
            />

            {/* 删除确认对话框 */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent className="bg-gray-900 border-white/10">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-white flex items-center gap-2">
                            <Trash2 className="w-5 h-5 text-red-400" />
                            删除任务组
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-gray-400">
                            确定要删除任务组 "{taskToDelete?.name || '未命名任务组'}" 吗？
                            {taskToDelete && taskToDelete.published_count > 0 && (
                                <span className="block mt-2 text-amber-400">
                                    此任务组有 {taskToDelete.published_count} 个已发布视频
                                </span>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    {/* 提示信息 */}
                    {taskToDelete && taskToDelete.published_count > 0 && (
                        <div className="py-4">
                            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
                                <div>
                                    <p className="text-amber-300 font-medium">已发布视频需手动删除</p>
                                    <p className="text-gray-400 text-sm mt-1">
                                        TikTok不支持通过API删除视频。此任务组中的 {taskToDelete.published_count} 个已发布视频需要您前往 TikTok App 手动删除。
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    <AlertDialogFooter>
                        <AlertDialogCancel className="bg-white/5 border-white/10 text-gray-300 hover:bg-white/10">
                            取消
                        </AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmDeleteTask}
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
